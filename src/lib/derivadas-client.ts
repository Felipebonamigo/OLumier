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

import type { RostoMedido } from "./rostos-client";

export const TAMANHO_THUMB = 640; // grade — igual ao que o Pixieset usa
export const TAMANHO_PREVIEW = 2048; // lightbox — nítido em tela cheia, fração do original

export interface Derivadas {
  thumb: Blob;
  preview: Blob;
  largura: number; // do original, para a grade reservar o espaço certo
  altura: number;
  /**
   * A medição dos rostos, JÁ EM ANDAMENTO. Só existe com a busca por rosto
   * ligada. É uma promessa, e não o resultado, de propósito: ela roda na placa
   * de vídeo enquanto o arquivo sobe pela rede — esperar aqui somaria um
   * segundo por foto que cabe inteiro debaixo do envio.
   */
  rostos?: Promise<RostoMedido[]>;
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
 *
 * `medirRostos` é opcional e vem de fora: este módulo não sabe de reconhecimento
 * facial, e não deve — quem não ligou a busca não carrega o modelo. O que ele
 * garante é que a foto é DECODIFICADA UMA VEZ: o mesmo bitmap serve às três
 * derivadas e à medição, no original, que é onde o rosto pequeno ainda tem pixel.
 */
export async function gerarDerivadas(
  arquivo: File,
  opcoes: { medirRostos?: (bitmap: ImageBitmap) => Promise<RostoMedido[]> } = {},
): Promise<Derivadas | null> {
  if (!arquivo.type.startsWith("image/")) return null;
  try {
    // from-image respeita a orientação EXIF — foto de celular não vira deitada.
    const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    try {
      const [thumb, preview] = await Promise.all([
        redimensionar(bitmap, TAMANHO_THUMB),
        redimensionar(bitmap, TAMANHO_PREVIEW),
      ]);
      const derivadas: Derivadas = { thumb, preview, largura: bitmap.width, altura: bitmap.height };

      /*
       * A medição é DISPARADA, não esperada. `medirRostos` copia o bitmap para
       * o próprio canvas antes do primeiro `await` — é o contrato dele — então
       * o `close()` do `finally` logo abaixo não a alcança, e ela segue na
       * placa de vídeo enquanto este arquivo sobe. Quem chama espera a
       * promessa depois de confirmar o envio.
       *
       * Falhar NÃO derruba o envio: a foto sobe, a galeria abre, e só a busca
       * fica sem aquela foto — que reaparece na fila de "ainda não medidas".
       */
      if (opcoes.medirRostos) {
        try {
          derivadas.rostos = opcoes.medirRostos(bitmap);
        } catch {
          /* segue sem rostos */
        }
      }
      return derivadas;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
