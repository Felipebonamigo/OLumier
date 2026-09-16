/**
 * A SEÇÃO "SITE" DO PAINEL, LIGADA OU DESLIGADA.
 *
 * Juan, 16/09/2026: "deixar a sessão site fora do ar momentaneamente, ainda não
 * conseguimos ver nada disso" — o site do estúdio.
 *
 * ── POR QUE UM INTERRUPTOR, E NÃO APAGAR A TELA ──────────────────────────
 *
 * "Momentaneamente" é a palavra do pedido. Apagar `/painel/site` levaria junto
 * o editor de vitrine, o endereço do estúdio e o domínio próprio — três coisas
 * que funcionam e que alguém vai querer de volta assim que puder olhá-las. O
 * custo de trazer de volta seria reescrever o que já existe; o custo deste
 * arquivo é uma linha.
 *
 * ── O QUE SAI DO AR, E O QUE NÃO SAI ─────────────────────────────────────
 *
 * Sai a SEÇÃO do painel: a aba some do cabeçalho e a rota devolve 404, como já
 * fazem as telas de administrador para quem não é admin. Esconder o link e
 * deixar a rota aberta seria segurança de fachada — quem tivesse o endereço
 * salvo entraria igual.
 *
 * NÃO sai a vitrine pública `/e/<slug>`. Ela é o que um subdomínio de estúdio e
 * um domínio próprio já apontam hoje (ver `proxy.ts`): derrubá-la quebraria
 * endereço que alguém pode ter divulgado, e o pedido era sobre a seção que eles
 * ainda não conseguiram revisar, não sobre tirar do ar um link entregue.
 *
 * `scripts/testar-site-estudio.mjs` e `testar-vitrine.mjs` continuam valendo
 * para a vitrine; o que muda é só a porta do painel.
 */
export const SECAO_SITE_NO_AR = false;
