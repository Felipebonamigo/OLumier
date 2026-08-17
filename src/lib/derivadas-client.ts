/**
 * Geração de derivadas NO NAVEGADOR do fotógrafo, durante o upload.
 *
 * É o segredo da velocidade (o mesmo truque do Pixieset, que serve miniaturas de
 * 640px na grade): quem abre a galeria baixa ~50 KB por foto, não 8 MB. Gerar no
 * navegador mantém a arquitetura "arquivo não passa pelo servidor" — o VPS não
 * gasta CPU nem banda com redimensionamento.
 *
 * Roda no cliente; não importar em código de servidor.
 */

export const TAMANHO_THUMB = 640; // grade — igual ao que o Pixieset usa
export const TAMANHO_PREVIEW = 2048; // lightbox — nítido em tela cheia, fração do original

export interface Derivadas {
  thumb: Blob;
  preview: Blob;
  largura: number; // do original, para a grade reservar o espaço certo
  altura: number;
}

async function redimensionar(bitmap: ImageBitmap, alvo: number): Promise<Blob> {
  const escala = Math.min(1, alvo / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas indisponível");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.82));
  if (!blob || blob.size === 0) throw new Error("falha ao gerar WebP");
  return blob;
}

/**
 * Devolve null quando não dá para gerar (vídeo, HEIC em navegador que não decodifica,
 * arquivo corrompido) — aí o fluxo segue só com o original e a grade usa ele mesmo.
 */
export async function gerarDerivadas(arquivo: File): Promise<Derivadas | null> {
  if (!arquivo.type.startsWith("image/")) return null;
  try {
    // from-image respeita a orientação EXIF — foto de celular não vira deitada.
    const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    try {
      const [thumb, preview] = await Promise.all([
        redimensionar(bitmap, TAMANHO_THUMB),
        redimensionar(bitmap, TAMANHO_PREVIEW),
      ]);
      return { thumb, preview, largura: bitmap.width, altura: bitmap.height };
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
