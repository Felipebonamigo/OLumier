import { urlDeLeitura } from "./r2";
import { urlDeLeituraArquivo } from "./b2";

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
