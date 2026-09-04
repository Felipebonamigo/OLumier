"use client";

import { MAX_ROSTOS_POR_FOTO, PISO_ROSTO_PX, TAMANHO_VETOR } from "@/config/rostos";

/**
 * Busca por rosto — o lado do NAVEGADOR.
 *
 * Duas pontas usam este módulo, e as duas medem rosto sem mandar imagem a
 * lugar nenhum:
 *
 *   fotógrafo   durante o envio, mede cada rosto da foto e manda só os números;
 *   convidado   tira a selfie, mede o rosto dele AQUI e manda só os números.
 *
 * O modelo (`@vladmandic/face-api`, MIT) e os pesos vêm sob demanda: quem não
 * usa a busca não baixa um byte disso. Roda no cliente; não importar em código
 * de servidor.
 *
 * ── OS DOIS DETECTORES ────────────────────────────────────────────────────
 *
 * O SSD (5,6 MB) acha rosto pequeno em foto de festa; o `tiny` (0,19 MB) não —
 * medido: 3 contra 11 numa foto com ~12 pessoas. Mas na SELFIE o rosto ocupa a
 * tela, e aí o `tiny` basta e o vetor que sai é o mesmo (0,08 a 0,23 de
 * diferença para o do SSD). Por isso o fotógrafo carrega o SSD e o convidado
 * carrega o `tiny`: 12,4 MB contra 7,0 MB no 4G do salão de festa.
 */

type FaceApi = typeof import("@vladmandic/face-api");
type Papel = "fotografo" | "convidado";

const PESOS = "/modelos-rosto";

/**
 * Lado maior da imagem em que o fotógrafo mede.
 *
 * Não é o original inteiro, e não é a prévia de 2048. A rede de reconhecimento
 * reduz cada rosto a 150×150 antes de medir, então rosto acima de ~150 px não
 * melhora mais; o que importa é o rosto PEQUENO ter pixels suficientes — e
 * 4096 dá o dobro da prévia para ele. Acima disso só cresce a textura que sobe
 * para a placa de vídeo.
 */
const LADO_MEDICAO = 4096;
/** A selfie: um rosto só, grande. 1024 sobra. */
const LADO_SELFIE = 1024;

let modulo: Promise<FaceApi> | null = null;
let backendAtivo = "";

async function faceapi(): Promise<FaceApi> {
  modulo ??= (async () => {
    const fa = await import("@vladmandic/face-api");
    const tf = fa.tf as unknown as {
      setBackend: (n: string) => Promise<boolean>;
      ready: () => Promise<void>;
      getBackend: () => string;
    };
    /*
     * `setBackend` devolve false sem lançar quando o backend não liga —
     * placa sem `OES_texture_float`, por exemplo. Sem esta volta, o tfjs cai
     * no `cpu` em silêncio e cada foto passa a custar 12 s em vez de 1 s.
     */
    for (const nome of ["webgl", "wasm", "cpu"]) {
      try {
        if (await tf.setBackend(nome)) {
          await tf.ready();
          if (tf.getBackend() === nome) break;
        }
      } catch {
        /* tenta o próximo */
      }
    }
    backendAtivo = tf.getBackend();
    return fa;
  })();
  return modulo;
}

/** "webgl" quando há placa; "cpu" quando não. Serve para avisar o tempo esperado. */
export function backendEmUso(): string {
  return backendAtivo;
}

/** Baixa e prepara os modelos do papel. Chamar de novo não baixa de novo. */
export async function carregarModelos(papel: Papel): Promise<void> {
  const fa = await faceapi();
  const nets = fa.nets;
  const pendentes: Promise<unknown>[] = [];
  if (papel === "fotografo" && !nets.ssdMobilenetv1.isLoaded) {
    pendentes.push(nets.ssdMobilenetv1.loadFromUri(PESOS));
  }
  if (papel === "convidado" && !nets.tinyFaceDetector.isLoaded) {
    pendentes.push(nets.tinyFaceDetector.loadFromUri(PESOS));
  }
  if (!nets.faceLandmark68Net.isLoaded) pendentes.push(nets.faceLandmark68Net.loadFromUri(PESOS));
  if (!nets.faceRecognitionNet.isLoaded) pendentes.push(nets.faceRecognitionNet.loadFromUri(PESOS));
  await Promise.all(pendentes);
}

export interface RostoMedido {
  /** Onde na imagem, em fração (0..1) — vale em qualquer resolução. */
  caixa: { x: number; y: number; w: number; h: number };
  /** Largura do rosto na imagem medida, em pixels. É o que o piso compara. */
  px: number;
  vetor: number[];
}

function emCanvas(fonte: ImageBitmap | HTMLImageElement, lado: number): HTMLCanvasElement {
  const escala = Math.min(1, lado / Math.max(fonte.width, fonte.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(fonte.width * escala));
  c.height = Math.max(1, Math.round(fonte.height * escala));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas indisponível");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fonte, 0, 0, c.width, c.height);
  return c;
}

/**
 * Todos os rostos aproveitáveis de uma foto — o que o fotógrafo guarda.
 *
 * Recebe o bitmap que o envio já decodificou para gerar as derivadas: a foto
 * não é aberta duas vezes. Rostos abaixo do piso saem aqui, e saem de novo no
 * servidor, que não confia neste filtro.
 */
export async function medirRostos(fonte: ImageBitmap): Promise<RostoMedido[]> {
  const fa = await faceapi();
  const tela = emCanvas(fonte, LADO_MEDICAO);

  const achados = await fa
    .detectAllFaces(tela, new fa.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  const rostos = achados
    .map((a) => {
      const b = a.detection.box;
      return {
        caixa: {
          x: Math.max(0, b.x / tela.width),
          y: Math.max(0, b.y / tela.height),
          w: Math.min(1, b.width / tela.width),
          h: Math.min(1, b.height / tela.height),
        },
        px: Math.round(b.width),
        vetor: Array.from(a.descriptor),
      };
    })
    .filter((r) => r.px >= PISO_ROSTO_PX && r.vetor.length === TAMANHO_VETOR)
    .sort((a, b) => b.px - a.px)
    .slice(0, MAX_ROSTOS_POR_FOTO);

  return rostos;
}

export type ResultadoSelfie =
  | { ok: true; vetores: number[][]; px: number }
  | { ok: false; motivo: "sem-rosto" | "rosto-pequeno" | "arquivo" };

/**
 * A selfie do convidado vira DOIS vetores: o dela e o do espelho dela.
 *
 * Câmera frontal grava espelhado por padrão, e espelhar custa até 0,550 de
 * distância — mais que qualquer outra deformação medida. Mandar os dois e
 * deixar o servidor ficar com o menor resolve sem precisar adivinhar de que
 * lado a câmera gravou.
 *
 * A imagem não sai deste aparelho. Só os números voltam daqui.
 */
export async function medirSelfie(arquivo: File): Promise<ResultadoSelfie> {
  let bitmap: ImageBitmap;
  try {
    // from-image respeita a orientação EXIF: selfie de celular não vira deitada.
    bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, motivo: "arquivo" };
  }

  try {
    const fa = await faceapi();
    const tela = emCanvas(bitmap, LADO_SELFIE);

    const maiorRosto = async (alvo: HTMLCanvasElement) => {
      const opcoes = fa.nets.ssdMobilenetv1.isLoaded
        ? new fa.SsdMobilenetv1Options({ minConfidence: 0.4 })
        : new fa.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });
      const todos = await fa.detectAllFaces(alvo, opcoes).withFaceLandmarks().withFaceDescriptors();
      return todos.sort((a, b) => b.detection.box.width - a.detection.box.width)[0] ?? null;
    };

    let rosto = await maiorRosto(tela);

    /*
     * O `tiny` não achou. Antes de desistir, vale o detector grande — são 5,6 MB
     * a mais, mas só para quem chegou até aqui com uma selfie que o pequeno
     * não leu (contraluz, óculos escuros, rosto virado).
     */
    if (!rosto && !fa.nets.ssdMobilenetv1.isLoaded) {
      await fa.nets.ssdMobilenetv1.loadFromUri(PESOS);
      rosto = await maiorRosto(tela);
    }
    if (!rosto) return { ok: false, motivo: "sem-rosto" };

    const px = Math.round(rosto.detection.box.width);
    if (px < PISO_ROSTO_PX) return { ok: false, motivo: "rosto-pequeno" };

    const espelho = document.createElement("canvas");
    espelho.width = tela.width;
    espelho.height = tela.height;
    const ctx = espelho.getContext("2d")!;
    ctx.translate(tela.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(tela, 0, 0);
    const espelhado = await maiorRosto(espelho);

    const vetores = [Array.from(rosto.descriptor)];
    if (espelhado) vetores.push(Array.from(espelhado.descriptor));
    return { ok: true, vetores, px };
  } finally {
    bitmap.close();
  }
}
