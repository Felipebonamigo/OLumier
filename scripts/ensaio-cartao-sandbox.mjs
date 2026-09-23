#!/usr/bin/env node
/**
 * ENSAIO DO CARTÃO AUTOMÁTICO — contra o sandbox de verdade, não contra mentira.
 *
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/ensaio-cartao-sandbox.mjs
 *
 * ── POR QUE NÃO SE CHAMA `testar-` ────────────────────────────────────────
 *
 * `testar-tudo.mjs` descobre suíte pelo prefixo `testar-`, e este arquivo FALA
 * COM O ASAAS: cria cliente, cria assinatura, paga fatura com cartão. Em sandbox
 * não move dinheiro, mas cria dado de verdade lá — e coisa que cria dado fora
 * não pode rodar a cada `npm test`. Mesma razão de `provar-email.mjs` e
 * `ensaio-cobranca.mjs`.
 *
 * ── O QUE ELE PROVA, E POR QUE PRECISA SER ASSIM ──────────────────────────
 *
 * `testar-assinatura-recorrente.mjs` prova o que o nosso código MANDA — contra
 * um servidor de mentira. Isso não diz nada sobre o que o Asaas FAZ. A pergunta
 * do Felipe em 05/09/2026 foi exatamente essa: "mas o cartão automático está
 * funcionando?", e a resposta honesta era "não sei, ninguém assinou ainda".
 *
 * Aqui a resposta é medida, em quatro passos:
 *
 *   1. assinatura CREDIT_CARD nasce sem dado de cartão nenhum
 *   2. a primeira fatura é paga com o cartão de teste
 *   3. a assinatura passa a ter `creditCard` com token  ← o cartão FICOU salvo
 *   4. uma assinatura criada COM esse token nasce com a cobrança já confirmada,
 *      sem ninguém abrir fatura  ← é isto que é "cobrar sozinho"
 *
 * O passo 4 é o único que prova a captura automática sem esperar um mês. Sem
 * ele, o ensaio provaria só que dá para pagar no cartão uma vez — que não é a
 * pergunta.
 *
 * Medido em 05/09/2026, e passou nos cinco:
 *
 *     assinatura CREDIT_CARD nasce sem cartão      sub_isefzv29sbpcc9jo ACTIVE
 *     primeira cobrança                            PENDING · R$ 139,99
 *     paga com o cartão de teste                   CONFIRMED
 *     o cartão FICOU salvo                         MASTERCARD •••• 8829 · com token
 *     assinatura com o token nasce cobrada         CONFIRMED sem intervenção
 *
 * ── COMO RODAR (a chave NÃO fica no .env.local) ───────────────────────────
 *
 * O `.env.local` é deixado com `ASAAS_API_KEY=` VAZIA de propósito, e mexer
 * nisso custou duas suítes vermelhas antes de eu entender por quê. Duas razões:
 *
 *   1. A chave muda o caminho de `testar-api-galerias`: com cobrança ligada o
 *      estúdio cancelado toma 402, sem ela toma 201. Como a árvore é
 *      compartilhada entre sessões, deixar isso ligado faz a suíte falhar
 *      dependendo de quem subiu o servidor e quando.
 *
 *   2. E MESMO GRAVADA ELA NÃO FUNCIONA NO SERVIDOR DE DEV. A chave começa com
 *      `$`, e o carregador de .env do Next EXPANDE variável: `$aact_hmlg_…`
 *      vira string vazia. O `node --env-file` (que os testes usam) NÃO expande.
 *      Resultado: o teste enxerga a chave, o servidor não, e a falha aponta para
 *      o lugar errado. Escapar com `\$` conserta o Next e quebra o `--env-file`;
 *      os dois carregadores não concordam sobre esse valor.
 *
 * Para rodar este ensaio, traga a chave do backup no VPS e devolva o arquivo
 * depois:
 *
 *     cp .env.local .env.local.antes-sandbox
 *     ssh root@179.197.233.184 \
 *       "grep -m1 '^ASAAS_API_KEY=' /opt/fotonio-shared/.env.production.bak-20260827-193434" \
 *       > /tmp/chave && \
 *       node -e 'const fs=require("fs");const v=fs.readFileSync("/tmp/chave","utf8").trim().replace(/^ASAAS_API_KEY=/,"");fs.writeFileSync(".env.local",fs.readFileSync(".env.local","utf8").replace(/^ASAAS_API_KEY=.*$/m,"ASAAS_API_KEY="+v))'
 *     node --env-file=.env.local --experimental-strip-types \
 *       --import ./scripts/registrar-ts.mjs scripts/ensaio-cartao-sandbox.mjs
 *     cp .env.local.antes-sandbox .env.local
 *
 * A chave de sandbox aparece no painel (`sandbox.asaas.com` → Integrações →
 * Chaves de API, como `galeria-atomo-sandbox`), mas o VALOR o Asaas só mostra
 * uma vez, na criação. Por isso o backup do VPS é a fonte, e não o painel.
 */
import { randomUUID } from "node:crypto";

const CHAVE = process.env.ASAAS_API_KEY;
if (!CHAVE?.startsWith("$aact_hmlg_")) {
  console.error("✗ ASAAS_API_KEY não é de sandbox. Este ensaio NÃO roda contra produção.");
  process.exit(1);
}
const BASE = "https://api-sandbox.asaas.com/v3";

async function api(caminho, opcoes = {}) {
  const r = await fetch(`${BASE}${caminho}`, {
    ...opcoes,
    headers: {
      access_token: CHAVE,
      "Content-Type": "application/json",
      ...(opcoes.headers ?? {}),
    },
  });
  const texto = await r.text();
  let dados = {};
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch {
    throw new Error(`HTTP ${r.status} devolveu algo que não é JSON: ${texto.slice(0, 200)}`);
  }
  if (!r.ok) {
    const msg = dados.errors?.map((e) => e.description).join(" · ") ?? texto.slice(0, 200);
    throw new Error(`HTTP ${r.status}: ${msg}`);
  }
  return dados;
}

let falhou = false;
const passo = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
    throw e; // um passo que falha invalida os seguintes: parar é mais honesto
  }
};

const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const amanha = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
/* HOJE, e não amanhã: o Asaas captura o cartão salvo NO DIA DO VENCIMENTO. Com
   vencimento amanhã a cobrança fica PENDING hoje — que é o comportamento certo,
   mas não prova nada dentro de um ensaio que dura trinta segundos. */
const hoje = () => new Date().toISOString().slice(0, 10);
const marca = Date.now();

/* Cartão de teste do sandbox. Não existe fora dali, e o número é público na
   documentação do Asaas — não é segredo de ninguém. */
const CARTAO = {
  holderName: "FELIPE BONAMIGO",
  number: "5162306219378829",
  expiryMonth: "12",
  expiryYear: "2030",
  ccv: "318",
};

console.log("ensaio do cartão automático · sandbox\n");

let cliente, assinatura, cobranca, token, segunda;

try {
  await passo("cria o cliente", async () => {
    cliente = await api("/customers", {
      method: "POST",
      body: JSON.stringify({
        name: `Ensaio Cartão ${marca}`,
        email: `ensaio.cartao.${marca}@exemplo.com.br`,
        cpfCnpj: "24971563792", // CPF de teste do sandbox
        mobilePhone: "47988887777",
      }),
    });
    return cliente.id;
  });

  await passo("cria a assinatura CREDIT_CARD sem dado de cartão nenhum", async () => {
    assinatura = await api("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customer: cliente.id,
        billingType: "CREDIT_CARD",
        value: 139.99,
        nextDueDate: amanha(),
        cycle: "MONTHLY",
        description: "Ensaio — Galeria Átomo 1 TB",
        externalReference: `ensaio:${randomUUID()}`,
      }),
    });
    if (assinatura.creditCard) throw new Error("nasceu já com cartão — não deveria");
    return `${assinatura.id} · ${assinatura.status} · sem cartão, como esperado`;
  });

  await passo("a assinatura gerou a primeira cobrança", async () => {
    const r = await api(`/subscriptions/${assinatura.id}/payments`);
    cobranca = r.data?.[0];
    if (!cobranca) throw new Error("nenhuma cobrança foi gerada");
    return `${cobranca.id} · ${cobranca.status} · ${brl(cobranca.value)}`;
  });

  await passo("paga a primeira fatura com o cartão de teste", async () => {
    const pago = await api(`/payments/${cobranca.id}/payWithCreditCard`, {
      method: "POST",
      body: JSON.stringify({
        creditCard: CARTAO,
        creditCardHolderInfo: {
          name: CARTAO.holderName,
          email: `ensaio.cartao.${marca}@exemplo.com.br`,
          cpfCnpj: "24971563792",
          postalCode: "89223005",
          addressNumber: "277",
          phone: "4733334444",
        },
        remoteIp: "200.196.1.1",
      }),
    });
    if (!["CONFIRMED", "RECEIVED"].includes(pago.status)) {
      throw new Error(`status ${pago.status}, esperava CONFIRMED ou RECEIVED`);
    }
    return `${pago.status} · ${brl(pago.value)}`;
  });

  await passo("O CARTÃO FICOU SALVO na assinatura", async () => {
    const depois = await api(`/subscriptions/${assinatura.id}`);
    token = depois.creditCard?.creditCardToken;
    const fim = depois.creditCard?.creditCardNumber;
    const bandeira = depois.creditCard?.creditCardBrand;
    if (!fim) throw new Error("a assinatura continua sem `creditCard` — o cartão NÃO foi guardado");
    return `${bandeira ?? "Cartão"} •••• ${fim}${token ? " · com token" : " · SEM token"}`;
  });

  /*
   * O PASSO QUE PROVA A CAPTURA AUTOMÁTICA.
   *
   * Esperar o próximo ciclo levaria um mês. Em vez disso, criamos outra
   * assinatura COM o token guardado: se ela nascer com a cobrança já confirmada,
   * sem ninguém abrir fatura, então é isso que vai acontecer no mês que vem.
   */
  await passo("assinatura criada com o token nasce COBRADA, sem abrir fatura", async () => {
    if (!token) throw new Error("sem token, não há o que provar");
    segunda = await api("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customer: cliente.id,
        billingType: "CREDIT_CARD",
        value: 139.99,
        nextDueDate: hoje(),
        cycle: "MONTHLY",
        description: "Ensaio — captura automática",
        externalReference: `ensaio:${randomUUID()}`,
        creditCardToken: token,
        remoteIp: "200.196.1.1",
      }),
    });
    const r = await api(`/subscriptions/${segunda.id}/payments`);
    const c = r.data?.[0];
    if (!c) throw new Error("nenhuma cobrança gerada");
    if (!["CONFIRMED", "RECEIVED"].includes(c.status)) {
      throw new Error(`a cobrança nasceu ${c.status} — não foi capturada sozinha`);
    }
    return `${c.status} sem intervenção · ${brl(c.value)}`;
  });
} catch {
  /* a mensagem já saiu no passo */
}

/* Limpeza: sandbox é de teste, mas deixar assinatura viva ali cobrando todo mês
   suja a conta e confunde o próximo ensaio. */
console.log("\nlimpando");
for (const s of [assinatura, segunda]) {
  if (!s?.id) continue;
  try {
    await api(`/subscriptions/${s.id}`, { method: "DELETE" });
    console.log(`  ✓ assinatura ${s.id} removida`);
  } catch (e) {
    console.log(`  ! não consegui remover ${s.id}: ${e.message}`);
  }
}

console.log(falhou ? "\n✗ o cartão automático NÃO está provado" : "\n✓ cartão automático provado");
process.exitCode = falhou ? 1 : 0;
