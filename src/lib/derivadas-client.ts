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
  /**
   * O arquivo de 2048 px do lightbox. NULO em vídeo, e isso é a regra que faz o
   * player funcionar: a rota de URLs devolve a derivada de preview quando ela
   * existe, então um pôster gravado aí seria servido ao `<video>` no lugar do
   * filme. Sem preview, a rota cai no ORIGINAL — que é o que o player quer.
   */
  preview: Blob | null;
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
 * ── O PÔSTER DO VÍDEO (16/09/2026) ────────────────────────────────────────
 *
 * Felipe: "aqui não está legal, eu aperto play e ele já abre uma tela
 * estranha". Sirius, no mesmo dia: "clicou para abrir e o sistema não roda".
 *
 * A "tela estranha" era a ausência de imagem. Vídeo caía no `return null` lá
 * embaixo — nenhuma derivada —, e a galeria não tinha um só pixel do filme para
 * mostrar: na grade saía um retângulo cinza com um círculo de play, e o
 * lightbox abria preto enquanto a URL era assinada. Sem quadro e sem proporção
 * (a grade assumia 4/5 para todo vídeo), a caixa ainda saía do tamanho errado.
 *
 * O navegador sabe decodificar o vídeo que acabou de ser escolhido — é o mesmo
 * que vai tocá-lo. Pedir um quadro dele é o mesmo truque que já se faz com
 * foto, e continua sem passar pelo servidor.
 *
 * ── POR QUE NÃO O QUADRO ZERO ────────────────────────────────────────────
 *
 * Filme de casamento quase sempre abre em fade do preto. O primeiro quadro é
 * uma miniatura preta — pior que nenhuma, porque parece defeito em vez de
 * ausência. Um segundo adiante já é imagem; em clipe curto, a metade dele.
 *
 * `muted` não é detalhe: sem ele o navegador recusa carregar o vídeo sem
 * gesto da pessoa, e a extração falha em silêncio no Safari.
 */
const SEGUNDO_DO_POSTER = 1;

async function quadroDoVideo(arquivo: File): Promise<ImageBitmap | null> {
  const url = URL.createObjectURL(arquivo);
  const v = document.createElement("video");
  v.preload = "metadata";
  v.muted = true;
  v.playsInline = true;
  v.src = url;

  try {
    const pronto = <T,>(evento: string, prazo = 15000) =>
      new Promise<T>((resolve, reject) => {
        const limpar = () => {
          v.removeEventListener(evento, aoOk);
          v.removeEventListener("error", aoErro);
          clearTimeout(t);
        };
        const aoOk = () => {
          limpar();
          resolve(undefined as T);
        };
        const aoErro = () => {
          limpar();
          reject(new Error(`vídeo: ${evento} falhou`));
        };
        /* O prazo existe para o arquivo que o navegador aceita abrir e nunca
           decodifica (um MOV com codec que ele não tem). Sem ele o envio ficaria
           parado para sempre num arquivo que jamais daria quadro. */
        const t = setTimeout(aoErro, prazo);
        v.addEventListener(evento, aoOk, { once: true });
        v.addEventListener("error", aoErro, { once: true });
      });

    await pronto("loadedmetadata");
    const duracao = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : SEGUNDO_DO_POSTER * 2;
    v.currentTime = Math.min(SEGUNDO_DO_POSTER, duracao / 2);
    await pronto("seeked");
    /* `createImageBitmap` de um `<video>` lê o quadro que está na tela agora —
       o que acabou de ser buscado pelo `seeked`. */
    return await createImageBitmap(v);
  } catch {
    return null;
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
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
  /*
   * VÍDEO SAI POR AQUI, com pôster e sem preview. Ver `quadroDoVideo`.
   *
   * Não passa por `medirRostos` de propósito: a busca por rosto responde "em
   * que FOTOS eu apareço", e um vídeo inteiro representado por um quadro
   * avulso daria um resultado que o convidado não consegue interpretar —
   * aparecer no segundo 1 não é aparecer no filme.
   */
  if (arquivo.type.startsWith("video/")) {
    const bitmap = await quadroDoVideo(arquivo);
    if (!bitmap) return null;
    try {
      return {
        thumb: await redimensionar(bitmap, TAMANHO_THUMB),
        preview: null,
        largura: bitmap.width,
        altura: bitmap.height,
      };
    } catch {
      return null;
    } finally {
      bitmap.close();
    }
  }

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
