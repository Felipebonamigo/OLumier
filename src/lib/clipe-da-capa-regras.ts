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

/**
 * ONDE O CLIPE TOCA (08/10/2026).
 *
 * Primeiro só na sala do Stream (Juan). Horas depois o Felipe mostrou uma capa
 * Imersa em movimento — foto em tela cheia, título por cima, botão "Ver
 * galeria" — e perguntou se dava para ter igual na galeria comum.
 *
 * Toca nos desenhos em que a foto É o fundo da capa: a **Imersa** e o
 * **Cartaz**. Nos que emolduram a foto (Convite, Redonda, Arco, Dividida) um
 * vídeo pequeno dentro de uma moldura parece defeito de reprodução, e no
 * Jornal e na Mínima não há foto. O que o fotógrafo escolheu continua valendo:
 * trocar o desenho não apaga o clipe, só o deixa guardado.
 */
export const CAPAS_COM_CLIPE: readonly string[] = ["imersa", "cartaz"];

export function desenhoDaCapaUsaClipe(capa: string): boolean {
  return CAPAS_COM_CLIPE.includes(capa);
}

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

/**
 * O filme serve para virar capa? Null quando serve.
 *
 * ── A RECUSA POR TAMANHO VIROU RECORTE (09/10/2026) ───────────────────────
 *
 * Juan: "o vídeo precisar ser recortado externamente para poder ser capa. É o
 * único caminho possível? Não existe a opção de reproduzir os 30 primeiros
 * segundos?".
 *
 * Até aqui esta função recusava qualquer filme acima de 30 s e mandava cortar
 * no CapCut. Só que o navegador JÁ reconverte o vídeo antes de enviar —
 * encolhe para 720p e descarta o áudio — e a biblioteca que faz isso aceita um
 * trecho. Recusar era pedir à pessoa um trabalho que a máquina já fazia.
 *
 * O que sobrou aqui é a única recusa que o recorte não resolve: sem saber
 * quanto o filme dura, não há onde cortar. Ver `trechoDoClipe`.
 */
export function recusaDaDuracao(segundos: number): string | null {
  if (!Number.isFinite(segundos) || segundos <= 0) return "Não consegui ler a duração deste vídeo.";
  return null;
}

/**
 * Que pedaço do filme vira a capa. Null quando o filme inteiro já serve — e aí
 * quem converte não passa recorte nenhum, em vez de passar "o arquivo todo".
 *
 * Os PRIMEIROS 30 s, e não um trecho do meio: é o que foi pedido, é o que a
 * pessoa consegue prever sem abrir nada, e é o único ponto que existe antes de
 * alguém escolher outro. A cena do pôster continua sendo escolhida à parte.
 */
export function trechoDoClipe(segundos: number): { inicio: number; fim: number } | null {
  if (!Number.isFinite(segundos) || segundos <= 0) return null;
  if (segundos <= DURACAO_MAXIMA_DO_CLIPE) return null;
  return { inicio: 0, fim: DURACAO_MAXIMA_DO_CLIPE };
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
