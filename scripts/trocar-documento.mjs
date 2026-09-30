#!/usr/bin/env node
/**
 * Troca o CPF/CNPJ de uma conta — aqui e no cliente dela no Asaas — e confere o
 * combo com o Atomatiza.
 *
 * No servidor, dentro de /opt/fotonio:
 *
 *   node --env-file=.env.production --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/trocar-documento.mjs <e-mail> <novo CPF/CNPJ> [--confirmar]
 *
 * Sem `--confirmar`, só mostra o que faria. Trocar de documento não é
 * autoatendimento (é o que prende o teste grátis a uma pessoa, e o combo às
 * duas contas dela), então mora aqui, na mão de quem cuida da plataforma.
 *
 * O combo liga as contas pelo documento do cliente no Asaas: por isso o Asaas
 * muda junto, e primeiro — se ele recusar, nada muda aqui.
 *
 * Nasceu em 30/09/2026 com a Bia Zac: Atomatiza no CNPJ da empresa, Galeria no
 * CPF, e o desconto dos dois juntos não entrava de nenhum lado.
 */

const args = process.argv.slice(2);
const confirmar = args.includes("--confirmar");
const [email, novoBruto] = args.filter((a) => a !== "--confirmar");
if (!email || !novoBruto) {
  console.error("uso: scripts/trocar-documento.mjs <e-mail> <novo CPF/CNPJ> [--confirmar]");
  process.exit(1);
}

const { consultar } = await import("../src/lib/db.ts");
const { soDigitos, conferirDocumento } = await import("../src/lib/documento.ts");
const { documentoEmUso } = await import("../src/lib/cadastro.ts");
const { buscarCliente, trocarDocumentoDoCliente } = await import("../src/lib/asaas.ts");
const { recalcularCombo, diagnosticarCombo } = await import("../src/lib/combo.ts");
const { linhaDoCombo, linhaDoValor } = await import("../src/lib/aviso-de-pagamento.ts");

const novo = soDigitos(novoBruto);
const problema = conferirDocumento(novo);
if (problema) {
  console.error(problema);
  process.exit(1);
}

const [t] = await consultar(
  "select id, nome_estudio, email, cpf_cnpj, asaas_cliente_id from tenants where lower(email) = lower($1)",
  [email.trim()],
);
if (!t) {
  console.error(`Nenhuma conta com o e-mail ${email}.`);
  process.exit(1);
}
if (await documentoEmUso(novo, t.id)) {
  console.error(`O documento ${novo} já está em outra conta da Galeria. Junte as contas antes.`);
  process.exit(1);
}

console.log(`\n${t.nome_estudio} — ${t.email}`);
console.log(`  documento aqui: ${t.cpf_cnpj ?? "(nenhum)"} → ${novo}`);
if (t.asaas_cliente_id) {
  const c = await buscarCliente(t.asaas_cliente_id);
  console.log(`  cliente Asaas:  ${c.id} · ${c.cpfCnpj ?? "(sem documento)"} → ${novo}`);
} else {
  console.log("  cliente Asaas:  nenhum ainda (o documento novo vai quando ela assinar)");
}

if (!confirmar) {
  console.log("\n  Nada mudou. Para trocar, rode de novo com --confirmar no fim.\n");
  process.exit(0);
}

if (t.asaas_cliente_id) await trocarDocumentoDoCliente(t.asaas_cliente_id, novo);
await consultar("update tenants set cpf_cnpj = $1, atualizado_em = now() where id = $2", [novo, t.id]);
console.log("\n  trocado.");

const r = await recalcularCombo(t.id, "troca-de-documento");
if (r?.mudou) console.log(`  combo: assinatura de R$ ${(r.antesCentavos / 100).toFixed(2)} para R$ ${(r.depoisCentavos / 100).toFixed(2)}.`);
const d = await diagnosticarCombo(t.id);
if (d) {
  console.log(`  combo:      ${linhaDoCombo(d)}`);
  console.log(`  assinatura: ${linhaDoValor(d)}`);
}
console.log("");
process.exit(0);
