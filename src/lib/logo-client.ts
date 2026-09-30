/**
 * A LOGO SEM A MARGEM VAZIA (30/09/2026).
 *
 * Um fotógrafo, pelo Felipe: "tinha que diminuir a própria imagem da logo
 * antes de subir pra plataforma". Parte do problema era esta: a borda
 * transparente (ou branca) que sobra em volta do desenho quando a logo é
 * exportada numa prancheta maior. A capa não sabe o que é desenho e o que é
 * sobra — a margem contava como logo, e o desenho saía menor do que a opção
 * escolhida prometia.
 *
 * Aqui a margem sai no envio, no NAVEGADOR, como as derivadas das fotos
 * (`derivadas-client.ts`): o arquivo continua indo direto para o bucket, sem
 * passar pelo servidor. Aproveita a passada para medir a imagem — a capa
 * precisa da proporção para desenhar a logo pela área (migração 051).
 *
 * Roda no cliente; não importar em código de servidor. A regra de onde está o
 * desenho (`caixaDoDesenho`) é pura, e `scripts/testar-logo-sem-margem.mjs` a
 * cobre sem navegador.
 */

import { LIMITE_LOGO } from "./marca-estudio";

/** Maior lado guardado. A capa desenha a logo com, no máximo, uns 1000 px de
    largura em tela de alta densidade; acima disso é peso sem ganho. */
export const LADO_MAXIMO_LOGO = 2000;

/* Abaixo disto de opacidade, o pixel é margem transparente — o anti-serrilhado
   da borda de um PNG tem alfa baixo, e não pode segurar a caixa aberta. */
const ALFA_MINIMO = 16;
/* Diferença, em qualquer canal, para um pixel opaco deixar de ser "fundo".
   JPG tem ruído de compressão perto de bordas brancas; 24 absorve. */
const TOLERANCIA_FUNDO = 24;

export interface Caixa {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/**
 * Onde está o desenho: a menor caixa que contém todo pixel que não é margem.
 *
 * Margem é o que é TRANSPARENTE — ou, numa imagem sem transparência, o que tem
 * a cor do fundo. O fundo só é reconhecido quando os quatro cantos concordam:
 * uma logo que encosta num canto (ou uma foto) não tem fundo uniforme, e
 * cortar pela cor de um canto só comeria parte do desenho. Aí só a margem
 * transparente sai.
 *
 * `null` quando não sobra desenho nenhum (imagem toda de uma cor) — quem chama
 * guarda o arquivo como veio, em vez de uma logo de zero pixels.
 */
export function caixaDoDesenho(px: Uint8ClampedArray, largura: number, altura: number): Caixa | null {
  const at = (x: number, y: number) => (y * largura + x) * 4;
  const cantos = [at(0, 0), at(largura - 1, 0), at(0, altura - 1), at(largura - 1, altura - 1)];
  const parecido = (i: number, j: number) =>
    Math.abs(px[i] - px[j]) <= TOLERANCIA_FUNDO &&
    Math.abs(px[i + 1] - px[j + 1]) <= TOLERANCIA_FUNDO &&
    Math.abs(px[i + 2] - px[j + 2]) <= TOLERANCIA_FUNDO;
  const fundoOpaco =
    cantos.every((c) => px[c + 3] >= 255 - ALFA_MINIMO) && cantos.every((c) => parecido(c, cantos[0]));
  const fundo = cantos[0];

  let x0 = largura;
  let y0 = altura;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = at(x, y);
      if (px[i + 3] < ALFA_MINIMO) continue;
      if (fundoOpaco && parecido(i, fundo)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, largura: x1 - x0 + 1, altura: y1 - y0 + 1 };
}

export interface LogoPronta {
  arquivo: Blob;
  mime: string;
  largura: number;
  altura: number;
}

function carregar(arquivo: Blob): Promise<HTMLImageElement> {
  return new Promise((ok, falha) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      ok(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      falha(new Error("imagem ilegível"));
    };
    img.src = url;
  });
}

function paraBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob | null> {
  return new Promise((ok) => canvas.toBlob(ok, mime, 0.92));
}

/**
 * A logo como vai para o bucket: sem margem, no máximo `LADO_MAXIMO_LOGO`, e
 * com a medida do que foi guardado.
 *
 * Qualquer falha devolve o arquivo ORIGINAL (com a medida, se deu para ler):
 * cortar a margem é melhoria, e melhoria que falha não pode impedir a pessoa de
 * ter logo. Quando não há margem nem excesso de tamanho, também devolve o
 * original — recodificar à toa só perderia qualidade.
 */
export async function prepararLogo(arquivo: File): Promise<LogoPronta> {
  const original = (largura = 0, altura = 0): LogoPronta => ({
    arquivo,
    mime: arquivo.type,
    largura,
    altura,
  });

  let img: HTMLImageElement;
  try {
    img = await carregar(arquivo);
  } catch {
    return original();
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  try {
    const escala = Math.min(1, LADO_MAXIMO_LOGO / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * escala));
    const ch = Math.max(1, Math.round(h * escala));
    const tela = document.createElement("canvas");
    tela.width = cw;
    tela.height = ch;
    const ctx = tela.getContext("2d", { willReadFrequently: true });
    if (!ctx) return original(w, h);
    ctx.drawImage(img, 0, 0, cw, ch);

    const caixa = caixaDoDesenho(ctx.getImageData(0, 0, cw, ch).data, cw, ch) ?? {
      x: 0,
      y: 0,
      largura: cw,
      altura: ch,
    };
    const semMudanca = escala === 1 && caixa.largura === cw && caixa.altura === ch;
    if (semMudanca) return original(w, h);

    const saida = document.createElement("canvas");
    saida.width = caixa.largura;
    saida.height = caixa.altura;
    saida.getContext("2d")?.drawImage(
      tela,
      caixa.x,
      caixa.y,
      caixa.largura,
      caixa.altura,
      0,
      0,
      caixa.largura,
      caixa.altura,
    );

    /* JPG continua JPG (não tem transparência a guardar, e PNG de foto pesa o
       triplo). PNG e WEBP saem PNG, que guarda a transparência sem perda. */
    let mime = arquivo.type === "image/jpeg" ? "image/jpeg" : "image/png";
    let blob = await paraBlob(saida, mime);
    /* PNG grande demais para o limite: WEBP guarda a transparência em bem
       menos bytes. Se nem assim couber, fica o original e a recusa de sempre. */
    if (blob && blob.size > LIMITE_LOGO && mime === "image/png") {
      mime = "image/webp";
      blob = await paraBlob(saida, mime);
    }
    if (!blob || blob.size > LIMITE_LOGO) return original(w, h);
    return { arquivo: blob, mime, largura: caixa.largura, altura: caixa.altura };
  } catch {
    return original(w, h);
  }
}

/** Só a medida — para a logo enviada antes do corte (ver PATCH /api/marca/logo). */
export async function medirLogo(url: string): Promise<{ largura: number; altura: number } | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok({ largura: img.naturalWidth, altura: img.naturalHeight });
    img.onerror = () => ok(null);
    img.src = url;
  });
}
