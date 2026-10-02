import "server-only";
import { armazemDe, urlDaDerivada } from "./armazem";
import { urlDeLeitura } from "./r2";

/**
 * QUAL MÍDIA É A CAPA, E QUE IMAGEM ELA DESENHA.
 *
 * Existia copiado em dois lugares — a página da galeria e o cartão do link
 * (`opengraph-image.tsx`) —, com o mesmo filtro `tipo === "foto"` escrito à mão
 * nos dois. Em 02/10/2026 o filme passou a poder ser capa, e as duas cópias
 * teriam de aprender a mesma regra nova; a que ficasse atrás entregaria um
 * cartão de WhatsApp diferente da galeria que ele abre.
 *
 * ── A REGRA ───────────────────────────────────────────────────────────────
 *
 * Juan pediu "capas de vídeo"; Felipe cortou para "só a capa principal, não a
 * capa das pastas". Então:
 *
 *   · foto vale sempre;
 *   · VÍDEO vale quando tem pôster — e a imagem é o pôster;
 *   · vídeo sem pôster não vale, porque não há o que mostrar.
 *
 * ── O BURACO QUE ISTO FECHA ───────────────────────────────────────────────
 *
 * `urlDaDerivada(chave_preview, chave, …)` cai no ORIGINAL quando não há
 * derivada, e vídeo não tem `chave_preview`. Aceitar vídeo sem tratar isso faria
 * a capa da galeria apontar para o .mp4 de 800 MB como se fosse imagem: o casal
 * veria um retângulo vazio e o estúdio pagaria a saída do arquivo inteiro a cada
 * abertura. É o motivo de a URL ser escolhida aqui, e não por quem desenha.
 */

export interface MediaParaCapa {
  id: string;
  tipo: string;
  chave: string;
  chave_preview?: string | null;
  chave_thumb?: string | null;
  armazem?: string | null;
}

/** Esta mídia pode ser capa? */
export function podeSerCapa(m: MediaParaCapa): boolean {
  return m.tipo === "foto" || (m.tipo === "video" && Boolean(m.chave_thumb));
}

/**
 * A capa: a escolhida pelo fotógrafo, se ainda serve; senão a primeira que
 * serve, na ordem que vier.
 *
 * `todas` é a lista INTEIRA da galeria e `reserva` pode ser uma amostra — é a
 * distinção que a prévia do painel precisa: ali `reserva` são só as 12
 * primeiras, e a capa escolhida pode ser a foto 300 (defeito de 10/09/2026).
 */
export function escolherCapa<T extends MediaParaCapa>(
  todas: readonly T[],
  capaMediaId: string | null,
  reserva: readonly T[] = todas,
): T | undefined {
  const escolhida = capaMediaId
    ? todas.find((m) => m.id === capaMediaId && podeSerCapa(m))
    : undefined;
  return escolhida ?? reserva.find((m) => m.tipo === "foto") ?? reserva.find(podeSerCapa);
}

/** A imagem desta capa. Null quando não há imagem possível. */
export function urlDaCapa(m: MediaParaCapa, validade: number): Promise<string | null> {
  if (m.tipo === "video") {
    /* O pôster, sempre. Ele vive no R2 (é derivada), e nunca o original. */
    return m.chave_thumb ? urlDeLeitura(m.chave_thumb, validade) : Promise.resolve(null);
  }
  return urlDaDerivada(m.chave_preview ?? null, m.chave, armazemDe(m.armazem ?? null), validade);
}
