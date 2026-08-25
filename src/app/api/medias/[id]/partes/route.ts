import { NextResponse, type NextRequest } from "next/server";
import { sessaoAtual } from "@/lib/auth";
import { consultarUm } from "@/lib/db";
import {
  buscarMedia,
  confirmarMedia,
  apagarMedia,
  anularDerivadas,
  bytesUsados,
  MAX_PARTES,
} from "@/lib/medias";
import { buscarTenantPorId } from "@/lib/tenants";
import {
  urlDaParte,
  fecharEnvioEmPartes,
  abortarEnvioEmPartes,
  conferirObjeto,
  objetoExiste,
  apagarObjeto,
} from "@/lib/r2";

/**
 * Envio em partes de um arquivo grande (filme 4K).
 *
 *   POST   → devolve URLs assinadas para um lote de partes
 *   PUT    → fecha o envio, remontando o arquivo a partir das partes
 *   DELETE → aborta e limpa as partes já enviadas
 *
 * As URLs saem em lotes em vez de todas de uma vez porque um filme de 40 GB tem
 * 400 partes: assinar tudo de saída seria uma resposta enorme e boa parte das
 * URLs venceria antes de ser usada.
 */

async function mediaComEnvioAberto(mediaId: string, tenantId: string) {
  const media = await buscarMedia(mediaId, tenantId);
  if (!media) return null;
  const linha = await consultarUm<{ upload_id: string | null }>(
    "select upload_id from medias where id = $1",
    [mediaId],
  );
  return { media, uploadId: linha?.upload_id ?? null };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await sessaoAtual();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const { id } = await params;
  const dados = await mediaComEnvioAberto(id, tenantId);
  if (!dados?.uploadId) {
    return NextResponse.json({ erro: "Envio não encontrado." }, { status: 404 });
  }

  let corpo: { numeros?: number[] };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const numeros = (corpo.numeros ?? [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_PARTES);
  if (numeros.length === 0 || numeros.length > 100) {
    return NextResponse.json({ erro: "Lote de partes inválido." }, { status: 400 });
  }

  const urls = await Promise.all(
    numeros.map(async (numero) => ({
      numero,
      url: await urlDaParte(dados.media.chave, dados.uploadId!, numero),
    })),
  );
  return NextResponse.json({ urls });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await sessaoAtual();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const { id } = await params;
  const dados = await mediaComEnvioAberto(id, tenantId);
  if (!dados?.uploadId) {
    return NextResponse.json({ erro: "Envio não encontrado." }, { status: 404 });
  }

  let corpo: { partes?: { numero: number; etag: string }[] };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const partes = (corpo.partes ?? []).filter(
    (p) => Number.isInteger(p?.numero) && typeof p?.etag === "string" && p.etag.length > 0,
  );
  if (partes.length === 0) {
    return NextResponse.json({ erro: "Nenhuma parte informada." }, { status: 400 });
  }

  try {
    await fecharEnvioEmPartes(dados.media.chave, dados.uploadId, partes);

    // Mesmo cuidado do envio simples: o tamanho vem do bucket, não do navegador.
    const { bytes } = await conferirObjeto(dados.media.chave);

    // E a mesma reconferência de quota: o filme montado pode ter saído bem maior
    // do que o navegador declarou lá no preparo.
    const tenant = await buscarTenantPorId(tenantId);
    if (!tenant) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 401 });

    const outros = await bytesUsados(tenantId, id);
    if (outros + BigInt(bytes) > BigInt(tenant.quota_bytes)) {
      await apagarMedia(id, tenantId);
      await Promise.all(
        [dados.media.chave, dados.media.chave_thumb, dados.media.chave_preview]
          .filter((c): c is string => Boolean(c))
          .map((c) => apagarObjeto(c).catch(() => {})),
      );
      return NextResponse.json(
        {
          erro: `“${dados.media.nome_original}” tem ${(bytes / 1024 ** 3).toFixed(1)} GB e não cabe no espaço que sobrou do seu plano.`,
        },
        { status: 507 },
      );
    }

    const [temThumb, temPreview] = await Promise.all([
      dados.media.chave_thumb ? objetoExiste(dados.media.chave_thumb) : Promise.resolve(true),
      dados.media.chave_preview ? objetoExiste(dados.media.chave_preview) : Promise.resolve(true),
    ]);
    if (!temThumb || !temPreview) {
      await anularDerivadas(id, { thumb: !temThumb, preview: !temPreview });
    }

    const atualizada = await confirmarMedia(id, tenantId, bytes);
    await consultarUm("update medias set upload_id = null where id = $1", [id]);

    return NextResponse.json({ ok: true, bytes: Number(atualizada!.bytes) });
  } catch (e) {
    // Falhou ao remontar: aborta para as partes não ficarem ocupando espaço pago.
    await abortarEnvioEmPartes(dados.media.chave, dados.uploadId).catch(() => {});
    await apagarMedia(id, tenantId);
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : "não foi possível finalizar o envio" },
      { status: 502 },
    );
  }
}

export async function DELETE(_r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await sessaoAtual();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const { id } = await params;
  const dados = await mediaComEnvioAberto(id, tenantId);
  if (!dados) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });

  if (dados.uploadId) {
    await abortarEnvioEmPartes(dados.media.chave, dados.uploadId).catch(() => {});
  }
  await apagarMedia(id, tenantId);
  return NextResponse.json({ ok: true });
}
