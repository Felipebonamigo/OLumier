#!/usr/bin/env node
/**
 * Procura no Asaas os pagamentos que o webhook não contou — e conta, se pedirem.
 *
 * No servidor, dentro de /opt/fotonio:
 *
 *   node --env-file=.env.production --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/conferir-pagamentos.mjs [--acertar]
 *
 * Sem `--acertar`, só lista. Com ele, cada pagamento achado é contado como o
 * webhook contaria: conta ativa, período pago, combo conferido e o e-mail de
 * pagamento para a lista ADMINS. O `ops/fotonio-pagamentos.timer` roda isto
 * com `--acertar` de hora em hora. Ver `src/lib/pagamentos-perdidos.ts`.
 */
const acertar = process.argv.includes("--acertar");
const { procurarPagamentosPerdidos, registrarPagamentoPerdido } = await import("../src/lib/pagamentos-perdidos.ts");

const perdidos = await procurarPagamentosPerdidos();
const agora = new Date().toISOString();
if (perdidos.length === 0) {
  console.log(`${agora} nenhum pagamento perdido`);
  process.exit(0);
}

const data = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "nunca");
console.log(`${agora} ${perdidos.length} pagamento(s) no Asaas que a Galeria não contou:`);
for (const p of perdidos) {
  console.log(
    `  · ${p.estudio} (${p.email}, ${p.status}) — cobrança ${p.cobrancaId}, R$ ${(p.valorCentavos / 100).toFixed(2)}; pago até ${data(p.pagoAteAntes)} → ${data(p.pagoAteDepois)}`,
  );
  if (acertar) await registrarPagamentoPerdido(p);
}
console.log(acertar ? "  contados." : "  Para contar, rode de novo com --acertar.");
process.exit(0);
