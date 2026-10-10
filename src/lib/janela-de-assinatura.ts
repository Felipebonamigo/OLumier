/**
 * A HORA EM QUE UM LINK DE LEITURA É ASSINADO (10/10/2026).
 *
 * O navegador guarda o que baixou pelo ENDEREÇO. Até aqui todo link de foto
 * era assinado com a hora do pedido, e a hora entra na URL (`X-Amz-Date`):
 * cada abertura da página, cada `router.refresh`, cada lote de "mais fotos"
 * dava um endereço novo para a MESMA miniatura — e o casal que voltava à
 * galeria baixava as 600 de novo.
 *
 * Agora a assinatura usa o começo de uma janela. Dentro dela o endereço é o
 * mesmo, byte a byte, e o navegador reaproveita o que já tem.
 *
 * ── O PRAZO PROMETIDO NÃO CRESCE ──────────────────────────────────────────
 *
 * "Link que vaza para de funcionar" é promessa da página de segurança e da
 * home, com o prazo escrito (`config/links-assinados.ts`). Por isso a validade
 * NÃO é esticada para compensar: o link assinado no começo da janela vence
 * mais cedo, nunca mais tarde. A janela é um sexto da validade (até uma
 * hora), então sobra sempre pelo menos 5/6 dela — 5 h dos 6 h da galeria,
 * 50 min da hora do painel. A galeria do cliente renova os links aos 4 h
 * (`galeria-cliente.tsx`), antes de qualquer um vencer.
 *
 * Pura, sem relógio escondido: `scripts/testar-janela-de-assinatura.mjs`.
 */

/** A maior janela: uma hora. */
export const JANELA_MAXIMA_SEG = 3600;

/** O instante a usar como data da assinatura de um link que vale `expiraSeg`. */
export function inicioDaJanela(expiraSeg: number, agoraMs: number = Date.now()): Date {
  const janelaMs = Math.min(JANELA_MAXIMA_SEG, Math.floor(expiraSeg / 6)) * 1000;
  /* Link curtíssimo (menos de 6 s) não tem o que reaproveitar. */
  if (janelaMs < 1000) return new Date(agoraMs);
  return new Date(Math.floor(agoraMs / janelaMs) * janelaMs);
}
