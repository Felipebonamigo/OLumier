import {
  TIPO_DO_CLIPE,
  TIPO_DO_POSTER_DO_CLIPE,
  bitsDoClipe,
  recusaDaDuracao,
  recusaDoClipe,
  tamanhoDoClipe,
} from "./clipe-da-capa-regras";

/**
 * PREPARAR E ENVIAR O CLIPE DA CAPA — no navegador do fotógrafo (08/10/2026).
 *
 * Juan: "adicionar opção de subir capa em VÍDEO no formato Stream". O arquivo
 * que o fotógrafo escolhe é o do CapCut, do celular, da câmera: H.264 ou HEVC,
 * 1080p ou 4K, com som, de poucos segundos ou de uma hora. Nada disso serve para
 * rodar mudo e em laço no fundo da capa de quem está no 4G.
 *
 * Então o navegador dele REFAZ o arquivo antes de subir — a mesma arquitetura da
 * versão leve (`versao-leve.ts`): o servidor nunca toca no vídeo.
 *
 *   · H.264 em MP4, o que todo navegador abre;
 *   · no máximo 720p, ~2,5 Mbps (30 s pesam menos de 10 MB);
 *   · SEM som — autoplay só é permitido mudo, e a faixa de áudio seria peso morto;
 *   · índice na frente (`fastStart: "in-memory"`): clipe de 10 MB cabe na memória,
 *     e o player começa sem esperar o fim do arquivo;
 *   · o primeiro quadro em JPEG, que fica no lugar até o clipe começar.
 *
 * Sempre refaz, mesmo quando o arquivo já parece bom: tirar o som e limitar o
 * tamanho é parte do que a capa precisa ser, e "já é H.264" não diz nada sobre
 * nenhuma das duas.
 *
 * A biblioteca (`mediabunny`) carrega sob demanda, só em quem converte.
 */

/** Erro nosso — a mensagem é para a tela, em português. */
export class ErroDoClipe extends Error {}

export interface ClipePronto {
  clipe: Blob;
  quadro: Blob;
  largura: number;
  altura: number;
  duracao: number;
}

export async function prepararClipe(
  arquivo: Blob,
  opcoes: { aoProgresso?: (fracao: number) => void; sinal?: AbortSignal } = {},
): Promise<ClipePronto> {
  const mb = await import("mediabunny");
  const entrada = new mb.Input({ source: new mb.BlobSource(arquivo), formats: mb.ALL_FORMATS });
  try {
    const video = await entrada.getPrimaryVideoTrack().catch(() => null);
    if (!video) throw new ErroDoClipe("Este arquivo não tem imagem de vídeo. Escolha um MP4 ou MOV.");

    const duracao =
      (await entrada.getDurationFromMetadata().catch(() => null)) ?? (await entrada.computeDuration());
    const longo = recusaDaDuracao(duracao);
    if (longo) throw new ErroDoClipe(longo);

    if (!(await video.canDecode())) {
      throw new ErroDoClipe(
        video.codec === "hevc"
          ? "Este navegador não abre vídeo em HEVC (comum em vídeo de iPhone). No Safari, ou no Chrome do Mac, ele abre — ou exporte o clipe em H.264 no CapCut."
          : "Este navegador não abre o formato deste vídeo. Exporte em MP4 (H.264) e tente de novo.",
      );
    }

    const alvo = tamanhoDoClipe(video.displayWidth, video.displayHeight);
    const bits = bitsDoClipe(alvo.largura, alvo.altura);
    if (!(await mb.canEncodeVideo("avc", { width: alvo.largura, height: alvo.altura, bitrate: bits }))) {
      throw new ErroDoClipe("Este navegador não grava vídeo H.264. Tente no Chrome, no Edge ou no Safari.");
    }

    const destino = new mb.BufferTarget();
    const saida = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: destino });
    const conversao = await mb.Conversion.init({
      input: entrada,
      output: saida,
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
      audio: { discard: true },
      showWarnings: false,
    });
    if (!conversao.isValid || !conversao.utilizedTracks.some((t) => t.isVideoTrack())) {
      const motivo = conversao.discardedTracks.find((d) => d.track.type === "video")?.reason ?? "desconhecido";
      throw new ErroDoClipe(`Este navegador não conseguiu converter a imagem deste vídeo (${motivo}).`);
    }

    conversao.onProgress = (p) => opcoes.aoProgresso?.(p);
    const cancelar = () => void conversao.cancel();
    opcoes.sinal?.addEventListener("abort", cancelar, { once: true });
    try {
      await conversao.execute();
    } finally {
      opcoes.sinal?.removeEventListener("abort", cancelar);
    }
    if (!destino.buffer) throw new ErroDoClipe("A conversão terminou sem gerar o arquivo. Tente de novo.");
    const clipe = new Blob([destino.buffer], { type: TIPO_DO_CLIPE });

    /* O servidor recusaria, mas dizer aqui poupa o envio inteiro. */
    const pesado = recusaDoClipe(TIPO_DO_CLIPE, clipe.size);
    if (pesado) throw new ErroDoClipe(pesado);

    const quadro = await primeiroQuadro(clipe, alvo.largura, alvo.altura);
    return { clipe, quadro, largura: alvo.largura, altura: alvo.altura, duracao };
  } finally {
    entrada.dispose();
  }
}

/** O primeiro quadro do clipe JÁ PRONTO, em JPEG — o mesmo que o player vai mostrar ao começar. */
async function primeiroQuadro(clipe: Blob, largura: number, altura: number): Promise<Blob> {
  const mb = await import("mediabunny");
  const entrada = new mb.Input({ source: new mb.BlobSource(clipe), formats: mb.ALL_FORMATS });
  try {
    const video = await entrada.getPrimaryVideoTrack();
    if (!video) throw new ErroDoClipe("O clipe gerado não tem imagem.");
    const sink = new mb.CanvasSink(video, { width: largura, height: altura, fit: "fill" });
    const t0 = await video.getFirstTimestamp();
    const quadro = await sink.getCanvas(t0);
    if (!quadro) throw new ErroDoClipe("Não consegui tirar o primeiro quadro do clipe.");
    const tela = quadro.canvas;
    /* JPEG de propósito (e não WebP): o Safari devolve PNG quando se pede WebP,
       e a assinatura do envio é por tipo. */
    const imagem =
      tela instanceof OffscreenCanvas
        ? await tela.convertToBlob({ type: TIPO_DO_POSTER_DO_CLIPE, quality: 0.82 })
        : await new Promise<Blob | null>((ok) => tela.toBlob(ok, TIPO_DO_POSTER_DO_CLIPE, 0.82));
    if (!imagem || imagem.type !== TIPO_DO_POSTER_DO_CLIPE) {
      throw new ErroDoClipe("Este navegador não gerou o primeiro quadro em JPG.");
    }
    return imagem;
  } finally {
    entrada.dispose();
  }
}

/**
 * Sobe o clipe e o quadro e liga os dois à galeria: pede os endereços, envia
 * direto ao bucket, e quem grava a coluna é o servidor, depois de conferir o que
 * chegou — o mesmo molde da capa em imagem.
 */
export async function enviarClipeDaCapa(galeriaId: string, pronto: ClipePronto): Promise<void> {
  const rota = `/api/galerias/${galeriaId}/capa-video`;
  /* Queda de rede vira "o envio falhou", e não um erro cru do navegador. */
  const semRede = () => null;

  const pedido = await fetch(rota, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bytes: pronto.clipe.size, posterBytes: pronto.quadro.size }),
  }).catch(semRede);
  if (!pedido) throw new ErroDoClipe("O envio falhou (sem conexão).");
  if (!pedido.ok) throw new ErroDoClipe((await pedido.json().catch(() => ({}))).erro ?? "Não deu para preparar o envio.");
  const { url, chave, posterUrl, posterChave } = (await pedido.json()) as {
    url: string;
    chave: string;
    posterUrl: string;
    posterChave: string;
  };

  /* O quadro primeiro: é pequeno, e se ele falhar o clipe nem começa a subir. */
  const subidaDoQuadro = await fetch(posterUrl, {
    method: "PUT",
    headers: { "Content-Type": TIPO_DO_POSTER_DO_CLIPE },
    body: pronto.quadro,
  }).catch(semRede);
  if (!subidaDoQuadro?.ok) throw new ErroDoClipe("O envio do primeiro quadro falhou.");
  const subida = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": TIPO_DO_CLIPE },
    body: pronto.clipe,
  }).catch(semRede);
  if (!subida?.ok) throw new ErroDoClipe("O envio do clipe falhou.");

  const confirma = await fetch(rota, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chave, posterChave }),
  }).catch(semRede);
  if (!confirma) throw new ErroDoClipe("O envio falhou (sem conexão).");
  if (!confirma.ok) throw new ErroDoClipe((await confirma.json().catch(() => ({}))).erro ?? "O clipe não foi aceito.");
}

/** Tira o clipe da capa. */
export async function tirarClipeDaCapa(galeriaId: string): Promise<void> {
  const r = await fetch(`/api/galerias/${galeriaId}/capa-video`, { method: "DELETE" }).catch(() => null);
  if (!r?.ok) throw new ErroDoClipe("Não consegui tirar o clipe. Tente de novo.");
}
