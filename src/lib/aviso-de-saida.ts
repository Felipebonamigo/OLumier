/**
 * A REGRA do aviso de saída: este clique custa alguma coisa?
 *
 * ── POR QUE ELA MORA SOZINHA, FORA DO GANCHO ──────────────────────────────
 *
 * São quatro casos que se confundem — mesma aba, outra aba da mesma galeria,
 * outra galeria, fora do painel — e nenhum deles se testa clicando. Dentro do
 * `useEffect` de `aviso-de-saida-client.ts` a decisão só seria conferida à mão,
 * uma vez, por quem escreveu.
 *
 * E este arquivo não importa React de propósito: o gancho é `"use client"` e
 * puxa `useEffect`, o que torna o módulo inteiro impossível de carregar numa
 * suíte de linha de comando. Regra que não dá para rodar é regra que ninguém
 * roda. Ver `scripts/testar-aviso-de-saida.mjs`.
 */

/**
 * @param atual    o caminho de onde a pessoa está
 * @param destino  o caminho para onde o link leva
 * @param dentroDe prefixo em que navegar não custa nada. TERMINE EM BARRA:
 *                 `/painel/galerias/abc-123` casa por prefixo com
 *                 `/painel/galerias/abc-1234/fotos`, que é outra galeria — o
 *                 erro é de digitação e o efeito é a fila morrer em silêncio.
 */
export function ehSaida(atual: string, destino: string, dentroDe?: string): boolean {
  /* Âncora para a mesma página (#fotos) não é saída. */
  if (destino === atual) return false;
  /*
   * A área segura vale nos DOIS lados. Só o destino não basta: com algo a
   * perder em `/painel`, um link PARA a galeria passaria por "seguro" sem nunca
   * ter estado dentro dela. E só a origem não basta: sair da galeria para
   * `/painel` é exatamente o "← Galerias" que mata a fila.
   */
  if (dentroDe && destino.startsWith(dentroDe) && atual.startsWith(dentroDe)) return false;
  return true;
}
