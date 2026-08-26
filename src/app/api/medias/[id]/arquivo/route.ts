import { NextResponse, type NextRequest } from "next/server";
import { tenantQuePodeEnviar } from "@/lib/auth-api";
import {
  LIMITE_POR_ARQUIVO,
  LIMITE_PUT_UNICO,
  bytesUsados,
  buscarMedia,
  anularDerivadas,
  republicarMedia,
} from "@/lib/medias";
import { buscarTenantPorId } from "@/lib/tenants";
import { urlDeUpload, objetoExiste, mimeDaDerivada } from "@/lib/r2";
import { armazemDe, urlDeEnvioDoOriginal, conferirOriginal } from "@/lib/armazem";

/**
 * REPUBLICAR um arquivo já entregue, sem trocar o id da mídia.
 *
 * É o motivo de ser do plugin do Lightroom: o fotógrafo reedita uma foto,
 * clica Publicar, e só ela sobe. Sem esta rota o caminho seria apagar e criar de
 * novo — e apagar leva junto a seleção do álbum, porque `favoritas.media_id` cai
 * em cascata (migração 010) e a seleção (019) mora em cima dela. A noiva marca
 * 40 fotos, o fotógrafo clareia uma, republica, e a lista some sem aviso.
 *
 * Duas chamadas, como no upload normal:
 *   PUT  → confere, devolve a URL assinada, NÃO toca na linha
 *   POST → relê o tamanho no armazém e atualiza a linha
 *
 * ── POR QUE A MESMA CHAVE DE OBJETO ────────────────────────────────────────
 * Chave nova obrigaria a apagar a antiga (lixo pago, se falhar no meio) e
 * trocaria o endereço de um arquivo que o casal pode ter aberto. Sobrescrever é
 * atômico no S3: se o envio falhar, o conteúdo velho continua inteiro, e a
 * galeria nunca fica sem foto. A URL que o cliente recebe é assinada por
 * requisição, então o navegador busca a versão nova em vez de servir cache.
 *
 * ── POR QUE A LINHA NÃO É MARCADA COMO PENDENTE ────────────────────────────
 * Zerar `pronto` durante o envio esconderia a foto da galeria enquanto o
 * fotógrafo republica — e a deixaria escondida para sempre se ele fechasse o
 * Lightroom no meio. A entrega do casal não pode piscar por causa de uma
 * reedição.
 *
 * Ver docs/chave-de-api.md.
 */

/** Confere que é uma mídia deste estúdio e que ela JÁ FOI entregue. */
async function midiaRepublicavel(mediaId: string, tenantId: string) {
  const media = await buscarMedia(mediaId, tenantId);
  if (!media) return { erro: "Arquivo não encontrado.", status: 404 as const };
  if (!media.pronto) {
    /* Envio interrompido não se republica: ele se retoma ou se aborta pelas
     * rotas de `partes`. Tratar os dois como a mesma coisa deixaria uma linha
     * pendente virar pronta sem nunca ter tido o arquivo conferido. */
    return { erro: "Este arquivo ainda não terminou de subir.", status: 409 as const };
  }
  return { media };
}

/** Prepara a substituição: devolve para onde mandar os bytes novos. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quem = await tenantQuePodeEnviar(request);
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });

  const { id } = await params;
  const achado = await midiaRepublicavel(id, quem.tenantId);
  if ("erro" in achado) return NextResponse.json({ erro: achado.erro }, { status: achado.status });
  const { media } = achado;

  let corpo: { bytes?: number; comDerivadas?: boolean };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const bytes = Number(corpo.bytes ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return NextResponse.json({ erro: "Tamanho inválido." }, { status: 400 });
  }
  if (bytes > LIMITE_POR_ARQUIVO) {
    return NextResponse.json({ erro: "Passa de 100 GB, o limite por arquivo." }, { status: 413 });
  }
  if (bytes > LIMITE_PUT_UNICO) {
    /* Envio em partes numa republicação exigiria abrir upload multipart sobre a
     * chave existente e conviver com o objeto antigo até o fechamento. Dá para
     * fazer, e não é o caminho do plugin (foto reeditada, não filme). Recusar
     * agora é honesto; fingir que subiu seria pior. */
    return NextResponse.json(
      { erro: "Arquivo grande demais para republicar. Envie como arquivo novo." },
      { status: 413 },
    );
  }

  /*
   * A quota é conferida com a mídia ATUAL de fora da soma (`exceto`): a reserva
   * antiga vai deixar de valer, e contá-la junto recusaria uma reedição que na
   * verdade cabe.
   */
  const tenant = await buscarTenantPorId(quem.tenantId);
  if (!tenant) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 401 });
  const outros = await bytesUsados(quem.tenantId, id);
  if (outros + BigInt(bytes) > BigInt(tenant.quota_bytes)) {
    return NextResponse.json(
      { erro: "A versão nova não cabe no espaço que sobrou do seu plano." },
      { status: 507 },
    );
  }

  const armazem = armazemDe(media.armazem);
  const comDerivadas = media.tipo === "foto" && corpo.comDerivadas === true;

  const [url, urlThumb, urlPreview] = await Promise.all([
    urlDeEnvioDoOriginal(media.chave, media.mime, armazem),
    /* As derivadas seguem no R2 sempre, e só são reenviadas se o cliente disser
     * que gerou novas — quem republica sem gerar mantém as antigas, que ficam
     * desatualizadas mas continuam abrindo. */
    comDerivadas && media.chave_thumb
      ? urlDeUpload(media.chave_thumb, mimeDaDerivada(media.chave_thumb))
      : Promise.resolve(null),
    comDerivadas && media.chave_preview
      ? urlDeUpload(media.chave_preview, mimeDaDerivada(media.chave_preview))
      : Promise.resolve(null),
  ]);

  return NextResponse.json({ mediaId: id, url, urlThumb, urlPreview });
}

/** Fecha a substituição: relê o tamanho no armazém e atualiza a linha. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quem = await tenantQuePodeEnviar(request);
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });

  const { id } = await params;
  const achado = await midiaRepublicavel(id, quem.tenantId);
  if ("erro" in achado) return NextResponse.json({ erro: achado.erro }, { status: achado.status });
  const { media } = achado;

  let bytes: number;
  try {
    /* O tamanho vem do ARMAZÉM, nunca do cliente — mesma regra do `confirmar`:
     * quota é o nosso custo e não pode ser sustentada por um número que quem
     * envia escolhe. */
    ({ bytes } = await conferirOriginal(media.chave, armazemDe(media.armazem)));
  } catch {
    /* O objeto antigo continua lá: sobrescrever é atômico. Então "não chegou"
     * aqui significa que a galeria segue com a versão anterior, inteira — o
     * plugin tenta de novo e nada foi perdido. */
    return NextResponse.json(
      { erro: "A versão nova não chegou ao armazenamento. A anterior continua no ar." },
      { status: 502 },
    );
  }

  const tenant = await buscarTenantPorId(quem.tenantId);
  if (!tenant) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 401 });
  const outros = await bytesUsados(quem.tenantId, id);
  if (outros + BigInt(bytes) > BigInt(tenant.quota_bytes)) {
    return NextResponse.json(
      { erro: "A versão nova não cabe no espaço que sobrou do seu plano." },
      { status: 507 },
    );
  }

  /* Derivada que sumiu vira null e a grade cai no original — igual ao
   * `confirmar`. Não invalida a republicação. */
  const [temThumb, temPreview] = await Promise.all([
    media.chave_thumb ? objetoExiste(media.chave_thumb) : Promise.resolve(true),
    media.chave_preview ? objetoExiste(media.chave_preview) : Promise.resolve(true),
  ]);
  if (!temThumb || !temPreview) {
    await anularDerivadas(id, { thumb: !temThumb, preview: !temPreview });
  }

  const atualizada = await republicarMedia(id, quem.tenantId, { bytes });
  if (!atualizada) {
    return NextResponse.json({ erro: "Arquivo não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, mediaId: id, bytes: Number(atualizada.bytes) });
}
