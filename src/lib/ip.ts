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

/**
 * O e-mail, pseudonimizado — para o registro de auditoria, que é imutável.
 *
 * ── POR QUE (30/09/2026) ──────────────────────────────────────────────────
 * `conta.criada` e `aviso_limpeza.enviado` gravavam o e-mail cru em `eventos`,
 * e `eventos` recusa update e delete (migração 014). A Política de Privacidade
 * dizia que ali não entrava e-mail. Não dava para cumprir um pedido de exclusão
 * nem manter a frase verdadeira.
 *
 * O e-mail importa como PROVA: "o aviso de exclusão foi mandado para qual
 * endereço?". O hash responde do mesmo jeito que o do IP — quem tem o segredo e
 * o endereço alegado confere se bate — sem guardar o endereço. Normalizado
 * antes (espaços e maiúsculas), porque "Oi@x.com " e "oi@x.com" são a mesma
 * caixa e precisam dar o mesmo hash. O prefixo separa os dois espaços de hash:
 * um e-mail nunca colide com um IP.
 */
export function hashDeEmail(email: string): string {
  return createHash("sha256")
    .update(`${segredo()}email:${email.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * O visitante do DIA, para contar "pessoas" na página-ponte (`/bio`) sem cookie.
 *
 * É o IP + o navegador + a data, com o sal da plataforma. A data entra de
 * propósito: o hash GIRA todo dia, então não há como seguir uma pessoa de um dia
 * para o outro — nem a gente, nem quem um dia lesse a tabela. Serve para dizer
 * "quantas pessoas diferentes vieram hoje", e só isso.
 *
 * É uma ESTIMATIVA e o painel diz que é: duas pessoas na mesma rede móvel com o
 * mesmo modelo de celular caem no mesmo hash. O prefixo `bio:` separa este
 * espaço de hash do do IP e do e-mail.
 */
export function hashDeVisitanteDoDia(ip: string, agente: string, dia: string): string {
  return createHash("sha256")
    .update(`${segredo()}bio:${dia}:${ip}|${agente}`)
    .digest("hex")
    .slice(0, 24);
}

