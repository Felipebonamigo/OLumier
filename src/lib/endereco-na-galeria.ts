/**
 * O endereço de outra tela da MESMA galeria — hoje, de outro capítulo.
 *
 * ── O CAPÍTULO SAIU DA CONSULTA E VIROU CAMINHO (21/09/2026) ──────────────
 *
 * Juan, com o link na mão: "se os noivos forem mandar pra alguém, provavelmente
 * vão copiar e enviar. Daí vai ficar esse link cheio de coisa —
 * `?previa=1&cap=cerimonia`. Olha que feio."
 *
 * Ele tem razão sobre o que importa: o link é o produto na mão do casal. Agora
 * o capítulo é um pedaço do caminho, como uma pasta:
 *
 *     /g/sirius-fotografia/julia-gustavo-wedding/cerimonia
 *
 * ── POR QUE A BASE VEM DE FORA ────────────────────────────────────────────
 *
 * Porque ela não é sempre `/g/<estudio>/<galeria>`. Num estúdio com domínio
 * próprio ou subdomínio (migração 023) o visitante vê só `/<galeria>` — a forma
 * interna é reescrita pelo proxy, e ele até RECUSA servir `/g/` naquele host.
 * Montar o link a partir de `/g/...` quebraria exatamente nos estúdios que
 * pagam pelo endereço deles, e o defeito seria silencioso: a página abre, só
 * que no domínio errado.
 *
 * Quem sabe por onde a pessoa chegou é o proxy, e ele diz no cabeçalho
 * `CAMINHO_PUBLICO`. A página lê e passa adiante.
 *
 * ── O QUE FICA DA CONSULTA ────────────────────────────────────────────────
 *
 * Tudo o que não for capítulo — principalmente o `?previa=1` do dono. A
 * primeira versão montava a consulta do zero e, no rascunho, a prévia do
 * fotógrafo virava "abriu" na Atividade do casal (revisão de 16/09/2026).
 * `fotos` sai porque o recorte da busca por rosto é de uma tela só.
 */
export function enderecoNaGaleria(
  base: string,
  buscaAtual: string,
  mudar: { cap?: string | null },
): string {
  const p = new URLSearchParams(buscaAtual.replace(/^\?/, ""));
  p.delete("fotos");
  p.delete("cap");
  /* `parte` morreu com a paginação em 16/09/2026; segue sendo limpo para um
     link antigo não ressuscitá-lo na barra de endereços. */
  p.delete("parte");
  const consulta = p.toString();
  /* Sem barra no fim: `/galeria` e não `/galeria/`, que é o que o casal copia. */
  const caminho = base.replace(/\/+$/, "") + (mudar.cap ? `/${mudar.cap}` : "");
  return consulta ? `${caminho}?${consulta}` : caminho;
}
