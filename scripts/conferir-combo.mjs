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
const { assinaturasDoCliente, clientesDoEmail, cobrancasDaAssinatura, cobrancasDoCliente, clientesDoDocumento } = await import("../src/lib/asaas.ts");

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

/* O que o Asaas tem, cru — para quando o resumo acima não bastar (30/09/2026:
   a Bia "pagou" e o Asaas não tinha cobrança paga nenhuma na assinatura). */
const estudio = (await consultar("select asaas_assinatura_id from tenants where id = $1", [e.id]))[0];
if (estudio?.asaas_assinatura_id) {
  console.log(`\n  Cobranças da assinatura da Galeria (${estudio.asaas_assinatura_id}):`);
  const cobs = await cobrancasDaAssinatura(estudio.asaas_assinatura_id);
  if (cobs.length === 0) console.log("    (nenhuma)");
  for (const c of cobs) {
    const pago = c.confirmedDate ?? c.paymentDate;
    console.log(`    · ${c.id} — ${c.status} · R$ ${Number(c.value ?? 0).toFixed(2)} · vence ${c.dueDate ?? "?"} · ${c.billingType ?? "?"}${pago ? ` · pago em ${pago}` : ""}`);
  }
}
console.log(`\n  Clientes no Asaas com o e-mail ${d.email} ou o CPF/CNPJ ${d.documento ?? "-"}:`);
const vistos = new Map();
for (const c of [...(await clientesDoEmail(d.email)), ...(d.documento ? await clientesDoDocumento(d.documento) : [])]) vistos.set(c.id, c);
const clientes = [...vistos.values()];
if (clientes.length === 0) console.log("    (nenhum)");
for (const c of clientes) {
  const subs = await assinaturasDoCliente(c.id);
  const lista = subs.length
    ? subs.map((a) => `${a.externalReference ?? "sem referência"} ${a.status}${a.description ? ` "${a.description}"` : ""}`).join("; ")
    : "sem assinatura";
  const outroDoc = (c.cpfCnpj ?? "") !== (d.documento ?? "") ? "  ← documento DIFERENTE do da Galeria" : "";
  console.log(`    · ${c.id} — ${c.name ?? ""} · doc ${c.cpfCnpj ?? "(nenhum)"}${outroDoc}\n      assinaturas: ${lista}`);
  // Toda cobrança do cliente, avulsa inclusive: é aqui que aparece um Pix pago
  // fora da assinatura (o caso da Bia, 30/09/2026).
  for (const p of await cobrancasDoCliente(c.id)) {
    const pago = p.confirmedDate ?? p.paymentDate;
    console.log(`      · ${p.id} — ${p.status} · R$ ${Number(p.value ?? 0).toFixed(2)} · ${p.billingType ?? "?"} · vence ${p.dueDate ?? "?"}${pago ? ` · pago em ${pago}` : ""} · ${p.subscription ? `assinatura ${p.subscription}` : "AVULSA"} · ref ${p.externalReference ?? "-"}${p.description ? ` · "${p.description}"` : ""}`);
  }
}

/* Tudo que caiu na conta nos últimos 3 dias, dos dois produtos: um Pix que
   não achou dono acima (outro e-mail, outro documento, cobrança avulsa) aparece
   aqui pelo valor e pela hora. Marca com ◀ o que é de um cliente listado acima. */
const { pagamentosRecebidos } = await import("../src/lib/asaas.ts");
const hoje = new Date();
const dia = (d) => d.toISOString().slice(0, 10);
const { pagamentos: recentes, incompleto } = await pagamentosRecebidos(dia(new Date(hoje.getTime() - 3 * 86_400_000)), dia(hoje));
console.log(`\n  Tudo que caiu na conta do Asaas nos últimos 3 dias (${recentes.length}${incompleto ? ", lista cortada" : ""}):`);
if (recentes.length === 0) console.log("    (nada)");
for (const p of recentes) {
  const deste = vistos.has(p.customer) ? "  ◀ cliente acima" : "";
  console.log(`    · ${p.paymentDate ?? "?"} — R$ ${Number(p.value ?? 0).toFixed(2)} · ${p.billingType ?? "?"} · ${p.status} · cliente ${p.customer ?? "?"} · ${p.subscription ? `assinatura ${p.subscription}` : "AVULSA"} · ref ${p.externalReference ?? "-"}${p.description ? ` · "${p.description}"` : ""}${deste}`);
}

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
