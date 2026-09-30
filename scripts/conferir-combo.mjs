#!/usr/bin/env node
/**
 * Confere o COMBO COM O ATOMATIZA de um estúdio — e acerta, se pedirem.
 *
 * No servidor, dentro de /opt/fotonio:
 *
 *   node --env-file=.env.production --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/conferir-combo.mjs <e-mail | CPF/CNPJ | parte do nome>
 *
 * Mostra, sem mexer em nada: o plano e o documento daqui, as assinaturas do
 * Atomatiza que o Asaas tem para esse documento (e por que cada uma conta ou
 * não), se o desconto vale, e o valor que a nossa assinatura cobra contra o que
 * deveria cobrar.
 *
 * Com `--acertar` no fim, roda a mesma conferência do webhook
 * (`recalcularCombo`): põe a assinatura no valor certo, fatura em aberto
 * inclusive quando o valor baixa. Valor mudado à mão no Asaas não é desfeito —
 * a regra é a mesma do automático.
 *
 * Nasceu em 30/09/2026, com o pagamento da Bia Zac: "você garantiu o desconto
 * dela?". A resposta estava no Asaas, e não havia como olhar sem abrir o painel
 * de lá e cruzar três telas.
 */

const args = process.argv.slice(2);
const acertar = args.includes("--acertar");
const busca = args.filter((a) => a !== "--acertar").join(" ").trim();
if (!busca) {
  console.error("uso: scripts/conferir-combo.mjs <e-mail | CPF/CNPJ | parte do nome> [--acertar]");
  process.exit(1);
}

const { consultar } = await import("../src/lib/db.ts");
const { diagnosticarCombo, recalcularCombo } = await import("../src/lib/combo.ts");
const { linhaDoCombo, linhaDoValor } = await import("../src/lib/aviso-de-pagamento.ts");

const digitos = busca.replace(/\D/g, "");
const estudios = await consultar(
  `select id, nome_estudio, email, status from tenants
    where lower(email) = lower($1)
       or ($2 <> '' and length($2) >= 11 and cpf_cnpj = $2)
       or nome_estudio ilike '%' || $1 || '%'
    order by criado_em
    limit 10`,
  [busca, digitos],
);

if (estudios.length === 0) {
  console.log(`Nenhum estúdio encontrado para "${busca}".`);
  process.exit(1);
}
if (estudios.length > 1) {
  console.log(`${estudios.length} estúdios batem com "${busca}". Refine pelo e-mail ou CPF/CNPJ:`);
  for (const e of estudios) console.log(`  · ${e.nome_estudio} — ${e.email} (${e.status})`);
  process.exit(1);
}

const [e] = estudios;
const d = await diagnosticarCombo(e.id);
console.log(`\n${d.estudio} — ${d.email} (${e.status})`);
console.log(`  plano:      ${d.planoId} · ${d.ciclo}`);
console.log(`  CPF/CNPJ:   ${d.documento ?? "(nenhum)"}`);
console.log(`  Atomatiza:  ${d.assinaturasDoAtomatiza.length === 0 ? "nenhuma assinatura com este documento" : ""}`);
for (const a of d.assinaturasDoAtomatiza) {
  console.log(`    · ${a.id} — "${a.descricao ?? ""}" → ${a.foraPorque ? `NÃO conta: ${a.foraPorque}` : "conta"}`);
}
console.log(`  combo:      ${linhaDoCombo(d)}`);
console.log(`  assinatura: ${linhaDoValor(d)}`);

if (acertar) {
  const r = await recalcularCombo(e.id, "conferir-combo");
  if (!r) console.log("\n  --acertar: nada a fazer (sem assinatura viva, ou sem Asaas configurado).");
  else if (r.mudou) console.log(`\n  --acertar: assinatura de ${r.antesCentavos / 100} para ${r.depoisCentavos / 100}.`);
  else console.log("\n  --acertar: o valor já estava certo, ou foi mudado à mão no Asaas (não mexi).");
} else if (d.valorAtualCentavos !== null && d.valorAtualCentavos !== d.valorCertoCentavos) {
  console.log("\n  Para acertar, rode de novo com --acertar no fim.");
}
console.log("");
process.exit(0);
