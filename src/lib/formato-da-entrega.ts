import type { Formato } from "@/config/aparencia";

/**
 * QUE TELA O CLIENTE VÊ — a galeria, as pastas ou o stream.
 *
 * O formato é o que o fotógrafo escolheu (ver `Formato` em
 * `config/aparencia.ts`). A tela é o que dá para mostrar COM O QUE A GALERIA
 * TEM, e as duas não são sempre a mesma coisa:
 *
 *   pastas com um grupo só      uma pasta sozinha é um clique a mais para
 *                               chegar nas mesmas fotos → galeria
 *   stream sem vídeo nenhum     uma tela de cinema para mostrar nada → galeria
 *
 * O fotógrafo costuma escolher o formato ANTES de subir o casamento, e a
 * escolha não pode quebrar a entrega no meio do caminho: ela passa a valer
 * sozinha no instante em que o segundo capítulo (ou o primeiro vídeo) chega.
 * O editor avisa enquanto isso — ver `SeletorDeFormato`.
 *
 * E há pedidos que sempre abrem a galeria, qualquer que seja o formato:
 *
 *   um capítulo aberto   nas pastas, é ENTRAR na pasta; no stream, é o link
 *                        de capítulo que alguém já mandou antes do formato
 *                        mudar — link mandado não quebra
 *   `?fotos=`            o resultado da busca por rosto: são fotos, e a
 *                        resposta a "onde eu apareço" é a grade
 *   `?ver=galeria`       o "Ver as fotos" do stream
 *
 * Mora aqui, e não na página, porque é a decisão que um teste precisa prender
 * sem subir servidor: `scripts/testar-formato-da-entrega.mjs`.
 */
export type TelaDaEntrega = "galeria" | "pastas" | "stream";

export interface ConteudoParaFormato {
  /** Grupos com arquivo: cada capítulo com algo dentro, mais as soltas. */
  grupos: number;
  videos: number;
}

export interface PedidoDaTela {
  capituloAberto: boolean;
  recorte: boolean;
  verGaleria: boolean;
}

export function telaDaEntrega(
  formato: Formato,
  conteudo: ConteudoParaFormato,
  pedido: PedidoDaTela,
): TelaDaEntrega {
  if (formato === "galeria") return "galeria";
  if (pedido.capituloAberto || pedido.recorte || pedido.verGaleria) return "galeria";
  if (formato === "pastas") return conteudo.grupos >= 2 ? "pastas" : "galeria";
  return conteudo.videos > 0 ? "stream" : "galeria";
}

/**
 * De onde a galeria que está na tela VEIO — para o caminho de volta.
 *
 *   pastas   dentro de uma pasta: "← Todas as pastas"
 *   stream   no "Ver as fotos": "← Voltar aos vídeos"
 *   null     a galeria é o formato; não há para onde voltar
 *
 * Mesma régua de `telaDaEntrega`: a volta só existe quando a tela de onde se
 * veio existiria.
 */
export function voltaDaGaleria(
  formato: Formato,
  conteudo: ConteudoParaFormato,
  pedido: PedidoDaTela,
): "pastas" | "stream" | null {
  if (pedido.recorte) return null;
  if (formato === "pastas" && pedido.capituloAberto && conteudo.grupos >= 2) return "pastas";
  if (formato === "stream" && pedido.verGaleria && conteudo.videos > 0) return "stream";
  return null;
}

/**
 * O nome do episódio, a partir do nome do arquivo.
 *
 * O filmmaker exporta "02_Filme_Casamento_Ana_e_Pedro_4K.mp4". Na tela de
 * cinema isso vira "Filme Casamento Ana e Pedro 4K" — sem extensão, sem
 * sublinhado, e sem o número de ordenação da frente, que já aparece como o
 * número do episódio ao lado. O arquivo baixado continua com o nome original.
 *
 * Mesma regra de número da frente de `lib/capitulos-pasta.ts`: o número só sai
 * quando termina em separador, para "2026 Casamento" continuar sendo o nome.
 */
export function tituloDoEpisodio(nomeOriginal: string): string {
  const semExtensao = nomeOriginal.replace(/\.[a-z0-9]{2,4}$/i, "");
  const espacado = semExtensao.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  const m = /^(\d{1,3})(?:\s*[-._)]+\s*|\s+)(.+)$/.exec(espacado);
  const titulo = m ? m[2].trim() : espacado;
  return titulo || nomeOriginal;
}

/**
 * Duração como se diz: "1h 12min", "8min", "45s". Null quando não se sabe —
 * vídeo enviado antes de 30/09/2026 não tem a duração gravada, e o cartão
 * simplesmente não mostra, em vez de mostrar "0min".
 */
export function duracaoLegivel(segundos: number | null | undefined): string | null {
  if (!segundos || !Number.isFinite(segundos) || segundos <= 0) return null;
  const s = Math.round(segundos);
  if (s < 60) return `${s}s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h}h ${resto}min` : `${h}h`;
}

/** O relógio do player: "4:07", "1:02:33". */
export function relogio(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Onde a pessoa parou num vídeo, e se vale retomar dali.
 *
 * Os dez primeiros segundos não contam como "começou" (quem abriu e fechou
 * não quer ser jogado no segundo 6), e os últimos vinte contam como "viu":
 * são os créditos e o logo do estúdio, e retomar ali seria abrir o filme no
 * fim. Nos dois casos o filme abre do começo.
 */
export function pontoDeRetomada(tempo: number, duracao: number): number {
  if (!Number.isFinite(tempo) || !Number.isFinite(duracao) || duracao <= 0) return 0;
  if (tempo < 10) return 0;
  if (tempo > duracao - 20) return 0;
  return tempo;
}

/** Fração assistida para a barrinha do cartão: 0 quando não há o que mostrar. */
export function fracaoAssistida(tempo: number, duracao: number): number {
  if (!Number.isFinite(tempo) || !Number.isFinite(duracao) || duracao <= 0) return 0;
  return Math.min(1, Math.max(0, tempo / duracao));
}
