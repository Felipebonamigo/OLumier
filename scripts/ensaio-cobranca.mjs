#!/usr/bin/env node
/**
 * Ensaio da cobrança de ponta a ponta, contra o Asaas de VERDADE (sandbox). Uso:
 *
 *   node --env-file=.env.production --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/ensaio-cobranca.mjs <slug-do-estudio>
 *
 * NÃO se chama `testar-*` de propósito: fala com um serviço externo e cria
 * cobrança. `testar-tudo.mjs` descobre as suítes pelo prefixo, e isto aqui não
 * pode entrar na bateria de cada `npm test`. Mesmo motivo de `provar-email.mjs`.
 *
 * ── O QUE ELE PROVA, E O QUE NÃO ──────────────────────────────────────────
 * Chama `garantirCliente` e `criarAssinatura` DO APP, não um `fetch` reescrito
 * aqui — é onde mora a conta que importa (reserva de custo e split por ciclo).
 * O que fica de fora é a casca `criarAssinaturaAction`: ela exige sessão HTTP, e
 * o que ela acrescenta é validação de CPF e gravação dos ids. Está dito aqui
 * para ninguém ler este ensaio como prova do fluxo do botão.
 *
 * Ele NÃO escreve no nosso banco. Quem escreve é o webhook, quando o pagamento
 * cai — e é exatamente isso que o ensaio quer ver acontecer sozinho.
 */
import pg from "pg";
import { garantirCliente, criarAssinatura, asaasEmProducao } from "../src/lib/asaas.ts";
import { montarFatias, lucroCentavos } from "../src/config/socios.ts";
import { planoPorId } from "../src/config/planos.ts";

const slug = process.argv[2];
if (!slug) { console.error("uso: ... scripts/ensaio-cobranca.mjs <slug>"); process.exit(2); }

if (asaasEmProducao()) {
  console.error("✗ ASAAS_AMBIENTE=producao — este ensaio cria cobrança de VERDADE. Abortado.");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows: [t] } = await db.query(
  "select id, slug, nome_estudio, email, plano_id, status, ciclo_cobranca from tenants where slug = $1",
  [slug],
);
await db.end();
if (!t) { console.error(`✗ estúdio "${slug}" não existe`); process.exit(1); }

const plano = planoPorId(t.plano_id);
if (!plano) { console.error(`✗ plano ${t.plano_id} não existe na grade`); process.exit(1); }

const reais = (c) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

console.log(`Ensaio de cobrança — ${t.nome_estudio} (${t.status})`);
console.log(`  plano: ${plano.nome} · ${reais(plano.precoCentavos)}/mês · ciclo ${t.ciclo_cobranca}`);

const lucro = lucroCentavos(plano.id, plano.precoCentavos, t.ciclo_cobranca);
const fatias = montarFatias(plano.id, plano.precoCentavos, t.ciclo_cobranca);
console.log(`  reserva de custo: ${reais(plano.precoCentavos - lucro)} · lucro: ${reais(lucro)}`);
console.log(
  fatias.length
    ? `  split: ${fatias.map((f) => `${f.socio.nome} ${reais(f.centavos)}`).join(" · ")}`
    : "  split: nenhuma carteira configurada — 100% fica na conta principal",
);

const cliente = await garantirCliente({
  tenantId: t.id,
  nome: t.nome_estudio,
  email: t.email,
  cpfCnpj: "24971563792", // CPF fictício com dígitos válidos, só para o sandbox
});
console.log(`\n  ✓ cliente no Asaas: ${cliente.id}`);

/* Vencimento HOJE de propósito. O app usa o fim do trial (14 dias à frente), e
 * uma cobrança que só vence daqui a duas semanas não deixa nada para pagar
 * agora. O que o ensaio quer exercitar é o que acontece DEPOIS do pagamento. */
const assinatura = await criarAssinatura({
  clienteAsaasId: cliente.id,
  tenantId: t.id,
  planoId: plano.id,
  precoCentavos: plano.precoCentavos,
  ciclo: t.ciclo_cobranca,
  descricao: `Ensaio — ${plano.nome}`,
  primeiroVencimento: new Date(),
});
console.log(`  ✓ assinatura: ${assinatura.id} · ${assinatura.status} · vence ${assinatura.nextDueDate}`);
console.log(`\nassinatura=${assinatura.id}`);
console.log(`cliente=${cliente.id}`);
console.log(`tenant=${t.id}`);
