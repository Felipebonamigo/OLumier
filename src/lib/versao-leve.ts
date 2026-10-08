/**
 * A VERSÃO LEVE DO VÍDEO — a que o cliente ASSISTE (08/10/2026).
 *
 * O que a galeria do Mirna e Diogo mostrou: 32 `.MOV` do iPhone em HEVC, de 13 a
 * 54 Mbps, tocados direto do original no Backblaze. HEVC não abre no Firefox nem
 * em boa parte dos Chrome de computador; 54 Mbps não passam num 4G. O player
 * abria e não andava.
 *
 * A saída é a de toda plataforma de vídeo: o original fica intacto para BAIXAR,
 * e uma cópia para ASSISTIR — H.264 (o formato que todo navegador abre), no
 * máximo 1080p, uns 5 Mbps, quadro-chave a cada 2 s (pular na linha do filme
 * fica rápido) e o índice na frente (`indice-na-frente.ts`). Um clipe de 1 min a
 * 54 Mbps cai de ~400 MB para ~38 MB.
 *
 * ── QUEM CONVERTE É O NAVEGADOR DO FOTÓGRAFO ──────────────────────────────
 *
 * A mesma regra das miniaturas: o servidor não toca no arquivo. Converter no VPS
 * exigiria baixar cada filme do Backblaze e ocupar a máquina que serve as
 * galerias; o computador do fotógrafo tem codificador de vídeo em hardware e
 * está ali, enviando. O custo para nós é só guardar a cópia no R2 — perto do
 * Brasil, sem taxa de saída —, e ela se paga: cada play deixa de puxar o
 * original do Backblaze, que cobra saída acima da franquia.
 *
 * ── QUANDO NÃO FAZ ────────────────────────────────────────────────────────
 *
 * Vídeo que já é H.264, até 1080p e até 10 Mbps toca bem como está: converter só
 * gastaria tempo do fotógrafo e espaço nosso (`precisaDeVersaoLeve`). E quando o
 * navegador do fotógrafo não abre o formato, ou não grava H.264, a resposta diz
 * isso em vez de fingir — o vídeo continua tocando o original, como antes.
 *
 * As funções puras (régua de decisão e de tamanho) não importam nada do
 * navegador e são testadas no Node; a conversão carrega a biblioteca
 * (`mediabunny`) sob demanda, só em quem converte.
 */

/** A caixa da versão leve: 1080p deitado ou em pé. */
export const LADO_MAIOR = 1920;
export const LADO_MENOR = 1080;
/** Bits por segundo em 1080p; resolução menor ganha proporcionalmente menos. */
export const BITS_1080P = 5_000_000;
/** Abaixo disso a imagem desmancha, por menor que seja o vídeo. */
export const BITS_MINIMO = 1_500_000;
/** Acima disso o original não passa numa conexão de celular comum. */
export const BITS_QUE_TOCA_BEM = 10_000_000;
/** Teto de um envio único ao R2 (o limite do S3 é 5 GB). ~2 h de filme. */
export const TAMANHO_MAXIMO = 4.5 * 1024 ** 3;

/** Erro nosso — a mensagem é para a tela, em português. */
export class ErroDaVersaoLeve extends Error {}

export interface DadosDoVideo {
  codec: string | null;
  largura: number;
  altura: number;
  bitsPorSegundo: number;
}

/** O original precisa de cópia para assistir? E por quê, em palavras. */
export function precisaDeVersaoLeve(v: DadosDoVideo): { precisa: boolean; motivo: string } {
  if (v.codec !== "avc") {
    const nome = v.codec === "hevc" ? "HEVC" : (v.codec ?? "desconhecido").toUpperCase();
    return { precisa: true, motivo: `formato ${nome}, que nem todo navegador abre` };
  }
  if (Math.max(v.largura, v.altura) > LADO_MAIOR || Math.min(v.largura, v.altura) > LADO_MENOR) {
    return { precisa: true, motivo: `resolução ${v.largura}×${v.altura}, acima de 1080p` };
  }
  if (v.bitsPorSegundo > BITS_QUE_TOCA_BEM) {
    const mbps = Math.round(v.bitsPorSegundo / 1e6);
    return { precisa: true, motivo: `${mbps} Mbps, pesado demais para assistir no celular` };
  }
  return { precisa: false, motivo: "já é H.264 leve" };
}

const par = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Cabe na caixa de 1080p sem deformar; codificador de vídeo pede lado par. */
export function tamanhoDaVersaoLeve(largura: number, altura: number): { largura: number; altura: number } {
  const deitado = largura >= altura;
  const caixaL = deitado ? LADO_MAIOR : LADO_MENOR;
  const caixaA = deitado ? LADO_MENOR : LADO_MAIOR;
  const escala = Math.min(1, caixaL / largura, caixaA / altura);
  return { largura: par(largura * escala), altura: par(altura * escala) };
}

export function bitsDaVersaoLeve(largura: number, altura: number): number {
  return Math.max(BITS_MINIMO, Math.round((BITS_1080P * largura * altura) / (LADO_MAIOR * LADO_MENOR)));
}

export type ResultadoDaVersaoLeve =
  | { estado: "pronta"; blob: Blob; largura: number; altura: number; duracao: number; motivo: string }
  | { estado: "dispensada"; motivo: string }
  | { estado: "impossivel"; motivo: string };

/**
 * Onde a conversão escreve: um `Blob` montado por partes.
 *
 * O conversor escreve em sequência e, no fim, volta ao começo para acertar o
 * tamanho da caixa de quadros. As partes do começo ficam em memória (é ali que o
 * acerto cai); o resto vira `Blob`, que o navegador pode guardar em disco — um
 * filme de uma hora não precisa caber na RAM.
 */
function gravadorEmBlob() {
  const EM_MEMORIA = 32 * 1024 * 1024;
  const partes: (Uint8Array | Blob)[] = [];
  const inicios: number[] = [];
  let total = 0;
  const writable = new WritableStream<{ type: "write"; data: Uint8Array; position: number }>({
    write({ data, position }) {
      if (position === total) {
        inicios.push(total);
        partes.push(total < EM_MEMORIA ? data.slice() : new Blob([data.slice()]));
        total += data.byteLength;
        return;
      }
      if (position + data.byteLength > total) throw new ErroDaVersaoLeve("escrita fora de ordem na versão leve");
      /* Acerto de algo já escrito: só pode cair nas partes em memória. */
      let feito = 0;
      for (let i = 0; i < partes.length && feito < data.byteLength; i++) {
        const ini = inicios[i];
        const parte = partes[i];
        const fim = ini + (parte instanceof Blob ? parte.size : parte.byteLength);
        const de = position + feito;
        if (de < ini || de >= fim) continue;
        if (parte instanceof Blob) throw new ErroDaVersaoLeve("acerto fora da parte em memória");
        const n = Math.min(fim - de, data.byteLength - feito);
        parte.set(data.subarray(feito, feito + n), de - ini);
        feito += n;
      }
    },
  });
  return { writable, blob: () => new Blob(partes as BlobPart[], { type: "video/mp4" }) };
}

/**
 * Converte o original numa versão leve. `fonte` é o arquivo que o fotógrafo
 * escolheu (no envio) ou a URL assinada do original (no painel, para vídeo já
 * enviado). `bytes` é o tamanho do original quando a fonte é URL.
 */
export async function gerarVersaoLeve(
  fonte: Blob | string,
  opcoes: { bytes?: number; aoProgresso?: (fracao: number) => void; sinal?: AbortSignal } = {},
): Promise<ResultadoDaVersaoLeve> {
  const mb = await import("mediabunny");
  const input = new mb.Input({
    source: typeof fonte === "string" ? new mb.UrlSource(fonte) : new mb.BlobSource(fonte),
    formats: mb.ALL_FORMATS,
  });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) return { estado: "impossivel", motivo: "o arquivo não tem imagem de vídeo" };
    const audio = await input.getPrimaryAudioTrack();

    const duracao =
      (await input.getDurationFromMetadata().catch(() => null)) ?? (await input.computeDuration());
    const bytes = typeof fonte === "string" ? (opcoes.bytes ?? 0) : fonte.size;
    const dados: DadosDoVideo = {
      codec: video.codec,
      largura: video.displayWidth,
      altura: video.displayHeight,
      bitsPorSegundo: duracao > 0 ? (bytes * 8) / duracao : 0,
    };
    const decisao = precisaDeVersaoLeve(dados);
    if (!decisao.precisa) return { estado: "dispensada", motivo: decisao.motivo };

    if (!(await video.canDecode())) {
      return {
        estado: "impossivel",
        motivo:
          video.codec === "hevc"
            ? "este navegador não abre HEVC — no Safari, ou no Chrome do Mac, ele abre"
            : "este navegador não abre o formato deste vídeo",
      };
    }
    const alvo = tamanhoDaVersaoLeve(dados.largura, dados.altura);
    const bits = bitsDaVersaoLeve(alvo.largura, alvo.altura);
    if (!(await mb.canEncodeVideo("avc", { width: alvo.largura, height: alvo.altura, bitrate: bits }))) {
      return { estado: "impossivel", motivo: "este navegador não grava vídeo H.264" };
    }
    if (duracao > 0 && (bits / 8) * duracao > TAMANHO_MAXIMO) {
      return { estado: "impossivel", motivo: "o filme é longo demais para a versão leve (mais de ~2 h)" };
    }

    const gravador = gravadorEmBlob();
    const output = new mb.Output({
      /* Índice no fim, escrito em sequência; quem o põe na frente é
         `indiceNaFrente`, sem guardar o filme na memória. */
      format: new mb.Mp4OutputFormat({ fastStart: false }),
      target: new mb.StreamTarget(gravador.writable, { chunked: true }),
    });
    const conversao = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: {
        codec: "avc",
        width: alvo.largura,
        height: alvo.altura,
        fit: "fill",
        quality: new mb.Quality({ bitrate: bits }),
        keyFrameInterval: 2,
        forceTranscode: true,
      },
      /* AAC do celular é copiado como está; outro formato vira AAC. */
      audio: { codec: "aac" },
      showWarnings: false,
    });
    /*
     * A conversão "válida" pode ter jogado fora uma faixa: sem imagem ela segue
     * válida com o som só, e sem som, com a imagem só. Nenhuma das duas é a
     * versão leve do filme — é outro filme. O motivo vai junto, para a tela.
     */
    const motivoDoDescarte = (tipo: "video" | "audio") =>
      conversao.discardedTracks.find((d) => d.track.type === tipo)?.reason ?? "desconhecido";
    if (!conversao.isValid || !conversao.utilizedTracks.some((t) => t.isVideoTrack())) {
      return {
        estado: "impossivel",
        motivo: `este navegador não consegue converter a imagem deste vídeo (${motivoDoDescarte("video")})`,
      };
    }
    if (audio && !conversao.utilizedTracks.some((t) => t.isAudioTrack())) {
      return {
        estado: "impossivel",
        motivo: `este navegador não consegue converter o som deste vídeo (${motivoDoDescarte("audio")})`,
      };
    }

    conversao.onProgress = (p) => opcoes.aoProgresso?.(p);
    const cancelar = () => void conversao.cancel();
    opcoes.sinal?.addEventListener("abort", cancelar, { once: true });
    try {
      await conversao.execute();
    } finally {
      opcoes.sinal?.removeEventListener("abort", cancelar);
    }

    const blob = await (await import("./indice-na-frente")).indiceNaFrente(gravador.blob(), "video/mp4");
    if (bytes > 0 && blob.size >= bytes * 0.9) {
      return { estado: "dispensada", motivo: "a cópia não ficou mais leve que o original" };
    }
    return { estado: "pronta", blob, largura: alvo.largura, altura: alvo.altura, duracao, motivo: decisao.motivo };
  } finally {
    input.dispose();
  }
}

/**
 * Sobe a versão leve e a liga à mídia. As duas chamadas da rota de reprodução
 * no mesmo molde da capa: pede o endereço, envia, confirma — e quem grava a
 * coluna é o servidor, depois de conferir o que chegou.
 */
export async function enviarVersaoLeve(
  mediaId: string,
  r: Extract<ResultadoDaVersaoLeve, { estado: "pronta" }>,
): Promise<void> {
  /* Queda de rede vira "o envio falhou", não "a conversão parou": a conversão
     terminou, o que caiu foi o caminho até o armazém. */
  const semRede = () => null;
  const pedido = await fetch(`/api/medias/${mediaId}/reproducao`, { method: "POST" }).catch(semRede);
  if (!pedido) throw new ErroDaVersaoLeve("o envio da versão leve falhou (sem conexão)");
  if (!pedido.ok) throw new ErroDaVersaoLeve((await pedido.json().catch(() => ({}))).erro ?? "não deu para preparar o envio");
  const { url } = (await pedido.json()) as { url: string };
  const subida = await fetch(url, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: r.blob }).catch(
    semRede,
  );
  if (!subida?.ok) throw new ErroDaVersaoLeve("o envio da versão leve falhou");
  const confirma = await fetch(`/api/medias/${mediaId}/reproducao`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ largura: r.largura, altura: r.altura, duracao: r.duracao }),
  }).catch(semRede);
  if (!confirma) throw new ErroDaVersaoLeve("o envio da versão leve falhou (sem conexão)");
  if (!confirma.ok) throw new ErroDaVersaoLeve((await confirma.json().catch(() => ({}))).erro ?? "a versão leve não foi aceita");
}

/**
 * A CAPA, TIRADA DA VERSÃO LEVE — para o vídeo que ficou sem nenhuma.
 *
 * Quatro dos 32 vídeos do Mirna e Diogo subiram sem capa: o navegador de quem
 * enviou não abriu o HEVC para tirar o quadro. A versão leve é H.264, que todo
 * navegador abre — então, uma vez convertida, ela dá a capa que faltava. Tenta
 * 1 s, um quarto e metade do filme, e pula quadro chapado (preto ou branco), a
 * mesma régua da capa do envio (`quadroTemImagem`).
 */
async function capaDaVersaoLeve(
  blob: Blob,
  duracao: number,
): Promise<{ imagem: Blob; largura: number; altura: number } | null> {
  const mb = await import("mediabunny");
  const { quadroTemImagem, TAMANHO_THUMB } = await import("./derivadas-client");
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) return null;
    const escala = Math.min(1, TAMANHO_THUMB / Math.max(video.displayWidth, video.displayHeight));
    const largura = Math.max(2, Math.round(video.displayWidth * escala));
    const altura = Math.max(2, Math.round(video.displayHeight * escala));
    const sink = new mb.CanvasSink(video, { width: largura, height: altura, fit: "fill" });
    for (const t of [Math.min(1, duracao / 2), duracao / 4, duracao / 2]) {
      const quadro = await sink.getCanvas(t);
      if (!quadro) continue;
      const tela = quadro.canvas;
      const ctx = tela.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx || !quadroTemImagem(ctx.getImageData(0, 0, largura, altura).data)) continue;
      const imagem =
        tela instanceof OffscreenCanvas
          ? await tela.convertToBlob({ type: "image/webp", quality: 0.82 })
          : await new Promise<Blob | null>((ok) => tela.toBlob(ok, "image/webp", 0.82));
      if (imagem) return { imagem, largura: video.displayWidth, altura: video.displayHeight };
    }
    return null;
  } finally {
    input.dispose();
  }
}

/** Sobe a capa pela mesma rota da capa escolhida à mão (`/poster`). */
async function enviarCapa(mediaId: string, capa: { imagem: Blob; largura: number; altura: number }, duracao: number) {
  const pedido = await fetch(`/api/medias/${mediaId}/poster`, { method: "POST" });
  if (!pedido.ok) return;
  const { url, mime } = (await pedido.json()) as { url: string; mime: string };
  const subida = await fetch(url, { method: "PUT", headers: { "Content-Type": mime }, body: capa.imagem });
  if (!subida.ok) return;
  await fetch(`/api/medias/${mediaId}/poster`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ largura: capa.largura, altura: capa.altura, duracao }),
  });
}

/**
 * Converter e enviar, para quem só quer o resultado em palavras. `semCapa`
 * aproveita a versão leve para dar capa ao vídeo que não tem — e é melhor
 * esforço: se a capa não sair, a versão leve continua valendo.
 */
export async function prepararVideoParaAssistir(
  mediaId: string,
  fonte: Blob | string,
  opcoes: {
    bytes?: number;
    semCapa?: boolean;
    aoProgresso?: (fracao: number) => void;
    sinal?: AbortSignal;
  } = {},
): Promise<{ estado: ResultadoDaVersaoLeve["estado"] | "falhou"; motivo: string }> {
  try {
    const r = await gerarVersaoLeve(fonte, opcoes);
    if (r.estado !== "pronta") return r;
    await enviarVersaoLeve(mediaId, r);
    if (opcoes.semCapa) {
      const capa = await capaDaVersaoLeve(r.blob, r.duracao).catch(() => null);
      if (capa) await enviarCapa(mediaId, capa, r.duracao).catch(() => {});
    }
    return { estado: "pronta", motivo: r.motivo };
  } catch (e) {
    if (opcoes.sinal?.aborted) return { estado: "falhou", motivo: "cancelado" };
    /* A mensagem da biblioteca é em inglês e técnica; a tela diz o que houve,
       e o detalhe fica no console para quem for investigar. As nossas (rota,
       envio, índice) já são em português e passam como estão. */
    console.warn("versão leve:", e);
    const { ErroDoIndice } = await import("./indice-na-frente");
    const nossa = e instanceof ErroDaVersaoLeve || e instanceof ErroDoIndice;
    return { estado: "falhou", motivo: nossa ? e.message : "a conversão parou no meio" };
  }
}
