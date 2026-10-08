/**
 * AS REGRAS DO CLIPE DA CAPA, sem banco e sem rede (08/10/2026).
 *
 * Juan: "adicionar opção de subir capa em VÍDEO no formato Stream". A capa do
 * Stream passa a poder ser um clipe curto, sem som, em laço — o "trailer" no
 * fundo que as plataformas de série têm.
 *
 * Mora fora de `capa-galeria.ts` (que é `server-only`) porque as mesmas
 * medidas valem nos dois lados: o navegador do fotógrafo as usa para PREPARAR o
 * clipe, e o servidor as usa para RECUSAR o que chegar fora delas. O navegador
 * é de quem envia — o servidor não confia no que o navegador diz ter feito.
 *
 * ── POR QUE UM CLIPE E NÃO O FILME ────────────────────────────────────────
 *
 * Tocar o original de fundo no 4G de quem recebe o link é o custo que a entrega
 * existe para não ter (ver `docs/formatos-de-entrega.md`, "o que ficou de
 * fora"). Um clipe de até 30 s a 720p e ~2,5 Mbps pesa menos de 10 MB, e o
 * navegador do fotógrafo o prepara antes de subir — a mesma arquitetura da
 * versão leve (`versao-leve.ts`): o servidor nunca toca no vídeo.
 */

/** Segundos. Passou disso, é filme, não capa. */
export const DURACAO_MAXIMA_DO_CLIPE = 30;
/** O teto do arquivo no bucket. 30 s a 2,5 Mbps dão ~9 MB; o resto é folga. */
export const LIMITE_CLIPE = 25 * 1024 * 1024;
/** O primeiro quadro, em JPEG: cabe folgado em 1 MB, o teto é só contra abuso. */
export const LIMITE_POSTER_DO_CLIPE = 2 * 1024 * 1024;

export const TIPO_DO_CLIPE = "video/mp4";
export const TIPO_DO_POSTER_DO_CLIPE = "image/jpeg";

/** A caixa do clipe: 720p deitado ou em pé. Capa não precisa de mais, e pesaria. */
export const LADO_MAIOR_DO_CLIPE = 1280;
export const LADO_MENOR_DO_CLIPE = 720;
/** Bits por segundo em 720p; resolução menor ganha proporcionalmente menos. */
export const BITS_720P = 2_500_000;
/** Abaixo disso a imagem desmancha, por menor que seja o clipe. */
export const BITS_MINIMO_DO_CLIPE = 1_200_000;

const par = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Cabe na caixa de 720p sem deformar; o codificador de vídeo pede lado par. */
export function tamanhoDoClipe(largura: number, altura: number): { largura: number; altura: number } {
  const deitado = largura >= altura;
  const caixaL = deitado ? LADO_MAIOR_DO_CLIPE : LADO_MENOR_DO_CLIPE;
  const caixaA = deitado ? LADO_MENOR_DO_CLIPE : LADO_MAIOR_DO_CLIPE;
  const escala = Math.min(1, caixaL / largura, caixaA / altura);
  return { largura: par(largura * escala), altura: par(altura * escala) };
}

export function bitsDoClipe(largura: number, altura: number): number {
  return Math.max(
    BITS_MINIMO_DO_CLIPE,
    Math.round((BITS_720P * largura * altura) / (LADO_MAIOR_DO_CLIPE * LADO_MENOR_DO_CLIPE)),
  );
}

/** "1min12" / "45s" — como a mensagem fala do filme escolhido. */
function falaDaDuracao(segundos: number): string {
  const s = Math.round(segundos);
  if (s < 60) return `${s}s`;
  const resto = s % 60;
  return `${Math.floor(s / 60)}min${resto ? String(resto).padStart(2, "0") : ""}`;
}

/** O filme escolhido é curto o bastante para ser capa? Null quando serve. */
export function recusaDaDuracao(segundos: number): string | null {
  if (!Number.isFinite(segundos) || segundos <= 0) return "Não consegui ler a duração deste vídeo.";
  if (segundos > DURACAO_MAXIMA_DO_CLIPE) {
    return `A capa em vídeo tem no máximo ${DURACAO_MAXIMA_DO_CLIPE} segundos, e este tem ${falaDaDuracao(segundos)}. Corte um trecho no editor (CapCut, por exemplo) e escolha o arquivo cortado.`;
  }
  return null;
}

/** O que o servidor aceita do clipe já no bucket. */
export function recusaDoClipe(mime: string, bytes: number): string | null {
  if (mime !== TIPO_DO_CLIPE) return "O clipe da capa precisa ser MP4.";
  if (!Number.isFinite(bytes) || bytes <= 0) return "Arquivo vazio ou inválido.";
  if (bytes > LIMITE_CLIPE) return "O clipe da capa passa de 25 MB. Escolha um trecho mais curto.";
  return null;
}

export function recusaDoPosterDoClipe(mime: string, bytes: number): string | null {
  if (mime !== TIPO_DO_POSTER_DO_CLIPE) return "O primeiro quadro precisa ser JPG.";
  if (!Number.isFinite(bytes) || bytes <= 0) return "Quadro vazio ou inválido.";
  if (bytes > LIMITE_POSTER_DO_CLIPE) return "O primeiro quadro passa de 2 MB.";
  return null;
}
