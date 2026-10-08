import {
  urlDeLeitura,
  urlDeUpload,
  conferirObjeto,
  abrirEnvioEmPartes,
  urlDaParte,
  fecharEnvioEmPartes,
  abortarEnvioEmPartes,
  apagarObjetos,
} from "./r2";
import {
  urlDeLeituraArquivo,
  urlDeUploadArquivo,
  conferirArquivo,
  arquivosConfigurado,
  abrirEnvioEmPartesArquivo,
  urlDaParteArquivo,
  fecharEnvioEmPartesArquivo,
  abortarEnvioEmPartesArquivo,
  apagarArquivos,
} from "./b2";

/**
 * DE ONDE LER — o único lugar que sabe em qual fornecedor cada arquivo mora.
 *
 * A partir da fase 3 da obra (docs/obra-rota-b2.md) o ORIGINAL de galeria
 * grande e de cofre passa a morar no Backblaze B2, e a coluna `medias.armazem`
 * diz de qual dos dois ler. Já as DERIVADAS — miniatura, preview, capa, logo —
 * ficam no Cloudflare R2 para sempre: são pequenas, regeneráveis, e é o R2 que
 * tem borda perto do Brasil. É isso que mantém a navegação e o player rápidos
 * mesmo com o arquivo pesado morando longe.
 *
 * ── POR QUE UM MÓDULO SÓ PARA ISTO ────────────────────────────────────────
 * Porque a regra tem uma exceção fácil de esquecer: a derivada é OPCIONAL.
 * Vídeo sem capa gerada, HEIC antes da conversão e foto recém-enviada não têm
 * miniatura, e nesses casos o código cai no original (`chave_thumb ?? chave`).
 * Se o fallback continuar pedindo ao R2 um arquivo que já foi para o B2, o grid
 * abre com buracos — e só nos itens sem derivada, que são a minoria. Passa em
 * qualquer teste feito com galeria de exemplo, e quebra na do cliente.
 *
 * Quem escolhe a CHAVE tem de escolher o ARMAZÉM na mesma expressão. Espalhar
 * essa decisão pelos chamadores é o que faz as duas dessincronizarem.
 * `scripts/testar-armazem.mjs` prende cada caso.
 *
 * ── POR QUE NÃO UM PARÂMETRO NO `urlDeLeitura` ────────────────────────────
 * Seria mais curto, mas faria `r2.ts` importar `b2.ts` — e o `b2.ts` já importa
 * `dispositionSegura` do `r2.ts`. Um ciclo entre os dois módulos de
 * armazenamento é exatamente o tipo de acoplamento que a fase seguinte pagaria
 * caro. Este módulo é o despachante, e nenhum dos dois lados conhece o outro.
 */

export type Armazem = "r2" | "b2";

/**
 * Normaliza o que veio do banco.
 *
 * Qualquer coisa que não seja exatamente "b2" vira "r2" — que é onde TODO
 * arquivo está hoje e onde continua o que a fase 3 ainda não moveu. Lançar aqui
 * transformaria um dado inesperado em galeria fora do ar, e o `check` da
 * migração 015 já impede lixo de entrar na coluna. O padrão seguro é o lugar
 * onde as coisas estão, não o lugar para onde vão.
 */
export function armazemDe(valor: string | null | undefined): Armazem {
  return valor === "b2" ? "b2" : "r2";
}

/**
 * URL temporária do ORIGINAL, no fornecedor onde ele está.
 *
 * `baixarComoNome` vira o Content-Disposition do download — é o nome que o
 * casal vê ao salvar, e a montagem dele é a mesma nos dois lados (o `b2.ts`
 * reusa a função do `r2.ts` de propósito).
 */
export function urlDoOriginal(
  chave: string,
  armazem: Armazem,
  expiraSeg = 3600,
  baixarComoNome?: string,
): Promise<string> {
  return armazem === "b2"
    ? urlDeLeituraArquivo(chave, expiraSeg, baixarComoNome)
    : urlDeLeitura(chave, expiraSeg, baixarComoNome);
}

/**
 * URL temporária de uma DERIVADA, caindo no original quando ela não existe.
 *
 * A derivada mora sempre no R2. O fallback, não: ele É o original, e tem de ir
 * aonde o original estiver. Passar `armazemDoOriginal` mesmo quando a derivada
 * existe é de propósito — quem chama não precisa saber se vai cair no fallback,
 * e é justamente por não saber que erraria.
 *
 * String vazia conta como ausente: a coluna é `text` anulável, mas um `''`
 * gravado por engano geraria URL assinada para uma chave vazia, que falha só na
 * hora em que o cliente abre a galeria.
 */
export function urlDaDerivada(
  derivada: string | null | undefined,
  original: string,
  armazemDoOriginal: Armazem,
  expiraSeg = 3600,
): Promise<string> {
  return derivada
    ? urlDeLeitura(derivada, expiraSeg)
    : urlDoOriginal(original, armazemDoOriginal, expiraSeg);
}

/**
 * ── ONDE O ARQUIVO NASCE (fase 3 da obra) ─────────────────────────────────
 *
 * Até a fase 2 este módulo só decidia de onde LER. Agora decide onde ESCREVER.
 *
 * O desenho original mandava o arquivo nascer no R2 e um job noturno movê-lo
 * para o B2, com verificação, carência e reconciliação. Isso existia para
 * migrar acervo — e não havia acervo: produção tinha ZERO mídias. Fazer o
 * original nascer direto no B2 apagou as duas fases mais perigosas da obra,
 * que eram justamente as únicas rotinas capazes de apagar arquivo vivo.
 *
 * A janela para essa simplificação fecha no primeiro upload real. Depois dele
 * volta a ser migração.
 */

/**
 * Onde os uploads novos vão parar.
 *
 * A decisão é a PRESENÇA DA CREDENCIAL, não uma variável de liga-desliga. Sem
 * as `ARQUIVOS_*` o sistema grava no R2 e nada quebra; no dia em que elas
 * entrarem no ambiente, os uploads seguintes nascem no B2 — sem deploy, sem
 * migração e sem tocar no que já foi gravado, porque cada mídia carrega seu
 * próprio `armazem` na linha do banco.
 *
 * Uma variável separada ("USAR_B2=true") permitiria o estado impossível de
 * estar ligada sem credencial, e o sintoma seria upload falhando para o
 * fotógrafo. Aqui esse estado não existe.
 */
export function armazemDeNovosUploads(): Armazem {
  return arquivosConfigurado ? "b2" : "r2";
}

/** URL de escrita do ORIGINAL, no armazém onde ele vai nascer. */
export function urlDeEnvioDoOriginal(
  chave: string,
  mime: string,
  armazem: Armazem,
  expiraSeg = 3600,
): Promise<string> {
  return armazem === "b2"
    ? urlDeUploadArquivo(chave, mime, expiraSeg)
    : urlDeUpload(chave, mime, expiraSeg);
}

/** Tamanho e tipo do que chegou — usado para conferir o upload antes de aceitar. */
export function conferirOriginal(
  chave: string,
  armazem: Armazem,
): Promise<{ bytes: number; mime?: string }> {
  return armazem === "b2" ? conferirArquivo(chave) : conferirObjeto(chave);
}

/*
 * As quatro operações do envio em partes andam juntas, sempre no mesmo
 * armazém: abrir num fornecedor e fechar no outro deixa partes órfãs ocupando
 * espaço e cobrando sem nunca virar arquivo. O armazém vem de fora (da linha
 * da mídia, gravada quando o envio abriu) e não de `armazemDeNovosUploads()`,
 * porque um vídeo de 30 GB pode levar horas subindo — e se a credencial do B2
 * entrar no ambiente no meio disso, as partes seguintes iriam para outro lugar.
 */
export function abrirEnvioDoOriginal(
  chave: string,
  mime: string,
  armazem: Armazem,
): Promise<string> {
  return armazem === "b2" ? abrirEnvioEmPartesArquivo(chave, mime) : abrirEnvioEmPartes(chave, mime);
}

export function urlDaParteDoOriginal(
  chave: string,
  uploadId: string,
  numero: number,
  armazem: Armazem,
  expiraSeg = 6 * 3600,
): Promise<string> {
  return armazem === "b2"
    ? urlDaParteArquivo(chave, uploadId, numero, expiraSeg)
    : urlDaParte(chave, uploadId, numero, expiraSeg);
}

export function fecharEnvioDoOriginal(
  chave: string,
  uploadId: string,
  partes: { numero: number; etag: string }[],
  armazem: Armazem,
): Promise<void> {
  return armazem === "b2"
    ? fecharEnvioEmPartesArquivo(chave, uploadId, partes)
    : fecharEnvioEmPartes(chave, uploadId, partes);
}

export function abortarEnvioDoOriginal(
  chave: string,
  uploadId: string,
  armazem: Armazem,
): Promise<void> {
  return armazem === "b2"
    ? abortarEnvioEmPartesArquivo(chave, uploadId)
    : abortarEnvioEmPartes(chave, uploadId);
}

/**
 * APAGAR OS ARQUIVOS DE UM LOTE DE MÍDIAS — no fornecedor certo, em poucas
 * requisições.
 *
 * ── DE ONDE VEIO (18/09/2026) ─────────────────────────────────────────────
 *
 * Ana Carolina, com a foto do aviso do navegador: "Não foi possível apagar
 * agora. Tente de novo." — "as fotos não subiram em ordem e to tentando apagar
 * elas da galeria e da erro".
 *
 * A rota do "apagar todas" disparava UMA requisição por chave, todas de uma
 * vez: numa galeria de 286 fotos são 858 chamadas simultâneas ao armazém, de um
 * VPS pequeno, atrás de um proxy com tempo limite. O `DeleteObjects` existia
 * desde sempre em `r2.apagarObjetos` — escrito com esta conta no comentário —
 * e a rota não o usava.
 *
 * ── E O ORIGINAL NO B2 NÃO ERA APAGADO ────────────────────────────────────
 *
 * As duas rotas de apagar chamavam `r2.apagarObjeto` para TODAS as chaves,
 * inclusive a do original. Desde a fase 3 da obra o original pode morar no B2 —
 * e ali a chamada erra de balde, some no `.catch(() => {})` e deixa arquivo
 * PAGO para trás, sem linha no banco que o mencione. Ninguém veria: a galeria
 * fica certa, só a fatura cresce.
 *
 * Quem sabe onde cada arquivo mora é este módulo. Então é aqui que o apagar
 * mora também.
 *
 * ── O QUE ELA NÃO FAZ: DERRUBAR O PEDIDO ──────────────────────────────────
 *
 * Devolve o que falhou em vez de lançar. Quem chama já apagou as LINHAS — o
 * banco é a fonte da verdade — e transformar uma falha de bucket em erro na
 * tela é dizer "não deu" para quem acabou de ver a galeria esvaziar. O pior
 * caso é objeto órfão, que `scripts/varrer-orfaos.mjs` recolhe depois.
 */
export async function apagarArquivosDasMedias(
  medias: readonly {
    chave: string;
    chave_thumb?: string | null;
    chave_preview?: string | null;
    chave_reproducao?: string | null;
    armazem?: string | null;
  }[],
): Promise<{ apagadas: number; falhou: string | null }> {
  const noR2: string[] = [];
  const noB2: string[] = [];

  for (const m of medias) {
    /* As DERIVADAS ficam sempre no R2 — é a regra deste módulo inteiro. */
    if (m.chave_thumb) noR2.push(m.chave_thumb);
    if (m.chave_preview) noR2.push(m.chave_preview);
    if (m.chave_reproducao) noR2.push(m.chave_reproducao);
    if (m.chave) (armazemDe(m.armazem) === "b2" ? noB2 : noR2).push(m.chave);
  }

  const problemas: string[] = [];
  /* Os dois fornecedores em paralelo, mas cada um em lotes de 1000 por dentro:
     é a diferença entre 2 requisições e 858. */
  await Promise.all([
    noR2.length ? apagarObjetos(noR2).catch((e) => problemas.push(`R2: ${e.message}`)) : null,
    noB2.length ? apagarArquivos(noB2).catch((e) => problemas.push(`B2: ${e.message}`)) : null,
  ]);

  return {
    apagadas: noR2.length + noB2.length,
    falhou: problemas.length ? problemas.join(" · ") : null,
  };
}
