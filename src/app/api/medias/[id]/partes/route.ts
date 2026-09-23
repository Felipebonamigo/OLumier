import { quotaEfetivaBytes } from "@/config/trial";
import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao } from "@/lib/auth-api";
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
import { objetoExiste, apagarObjeto } from "@/lib/r2";
import {
  armazemDe,
  urlDaParteDoOriginal,
  fecharEnvioDoOriginal,
  abortarEnvioDoOriginal,
  conferirOriginal,
} from "@/lib/armazem";

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
  /*
   * O `armazem` vem da linha junto com o `upload_id` porque as duas coisas
   * pertencem ao MESMO envio: um vídeo grande leva horas subindo, e se a
   * credencial do B2 entrar no ambiente no meio disso, perguntar de novo
   * mandaria as partes seguintes para outro fornecedor — partes órfãs de um
   * lado e envio que nunca fecha do outro.
   */
  const linha = await consultarUm<{ upload_id: string | null; armazem: string | null }>(
    "select upload_id, armazem from medias where id = $1",
    [mediaId],
  );
  return {
    media,
    uploadId: linha?.upload_id ?? null,
    armazem: armazemDe(linha?.armazem),
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantDaRequisicao(request, "envio");
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
      url: await urlDaParteDoOriginal(dados.media.chave, dados.uploadId!, numero, dados.armazem),
    })),
  );
  return NextResponse.json({ urls });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantDaRequisicao(request, "envio");
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
    await fecharEnvioDoOriginal(dados.media.chave, dados.uploadId, partes, dados.armazem);

    // Mesmo cuidado do envio simples: o tamanho vem do bucket, não do navegador.
    const { bytes } = await conferirOriginal(dados.media.chave, dados.armazem);

    // E a mesma reconferência de quota: o filme montado pode ter saído bem maior
    // do que o navegador declarou lá no preparo.
    const tenant = await buscarTenantPorId(tenantId);
    if (!tenant) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 401 });

    const outros = await bytesUsados(tenantId, id);
    if (outros + BigInt(bytes) > quotaEfetivaBytes(tenant)) {
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
    await abortarEnvioDoOriginal(dados.media.chave, dados.uploadId, dados.armazem).catch(() => {});
    await apagarMedia(id, tenantId);
    /*
     * O TEXTO DO ERRO FICA NO SERVIDOR.
     *
     * Este `catch` cobre a remontagem no S3, e a mensagem do SDK traz nome de
     * bucket, chave do objeto e endpoint — que iam inteiros no corpo da resposta
     * para qualquer estúdio autenticado. Nenhuma outra rota fazia isso; esta
     * era a única. Quem precisa do detalhe é quem opera, e o log é onde ele
     * mora.
     */
    console.error("[partes] falha ao finalizar o envio da mídia", id, e);
    return NextResponse.json({ erro: "não foi possível finalizar o envio" }, { status: 502 });
  }
}

/*
 * Este DELETE aceita chave de API, e o de `confirmar` não. A diferença não é
 * descuido: `mediaComEnvioAberto` só encontra mídia com envio AINDA ABERTO — ou
 * seja, arquivo que nunca ficou pronto. Abortar é o fim do ciclo de envio, não
 * exclusão de entrega, e sem ele um filme de 30 GB que falhar no meio deixa as
 * partes ocupando espaço pago para sempre.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantDaRequisicao(request, "envio");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const { id } = await params;
  const dados = await mediaComEnvioAberto(id, tenantId);
  if (!dados) return NextResponse.json({ erro: "Não encontrado." }, { status: 404 });

  if (dados.uploadId) {
    await abortarEnvioDoOriginal(dados.media.chave, dados.uploadId, dados.armazem).catch(() => {});
  }
  await apagarMedia(id, tenantId);
  return NextResponse.json({ ok: true });
}
