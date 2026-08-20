/**
 * Impede que um teste destrutivo rode contra o banco de produção.
 *
 * Os testes publicam galeria, REMOVEM senha, apagam mídia e mexem em quota.
 * Contra o banco de desenvolvimento isso é o trabalho deles. Contra produção
 * seria expor a entrega de um casal e apagar foto de cliente — e o caminho para
 * o acidente é curto: um `.env.production` copiado para a máquina, uma variável
 * exportada na sessão errada, um copiar-colar de comando.
 *
 * Uso, no topo do script:
 *   import { exigirBancoDeTeste } from "./guarda-producao.mjs";
 *   exigirBancoDeTeste();
 *
 * Para rodar mesmo assim (não faça isso sem um bom motivo):
 *   PERMITIR_PRODUCAO=1 node ...
 */

/** Nome do banco no fim da URL de conexão. */
function nomeDoBanco(url) {
  try {
    return new URL(url).pathname.replace(/^\//, "").split("?")[0];
  } catch {
    return "";
  }
}

export function exigirBancoDeTeste() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    console.error("✗ DATABASE_URL não configurada");
    process.exit(1);
  }

  if (process.env.PERMITIR_PRODUCAO === "1") {
    console.warn("⚠ PERMITIR_PRODUCAO=1 — rodando contra um banco que parece de produção\n");
    return;
  }

  const banco = nomeDoBanco(url);
  // Lista do que é ACEITO, não do que é proibido: banco novo com nome
  // inesperado deve ser recusado por padrão, não liberado por esquecimento.
  const ehDeTeste = /(_dev|_test|_teste)$/.test(banco) || banco === "postgres";

  if (!ehDeTeste) {
    console.error(
      `\n✗ RECUSADO: "${banco}" não parece um banco de teste.\n\n` +
        `  Estes testes publicam galeria, removem senha e apagam mídia.\n` +
        `  Contra produção isso expõe entrega de cliente e apaga foto.\n\n` +
        `  Aponte a DATABASE_URL para um banco terminado em _dev (ou _teste).\n` +
        `  Se você REALMENTE quis fazer isso: PERMITIR_PRODUCAO=1\n`,
    );
    process.exit(1);
  }
}
