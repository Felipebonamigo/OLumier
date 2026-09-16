import { quotaEfetivaBytes, TETO_TRIAL_GB } from "@/config/trial";
import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao } from "@/lib/auth-api";
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
  armazenamentoConfigurado,
  formatoDerivadaValido,
  FORMATOS_DERIVADA,
} from "@/lib/r2";
import {
  armazemDeNovosUploads,
  urlDeEnvioDoOriginal,
  abrirEnvioDoOriginal,
} from "@/lib/armazem";

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
  /*
   * Navegador (cookie) OU programa (chave de API com escopo `envio`).
   *
   * A troca é DE PROPÓSITO só nesta linha. O portão de cobrança logo abaixo
   * (`situacaoDoTenant(...).podeEnviar`) mora no corpo da rota, depois do tenant
   * resolvido — então ele continua valendo para os dois caminhos de graça, e a
   * chave de API não vira desvio do paywall. Ver docs/chave-de-api.md.
   */
  const tenantId = await tenantDaRequisicao(request, "envio");
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
    comPreview?: boolean;
    formatoDerivadas?: string;
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
  /* Quota EFETIVA, nunca a coluna crua: no trial ela e rebaixada ao teto —
   * ver config/trial.ts, que explica o buraco de dinheiro que isso fecha. */
  const quota = quotaEfetivaBytes(tenant);
  if (comprometido + BigInt(bytes) > quota) {
    /* Dois recados, porque sao dois problemas: "espaco cheio" com 1 TB
     * contratado leria como defeito — o dono precisa saber que e a regra do
     * periodo de teste, e que pagar a remove. */
    const noTeto = tenant.status === "trial" && BigInt(tenant.quota_bytes) > quota;
    return NextResponse.json(
      {
        erro: noTeto
          ? `No período de teste o espaço é de ${TETO_TRIAL_GB} GB. Assine para liberar o espaço completo do seu plano.`
          : "Espaço insuficiente no plano. Libere espaço ou aumente o plano.",
      },
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

  /*
   * O formato das derivadas vem de quem envia, com WEBP no padrão.
   *
   * O navegador gera WEBP e não manda nada — nada muda para ele. Um plugin do
   * Lightroom manda `avif` ou `jpeg`, porque o Lightroom não exporta WEBP.
   * Formato desconhecido é RECUSADO em vez de virar o padrão calado: cair no
   * WEBP em silêncio faria o cliente achar que mandou AVIF e receber uma chave
   * `.webp` — defeito que só apareceria na galeria do casal.
   */
  const formato = corpo.formatoDerivadas ?? "webp";
  if (!formatoDerivadaValido(formato)) {
    return NextResponse.json(
      { erro: `Formato de miniatura não aceito: ${String(formato)}.` },
      { status: 415 },
    );
  }

  const chaves = montarChaves(tenantId, galeriaId, nome, formato);

  /*
   * O navegador avisa se conseguiu gerar as derivadas. Quando não conseguir
   * (HEIC que ele não decodifica, arquivo corrompido), gravamos null e a grade
   * usa o original.
   *
   * ── VÍDEO TEM PÔSTER, E SÓ PÔSTER (16/09/2026) ─────────────────────────
   *
   * Era `tipo === "foto"`, e a consequência estava na galeria: vídeo sem
   * nenhuma derivada virava um retângulo cinza na grade e um lightbox preto —
   * "aperto play e ele já abre uma tela estranha". Desde que o navegador passou
   * a extrair um quadro do filme (`derivadas-client.ts`), há miniatura para
   * gravar, e a proporção real vem junto.
   *
   * O PREVIEW continua nulo em vídeo, e isso não é economia: `urlDaDerivada`
   * devolve a derivada de preview quando ela existe, então um pôster gravado
   * ali seria entregue ao `<video>` no lugar do filme. Sem ela, a rota cai no
   * original — que é o arquivo que o player quer. Quem decide é o navegador,
   * que diz em `comPreview` o que de fato gerou.
   */
  const comDerivadas = corpo.comDerivadas === true;
  const comPreview = comDerivadas && corpo.comPreview !== false && tipo === "foto";

  /*
   * O ORIGINAL nasce onde a credencial disser (B2 quando as ARQUIVOS_*
   * existirem, R2 enquanto não). As DERIVADAS nascem sempre no R2 — é de lá que
   * o navegador serve o grid e o player, e medimos que o B2 dobra o tempo da
   * primeira tela. Ver docs/obra-rota-b2.md.
   *
   * O armazém é decidido UMA vez, aqui, e gravado na linha: as etapas seguintes
   * do envio (partes, conclusão) leem da mídia, nunca perguntam de novo.
   */
  const armazem = armazemDeNovosUploads();

  const media = await criarMediaPendente({
    armazem,
    galeriaId,
    tenantId,
    chave: chaves.original,
    chaveThumb: comDerivadas ? chaves.thumb : null,
    chavePreview: comPreview ? chaves.preview : null,
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
    comDerivadas ? urlDeUpload(chaves.thumb, FORMATOS_DERIVADA[formato].mime) : Promise.resolve(null),
    comPreview ? urlDeUpload(chaves.preview, FORMATOS_DERIVADA[formato].mime) : Promise.resolve(null),
  ]);

  // Acima de 5 GB o PUT único não serve: abre o envio em partes e o navegador
  // pede as URLs de cada pedaço conforme avança.
  if (bytes > LIMITE_PUT_UNICO) {
    const uploadId = await abrirEnvioDoOriginal(chaves.original, mime, armazem);
    await consultarUm("update medias set upload_id = $1 where id = $2", [uploadId, media!.id]);
    return NextResponse.json({
      mediaId: media!.id,
      emPartes: true,
      tamanhoParte: TAMANHO_PARTE,
      urlThumb,
      urlPreview,
    });
  }

  const url = await urlDeEnvioDoOriginal(chaves.original, mime, armazem);
  return NextResponse.json({ mediaId: media!.id, emPartes: false, url, urlThumb, urlPreview });
}
