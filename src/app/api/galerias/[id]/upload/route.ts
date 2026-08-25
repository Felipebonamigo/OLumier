import { NextResponse, type NextRequest } from "next/server";
import { sessaoAtual } from "@/lib/auth";
import { consultarUm } from "@/lib/db";
import { buscarTenantPorId } from "@/lib/tenants";
import { situacaoDoTenant } from "@/lib/assinatura";
import { asaasConfigurado } from "@/lib/asaas";
import {
  TIPOS_ACEITOS,
  LIMITE_POR_ARQUIVO,
  LIMITE_PUT_UNICO,
  TAMANHO_PARTE,
  bytesUsados,
  criarMediaPendente,
} from "@/lib/medias";
import {
  montarChaves,
  urlDeUpload,
  abrirEnvioEmPartes,
  armazenamentoConfigurado,
} from "@/lib/r2";

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

  let corpo: {
    nome?: string;
    mime?: string;
    bytes?: number;
    comDerivadas?: boolean;
    secaoId?: string;
    largura?: number;
    altura?: number;
    indice?: number;
  };
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
      { erro: `“${nome}” passa de 100 GB, o limite por arquivo.` },
      { status: 413 },
    );
  }

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 401 });

  // Trial vencido / inadimplente / cancelado não envia mais nada. O que já foi
  // publicado continua no ar — ver src/lib/assinatura.ts.
  const situacao = situacaoDoTenant(tenant, asaasConfigurado());
  if (!situacao.podeEnviar) {
    return NextResponse.json({ erro: situacao.recado }, { status: 402 });
  }

  const comprometido = await bytesUsados(tenantId);
  const quota = BigInt(tenant.quota_bytes);
  if (comprometido + BigInt(bytes) > quota) {
    return NextResponse.json(
      { erro: "Espaço insuficiente no plano. Libere espaço ou aumente o plano." },
      { status: 507 },
    );
  }

  // Capítulo de destino: confere que pertence a ESTA galeria antes de usar, senão
  // um id chutado jogaria a foto no capítulo de outra galeria.
  let secaoId: string | null = null;
  if (corpo.secaoId) {
    const s = await consultarUm<{ id: string }>(
      "select id from secoes where id = $1 and galeria_id = $2",
      [corpo.secaoId, galeriaId],
    );
    secaoId = s?.id ?? null;
  }

  const chaves = montarChaves(tenantId, galeriaId, nome);

  // O navegador avisa se conseguiu gerar as derivadas. Quando não conseguir
  // (vídeo, HEIC que ele não decodifica), gravamos null e a grade usa o original.
  const comDerivadas = tipo === "foto" && corpo.comDerivadas === true;

  const media = await criarMediaPendente({
    galeriaId,
    tenantId,
    chave: chaves.original,
    chaveThumb: comDerivadas ? chaves.thumb : null,
    chavePreview: comDerivadas ? chaves.preview : null,
    nomeOriginal: nome,
    tipo,
    mime,
    bytes,
    largura: Number(corpo.largura) || null,
    altura: Number(corpo.altura) || null,
    secaoId,
    // Posição na lista que o fotógrafo ordenou — ver criarMediaPendente.
    indice: Number.isInteger(corpo.indice) ? corpo.indice : undefined,
  });

  const [urlThumb, urlPreview] = await Promise.all([
    comDerivadas ? urlDeUpload(chaves.thumb, "image/webp") : Promise.resolve(null),
    comDerivadas ? urlDeUpload(chaves.preview, "image/webp") : Promise.resolve(null),
  ]);

  // Acima de 5 GB o PUT único não serve: abre o envio em partes e o navegador
  // pede as URLs de cada pedaço conforme avança.
  if (bytes > LIMITE_PUT_UNICO) {
    const uploadId = await abrirEnvioEmPartes(chaves.original, mime);
    await consultarUm("update medias set upload_id = $1 where id = $2", [uploadId, media!.id]);
    return NextResponse.json({
      mediaId: media!.id,
      emPartes: true,
      tamanhoParte: TAMANHO_PARTE,
      urlThumb,
      urlPreview,
    });
  }

  const url = await urlDeUpload(chaves.original, mime);
  return NextResponse.json({ mediaId: media!.id, emPartes: false, url, urlThumb, urlPreview });
}
