/**
 * Como a suíte decide o código de saída.
 *
 * Mora fora do `testar-tudo.mjs` porque lá a regra seria intestável: aquele
 * arquivo roda as 36 suítes ao ser importado, então um teste que quisesse
 * conferir a regra rodaria a suíte inteira dentro dela mesma.
 *
 * A regra tem dois modos porque há dois públicos:
 *
 *   - o DIA A DIA, sem servidor de desenvolvimento no ar: pular as suítes de
 *     HTTP é o certo. Reprovar quem rodou o que dava para rodar só ensina a
 *     não rodar mais.
 *
 *   - a PUBLICAÇÃO (`--exigir-tudo`): pular vira reprovação. Sem isso o
 *     `deploy.sh` conferiria 10 de 36 suítes, sairia com 0 e diria que está
 *     tudo conferido — segurança sem conferência, que é pior que portão nenhum.
 */
export function codigoDeSaida({ vermelhas, pulados, exigirTudo }) {
  if (vermelhas > 0) return 1;
  if (exigirTudo && pulados > 0) return 1;
  return 0;
}
