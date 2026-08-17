import { NextResponse, type NextRequest } from "next/server";
import { sessaoAtual } from "@/lib/auth";
import { consultarUm } from "@/lib/db";
import { buscarTenantPorId } from "@/lib/tenants";
import {
  TIPOS_ACEITOS,
  LIMITE_POR_ARQUIVO,
  bytesComprometidos,
  criarMediaPendente,
} from "@/lib/medias";
import { montarChave, urlDeUpload, armazenamentoConfigurado } from "@/lib/r2";

/**
 * Prepara o envio de UM arquivo.
 *
 * Devolve uma URL assinada para o navegador mandar o arquivo direto ao bucket.
 * O arquivo nunca passa por este servidor — é o que deixa um filme de vários GB
 * subir sem o VPS virar gargalo nem pagar banda.
 *
 * A linha em `medias` nasce aqui com pronto = false: ela reserva o espaço na
 * quota antes do envio começar, para dois uploads simultâneos não furarem o
 * limite juntos.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await sessaoAtual();
  if (!tenantId) {
    return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 });
  }
  if (!armazenamentoConfigurado) {
    return NextResponse.json({ erro: "Armazenamento não configurado." }, { status: 503 });
  }

  const { id: galeriaId } = await params;

  // tenant_id no where é a autorização: galeria de outro estúdio não existe aqui.
  const galeria = await consultarUm<{ id: string; estado: string }>(
    "select id, estado from galerias where id = $1 and tenant_id = $2",
    [galeriaId, tenantId],
  );
  if (!galeria) return NextResponse.json({ erro: "Galeria não encontrada." }, { status: 404 });
  if (galeria.estado !== "online") {
    return NextResponse.json(
      { erro: "Esta galeria está no cofre. Reative antes de enviar arquivos." },
      { status: 409 },
    );
  }

  let corpo: { nome?: string; mime?: string; bytes?: number };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const nome = String(corpo.nome ?? "").trim();
  const mime = String(corpo.mime ?? "");
  const bytes = Number(corpo.bytes ?? 0);

  if (!nome) return NextResponse.json({ erro: "Arquivo sem nome." }, { status: 400 });

  const tipo = TIPOS_ACEITOS[mime];
  if (!tipo) {
    return NextResponse.json(
      { erro: `“${nome}”: tipo não aceito. Envie fotos (JPG, PNG, WEBP, HEIC) ou vídeos (MP4, MOV, WEBM).` },
      { status: 415 },
    );
  }

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return NextResponse.json({ erro: `“${nome}”: tamanho inválido.` }, { status: 400 });
  }
  if (bytes > LIMITE_POR_ARQUIVO) {
    return NextResponse.json(
      { erro: `“${nome}” passa de 5 GB, o limite por arquivo hoje.` },
      { status: 413 },
    );
  }

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 401 });

  const comprometido = await bytesComprometidos(tenantId);
  const quota = BigInt(tenant.quota_bytes);
  if (comprometido + BigInt(bytes) > quota) {
    return NextResponse.json(
      { erro: "Espaço insuficiente no plano. Libere espaço ou aumente o plano." },
      { status: 507 },
    );
  }

  const chave = montarChave(tenantId, galeriaId, nome);
  const media = await criarMediaPendente({
    galeriaId,
    tenantId,
    chave,
    nomeOriginal: nome,
    tipo,
    mime,
    bytes,
  });

  const url = await urlDeUpload(chave, mime);
  return NextResponse.json({ mediaId: media!.id, url });
}
