import "server-only";
import { createHash } from "node:crypto";

/**
 * Pseudonimização de IP — uma função, duas tabelas.
 *
 * ── POR QUE ISTO VIROU MÓDULO (01/09/2026) ────────────────────────────────
 *
 * `eventos.ip_hash` e `acessos.ip_hash` sempre precisaram sair do MESMO segredo:
 * é o que permite cruzar as duas e dizer que o acesso das 14h32 e o clique em
 * apagar vieram do mesmo lugar. Um comentário em `eventos.ts` até afirmava isso.
 *
 * Eram duas cópias, e cópias envelhecem separadas. A de `eventos` passou a ler
 * `SESSAO_SEGREDO ?? "sem-segredo"` — uma variável que NUNCA existiu em ambiente
 * nenhum. Ou seja: o sal era sempre a string literal, que está no código, que
 * está em dois repositórios. O espaço IPv4 inteiro são 4,3 bilhões de hashes;
 * contra um sal conhecido, reverter a coluna toda leva minutos. Cinco eventos em
 * produção já estavam gravados assim quando isto foi descoberto.
 *
 * E não falhava. Rodava perfeitamente, os testes passavam, e as duas tabelas
 * simplesmente nunca casavam — sem erro, sem log, sem ninguém notar. É o formato
 * clássico de default inseguro, e o motivo de existir uma função só a partir de
 * agora: não há como duas cópias divergirem quando não há duas cópias.
 *
 * `scripts/testar-defaults-inseguros.mjs` prende as duas pontas — que o segredo
 * não tem valor de reserva, e que os dois lugares importam DAQUI.
 */

/**
 * O segredo, ou nada.
 *
 * Sem `SESSION_SECRET` isto explode, e explodir é o comportamento certo: hash
 * com sal inventado não protege ninguém, e protege menos ainda por parecer que
 * protege. É a mesma exigência de `auth.ts`, `favoritas.ts` e
 * `galerias-publicas.ts` — os quatro lugares que dependem deste segredo agora
 * falham do mesmo jeito quando ele falta.
 */
function segredo(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET ausente ou curto demais — o IP não pode ser pseudonimizado");
  }
  return s;
}

/**
 * O IP, pseudonimizado. 32 caracteres, que é o que as duas colunas guardam.
 *
 * Não é anonimização: quem tem o segredo e um IP suspeito confere se bate. É
 * exatamente o que se quer para auditoria — provar que dois registros vieram do
 * mesmo lugar sem guardar o endereço de ninguém.
 */
export function hashDeIp(ip: string): string {
  return createHash("sha256")
    .update(segredo() + ip)
    .digest("hex")
    .slice(0, 32);
}
