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
