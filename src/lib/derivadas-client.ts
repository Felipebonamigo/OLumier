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
import { reconhecerArquivo } from "./tipos-de-arquivo";

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
   * Só vídeo: a duração em segundos, lida do mesmo `<video>` que tira o
   * pôster — de graça, porque os metadados já estavam abertos. É o que o
   * formato Stream mostra no cartão do episódio (30/09/2026).
   */
  duracao?: number;
  /**
   * A medição dos rostos, JÁ EM ANDAMENTO. Só existe com a busca por rosto
   * ligada. É uma promessa, e não o resultado, de propósito: ela roda na placa
   * de vídeo enquanto o arquivo sobe pela rede — esperar aqui somaria um
   * segundo por foto que cabe inteiro debaixo do envio.
   */
  rostos?: Promise<RostoMedido[]>;
}

/*
 * ── A QUALIDADE DA MINIATURA, E POR QUE ELA MUDOU (16/09/2026) ────────────
 *
 * Felipe: "a miniatura, para usuários que usam granulação, está ficando bem
 * prejudicada a imagem".
 *
 * Grão é a coisa mais difícil que existe para um pipeline de miniatura, e o
 * nosso errava nas duas pontas:
 *
 *   A REDUÇÃO. `drawImage` de 6000 px direto para 640 pede ao navegador que
 *   resuma dez pixels em um. Em imagem lisa isso passa; em grão, os pontos
 *   caem entre as amostras e viram manchas — o padrão fino vira um chiado
 *   irregular, que é pior que grão nenhum. É aliasing, e a resposta clássica é
 *   reduzir PELA METADE de cada vez: cada passo mistura quatro pixels vizinhos,
 *   e o grão vira textura em vez de mancha.
 *
 *   A COMPRESSÃO. WebP joga fora a alta frequência primeiro, e grão é alta
 *   frequência pura. Em 0,82 uma foto granulada ganhava blocos lavados nas
 *   sombras — justamente onde o fotógrafo pôs o grão.
 *
 * A miniatura subiu para 0,86 e o preview para 0,90.
 *
 * ── O QUE ISSO CUSTA, MEDIDO ────────────────────────────────────────────
 *
 * Numa cena de 4000×2667 com detalhe e grão, reduzida para 640 e pesada no
 * próprio Chromium (16/09/2026):
 *
 *   sem grão      20,0 KB → 22,2 KB   (+11%)
 *   grão leve     19,9 KB → 22,4 KB   (+13%)
 *   grão forte    22,3 KB → 28,7 KB   (+29%)
 *
 * A redução por metades sai de graça: sozinha, ela move 19,9 KB para 19,9 KB e
 * 22,3 KB para 23,4 KB. Quem custa é a qualidade, e custa só onde há grão para
 * preservar — que é exatamente onde o Felipe reclamou.
 *
 * Treze por cento no caso comum é o preço de a galeria de quem trabalha com
 * grão parar de parecer mal comprimida. Quem não usa grão paga onze, e a
 * miniatura fica melhor do mesmo jeito.
 */
const QUALIDADE_THUMB = 0.86;
const QUALIDADE_PREVIEW = 0.9;

/**
 * Reduz pela metade até chegar perto do alvo, e só então ao tamanho exato.
 *
 * O laço para quando o próximo passo passaria do alvo — daí o `/ 2 >= alvo`.
 * Sem ele, uma foto de 700 px pedindo 640 faria uma volta inútil por 350 e
 * subiria de novo, que é perder nitidez para ganhar nada.
 */
async function redimensionar(bitmap: ImageBitmap, alvo: number, qualidade: number): Promise<Blob> {
  const escala = Math.min(1, alvo / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas indisponível");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  /* `origem` é o que será desenhado no passo seguinte: o bitmap no primeiro, e
     o canvas intermediário daí em diante. */
  let origem: CanvasImageSource = bitmap;
  let larguraAtual = bitmap.width;
  let alturaAtual = bitmap.height;

  while (Math.max(larguraAtual, alturaAtual) / 2 >= Math.max(w, h)) {
    const meioW = Math.max(1, Math.round(larguraAtual / 2));
    const meioH = Math.max(1, Math.round(alturaAtual / 2));
    /* Um canvas por passo, e não o de saída: desenhar um canvas sobre si mesmo
       lê e escreve a mesma memória, e o resultado é indefinido. */
    const passo = document.createElement("canvas");
    passo.width = meioW;
    passo.height = meioH;
    const ctxPasso = passo.getContext("2d");
    if (!ctxPasso) break;
    ctxPasso.imageSmoothingEnabled = true;
    ctxPasso.imageSmoothingQuality = "high";
    ctxPasso.drawImage(origem, 0, 0, meioW, meioH);
    origem = passo;
    larguraAtual = meioW;
    alturaAtual = meioH;
  }

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(origem, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", qualidade));
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
/**
 * Os pontos do filme que valem uma tentativa, em ordem.
 *
 * Era um número só — o segundo 1 —, e ele é o certo para começar: um casamento
 * abre em movimento, e um segundo adiante já é imagem. Mas um vídeo que abre em
 * FADE tem o segundo 1 preto de verdade, e desistir ali entregaria "sem capa"
 * para um filme perfeitamente bom.
 *
 * Os dois seguintes são frações da duração, e não segundos fixos: 3 s não é
 * "mais adiante" num clipe de 4 s, é quase o fim.
 */
const SEGUNDOS_DO_POSTER = [1, 0.25, 0.5] as const;

/**
 * ESTE QUADRO TEM IMAGEM?
 *
 * ── O DEFEITO QUE ISTO EXISTE PARA MATAR (29/09/2026) ─────────────────────
 *
 * Baixando as 46 capas de vídeo de produção e comparando o conteúdo:
 * QUARENTA E UMA eram a mesma imagem, byte a byte — 4.195 B, PNG 360×640,
 * transparente —, em três estúdios diferentes. Só três eram capa de verdade.
 *
 * A capa existia, estava gravada, e era vazia. Ninguém descobriu por meses
 * porque a tela mostra um ladrilho, não um erro, e foi preciso o Juan mandar um
 * print para alguém olhar.
 *
 * A causa primeira era o Safari não honrar `createImageBitmap(<video>)`. Mas o
 * defeito que deixou isso virar quarenta e uma capas brancas foi outro: NADA
 * conferia o quadro antes de guardá-lo. Qualquer falha de decodificação, em
 * qualquer navegador, de qualquer codec, vira capa branca gravada como sucesso.
 * Por isso a conferência fica aqui, depois do desenho e antes de subir — ela
 * vale para a causa de ontem e para a de amanhã.
 *
 * ── POR QUE "COR CHAPADA", E NÃO "TRANSPARENTE" ──────────────────────────
 *
 * Transparente pegaria só o caso do Safari. Preto chapado (fade de abertura) e
 * branco chapado (tela de intro) são igualmente inúteis como capa: somem na
 * grade do mesmo jeito. E guardá-los impediria a tentativa no ponto seguinte.
 *
 * ── E POR QUE A TOLERÂNCIA ───────────────────────────────────────────────
 *
 * Um quadro preto REAL não é 0,0,0 em todo pixel: tem ±2 de ruído de
 * compressão. Uma comparação exata nunca recusaria nada, e a capa branca
 * voltaria pela porta dos fundos.
 */
const TOLERANCIA_CHAPADO = 6;

export function quadroTemImagem(dados: Uint8ClampedArray): boolean {
  if (dados.length < 4) return false;

  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0, maxA = 0;
  for (let i = 0; i < dados.length; i += 4) {
    const a = dados[i + 3];
    if (a > maxA) maxA = a;
    /* Pixel transparente não tem cor que valha comparar — o RGB embaixo dele é
       lixo indefinido, e incluí-lo inventaria variação onde não há nada. */
    if (a === 0) continue;
    const r = dados[i], g = dados[i + 1], b = dados[i + 2];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }

  if (maxA === 0) return false; // tudo transparente: o caso do Safari
  const variacao = Math.max(maxR - minR, maxG - minG, maxB - minB);
  return variacao > TOLERANCIA_CHAPADO;
}

async function quadroDoVideo(
  arquivo: File,
): Promise<{ bitmap: ImageBitmap; duracao: number | undefined } | null> {
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
    const duracaoReal = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : undefined;
    const duracao = duracaoReal ?? 2;

    /*
     * ── O QUADRO SAI DE UM CANVAS, E NÃO DO <video> (29/09/2026) ──────────
     *
     * Era `createImageBitmap(v)`, que lê o elemento direto. O Safari NÃO honra
     * isso: devolve um bitmap vazio, sem erro nenhum. Foi o que produziu as 41
     * capas transparentes de produção — todas geradas no iPhone, o que a
     * própria assinatura dos arquivos denuncia (são PNG sob chave `.webp`,
     * porque o Safari antigo também não codifica webp e cai para PNG calado).
     *
     * `drawImage` num canvas é o caminho antigo e universalmente suportado, e
     * tem outra virtude: de um canvas dá para LER os pixels e conferir se veio
     * alguma coisa. Do `<video>` não dava.
     */
    for (const ponto of SEGUNDOS_DO_POSTER) {
      const quando = ponto < 1 ? duracao * ponto : Math.min(ponto, duracao / 2);
      v.currentTime = Math.max(0, quando);
      await pronto("seeked");

      const w = v.videoWidth;
      const h = v.videoHeight;
      if (!w || !h) return null;

      const tela = document.createElement("canvas");
      tela.width = w;
      tela.height = h;
      const ctx = tela.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(v, 0, 0, w, h);

      /*
       * A conferência lê uma MINIATURA do quadro, e não os 8,3 milhões de
       * pixels de um 4K: `getImageData` de uma tela cheia custa dezenas de MB e
       * um engasgo visível no celular. 32×32 é amostra de sobra para separar
       * "chapado" de "tem imagem" — e é a mesma decisão de sempre, medir no
       * menor tamanho que ainda responde a pergunta.
       */
      const amostra = document.createElement("canvas");
      amostra.width = 32;
      amostra.height = 32;
      const ctxAmostra = amostra.getContext("2d", { willReadFrequently: true });
      if (!ctxAmostra) return null;
      ctxAmostra.drawImage(tela, 0, 0, 32, 32);
      if (!quadroTemImagem(ctxAmostra.getImageData(0, 0, 32, 32).data)) continue;

      return { bitmap: await createImageBitmap(tela), duracao: duracaoReal };
    }
    /* Nenhum dos pontos deu imagem. Devolver null é melhor do que devolver o
       vazio: sem miniatura a galeria cai no original, e o fotógrafo pode
       escolher a capa à mão. Com a capa branca gravada, ninguém nem sabia. */
    return null;
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
  /*
   * ── QUEM DECIDE O TIPO É `reconhecerArquivo`, E NÃO `File.type` (29/09/2026)
   *
   * Aqui estava `arquivo.type.startsWith("video/")`, e o `arquivo.type` vem
   * VAZIO com frequência: é o que o Windows dá para todo `.heic` (foi o que
   * derrubou 33 dos 74 envios da Carol, algumas horas antes) e o que muito
   * `.mov` compartilhado de outro aplicativo traz.
   *
   * Com o tipo vazio, o vídeo escapava do ramo dele, caía no
   * `if (!arquivo.type.startsWith("image/")) return null` logo abaixo e subia
   * SEM MINIATURA NENHUMA. Juan, com o print da galeria no iPhone: "os vídeos
   * não têm uma visualização, uma capa. Eles ficam assim" — dois retângulos
   * vazios com um botão de play no meio.
   *
   * O servidor já caía na extensão desde aquele dia. Faltava o navegador usar
   * a mesma regra, que agora mora em `lib/tipos-de-arquivo.ts` justamente para
   * os dois lados lerem dela.
   */
  const reconhecido = reconhecerArquivo(arquivo.name, arquivo.type);
  if (!reconhecido) return null;

  if (reconhecido.tipo === "video") {
    const quadro = await quadroDoVideo(arquivo);
    if (!quadro) return null;
    const { bitmap, duracao } = quadro;
    try {
      return {
        thumb: await redimensionar(bitmap, TAMANHO_THUMB, QUALIDADE_THUMB),
        preview: null,
        largura: bitmap.width,
        altura: bitmap.height,
        duracao,
      };
    } catch {
      return null;
    } finally {
      bitmap.close();
    }
  }

  try {
    // from-image respeita a orientação EXIF — foto de celular não vira deitada.
    const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    try {
      const [thumb, preview] = await Promise.all([
        redimensionar(bitmap, TAMANHO_THUMB, QUALIDADE_THUMB),
        redimensionar(bitmap, TAMANHO_PREVIEW, QUALIDADE_PREVIEW),
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
