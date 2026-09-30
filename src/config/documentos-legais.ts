/**
 * A versão de cada texto que o fotógrafo aceita ao criar a conta.
 *
 * ── POR QUE ISTO SAIU DE DENTRO DAS PÁGINAS (30/09/2026) ──────────────────
 *
 * A data morava numa constante solta em cada página e servia só para o
 * rodapé "Atualizados em". O cadastro diz "ao criar a conta, você aceita os
 * Termos" — e não guardava QUAIS. Os Termos mudaram em 29/09/2026; numa
 * disputa, a primeira pergunta seria "que texto essa pessoa aceitou?", e a
 * resposta honesta era "não sabemos".
 *
 * Agora a mesma data serve às duas pontas: a página a mostra, e o evento
 * `conta.criada` a grava (imutável, ver migração 014). Mexeu no texto, muda a
 * data aqui — e quem se cadastrar depois fica registrado com a versão nova.
 *
 * Formato AAAA-MM-DD: é o que vai para o banco, ordena como texto e não tem
 * ambiguidade de dia e mês.
 */
export const VERSOES_LEGAIS = {
  termos: "2026-09-30",
  privacidade: "2026-09-30",
} as const;

/** "2026-09-30" → "30 de setembro de 2026", sem depender do fuso do servidor. */
export function dataPorExtenso(versao: string): string {
  return new Date(`${versao}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Quem opera o serviço, como aparece nos Termos e na Privacidade.
 *
 * Até 30/09/2026 era só o nome de uma pessoa física, escrito à mão nas duas
 * páginas. Decisão do Felipe: passa a ser o MEI. Nome e CNPJ copiados do
 * cadastro dele no Asaas ("Dados comerciais", 30/09/2026): a razão social do
 * MEI é o próprio CNPJ-base seguido do nome, e é assim que ela aparece aqui.
 * Quando a sociedade virar LTDA, é aqui que muda, e muda a versão dos dois
 * textos junto (é outra parte no contrato).
 *
 * Formato do CNPJ: "00.000.000/0000-00". `testar-textos-legais.mjs` confere
 * o formato e os dígitos verificadores.
 */
export const OPERADOR: { nome: string; cnpj: string | null } = {
  nome: "68.185.754 Felipe Carboni Bonamigo",
  cnpj: "68.185.754/0001-05",
};

/** "Fulano, CNPJ 00.000.000/0000-00" — ou só o nome, sem CNPJ informado. */
export function operadorPorExtenso(): string {
  return OPERADOR.cnpj ? `${OPERADOR.nome}, CNPJ ${OPERADOR.cnpj}` : OPERADOR.nome;
}
