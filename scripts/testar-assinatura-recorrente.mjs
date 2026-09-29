#!/usr/bin/env node
/**
 * Testa a COBRANÇA AUTOMÁTICA — o cartão que fica salvo e cobra sozinho.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-assinatura-recorrente.mjs
 *
 * ── O QUE MUDA, E POR QUE (05/09/2026) ────────────────────────────────────
 *
 * A assinatura nascia com `billingType: "UNDEFINED"`: a fatura abre com Pix,
 * boleto e cartão lado a lado, e o estúdio paga CADA MÊS na mão. Para um SaaS
 * isso é o pior arranjo possível — doze oportunidades por ano de esquecer,
 * atrasar ou desistir, e nenhuma delas é culpa do produto.
 *
 * Com `CREDIT_CARD` a primeira fatura pede o cartão, o Asaas GUARDA o cartão, e
 * as mensalidades seguintes são capturadas sozinhas. O número nunca passa por
 * aqui: é digitado na página do Asaas, e é isso que mantém o sistema fora do
 * escopo de PCI.
 *
 * O desenho é o mesmo que o Atomatiza já roda em produção, e foi medido no
 * sandbox por lá em 03/09/2026: criar a assinatura SEM dados de cartão é aceito,
 * a fatura pede o cartão, e ao pagar a assinatura passa a ter `creditCard` com
 * token. Aqui a diferença é uma só, e é ela que este arquivo prende.
 *
 * ── A ARMADILHA ───────────────────────────────────────────────────────────
 *
 * `atualizarAssinatura` (troca de plano) NÃO pode mandar `billingType`. Se
 * mandar, quem trocou de plano volta para "pague na mão" e o cartão salvo é
 * descartado — sem erro, sem aviso, e a pessoa só descobre no mês seguinte,
 * quando a cobrança não acontece. Hoje ela não manda; a etapa existe para o dia
 * em que alguém "padronizar" as duas funções.
 */
import { createServer } from "node:http";

if (!process.env.ASAAS_API_KEY?.trim()) process.env.ASAAS_API_KEY = "chave-de-mentira";
delete process.env.ASAAS_AMBIENTE;

/* Carteiras de mentira: o split tem de continuar viajando na assinatura de
   cartão, senão a divisão com os sócios se perde justamente na cobrança que
   passa a repetir sozinha. */
process.env.ASAAS_CARTEIRA_FELIPE = "11111111-1111-1111-1111-111111111111";
process.env.ASAAS_CARTEIRA_CAROL = "22222222-2222-2222-2222-222222222222";
process.env.ASAAS_CARTEIRA_SIRIUS = "33333333-3333-3333-3333-333333333333";

const pedidos = [];
/* A carteira da conta que cobra. Nula até as etapas do fim: com ela preenchida
   o servidor passa a responder `/wallets` e a recusar split para ela, como o
   Asaas de verdade recusou em 29/09/2026. */
let carteiraDaConta = null;
const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (p) => (corpo += p));
  req.on("end", () => {
    pedidos.push({ metodo: req.method, caminho: req.url, corpo });
    if (carteiraDaConta && req.method === "GET" && req.url.startsWith("/wallets")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ object: "wallet", id: carteiraDaConta }] }));
    }
    const split = corpo ? (JSON.parse(corpo).split ?? []) : [];
    if (carteiraDaConta && split.some((f) => f.walletId === carteiraDaConta)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({ errors: [{ code: "invalid_split", description: "Não é permitido split para sua própria carteira." }] }),
      );
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    /* A busca por assinatura viva devolve vazio, senão `criarAssinatura` acha
       uma e volta sem fazer o POST — que é o que queremos inspecionar. */
    res.end(
      req.method === "GET" && req.url.startsWith("/subscriptions?")
        ? '{"data":[]}'
        : '{"id":"sub_1","status":"ACTIVE","nextDueDate":"2026-10-01","value":139.99}',
    );
  });
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
process.env.ASAAS_API = `http://127.0.0.1:${servidor.address().port}`;

const { criarAssinatura, atualizarAssinatura, criarCobrancaAvulsa, semACarteiraDaConta } = await import(
  "../src/lib/asaas.ts"
);
const { montarFatias } = await import("../src/config/socios.ts");
const { formaDaAssinatura, ESCOLHA_CARTAO } = await import("../src/config/forma-assinatura.ts");
const { cicloDe, MESES_PAGOS_NO_ANO } = await import("../src/config/planos.ts");
const { rotuloDoCartao } = await import("../src/lib/cartao-salvo.ts");

let falhou = false;
const etapa = async (nome, fn) => {
  pedidos.length = 0;
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

const assinar = (forma, precoCentavos = 13999, ciclo = "mensal") =>
  criarAssinatura({
    clienteAsaasId: "cus_1",
    tenantId: "11111111-2222-3333-4444-555555555555",
    planoId: "g:foto:1000",
    precoCentavos,
    ciclo,
    descricao: "Teste",
    primeiroVencimento: new Date("2026-10-01"),
    forma,
  });

function corpoDoPost(caminho = "/subscriptions") {
  const p = pedidos.find((x) => x.metodo === "POST" && x.caminho.startsWith(caminho));
  if (!p) throw new Error(`nenhum POST em ${caminho}`);
  return JSON.parse(p.corpo);
}

console.log("a escolha do estúdio");

/*
 * O valor chega de um `<form>`, e formulário é o navegador: quem abrir o
 * inspetor troca o campo pelo que quiser. Por isso a lista é fechada, e o lado
 * seguro é o de NÃO virar cartão — lixo virando CREDIT_CARD seria o sistema
 * guardando o cartão de quem nunca pediu. No máximo a pessoa continua pagando
 * como já pagava; ninguém entra em débito automático por acidente.
 */
await etapa("só a escolha exata do cartão liga o cartão", () => {
  if (formaDaAssinatura(ESCOLHA_CARTAO) !== "CREDIT_CARD") {
    throw new Error(`"${ESCOLHA_CARTAO}" deveria virar CREDIT_CARD`);
  }
  return `"${ESCOLHA_CARTAO}" → CREDIT_CARD`;
});

await etapa("qualquer outra coisa cai em UNDEFINED", () => {
  const lixo = ["pix", "boleto", "", "CREDIT_CARD", "cartão de crédito", null, undefined, 7, {}, []];
  for (const v of lixo) {
    const r = formaDaAssinatura(v);
    if (r !== "UNDEFINED") {
      throw new Error(`${JSON.stringify(v)} virou ${r} — entraria em débito automático sem pedir`);
    }
  }
  return `${lixo.length} valores recusados`;
});

/* Acento e caixa não podem custar a cobrança automática de quem clicou no botão
   certo: o rótulo sai do nosso HTML, mas HTML se edita. */
await etapa("acento e caixa não atrapalham a escolha certa", () => {
  for (const v of ["Cartao", "CARTAO", "cartão", "  Cartão  "]) {
    if (formaDaAssinatura(v) !== "CREDIT_CARD") throw new Error(`"${v}" não virou CREDIT_CARD`);
  }
});

console.log("\no que chega ao Asaas");

await etapa("escolhendo cartão, a assinatura nasce CREDIT_CARD", async () => {
  await assinar("CREDIT_CARD");
  const corpo = corpoDoPost();
  if (corpo.billingType !== "CREDIT_CARD") {
    throw new Error(`billingType veio "${corpo.billingType}"`);
  }
  return "billingType: CREDIT_CARD";
});

await etapa("sem escolher, continua UNDEFINED", async () => {
  await assinar("UNDEFINED");
  const corpo = corpoDoPost();
  if (corpo.billingType !== "UNDEFINED") throw new Error(`billingType veio "${corpo.billingType}"`);
  return "billingType: UNDEFINED";
});

/*
 * NENHUM DADO DE CARTÃO SAI DAQUI. A criação é feita sem `creditCard` e sem
 * `creditCardHolderInfo`: o número é digitado na página do Asaas. Se algum dia
 * alguém mandar o cartão por aqui, o sistema entra no escopo de PCI no mesmo
 * commit — e sem ninguém decidir isso.
 */
await etapa("nenhum dado de cartão viaja na criação", async () => {
  await assinar("CREDIT_CARD");
  const corpo = corpoDoPost();
  for (const proibido of ["creditCard", "creditCardHolderInfo", "creditCardToken"]) {
    if (proibido in corpo) {
      throw new Error(`${proibido} foi enviado — isso põe o sistema no escopo de PCI`);
    }
  }
  return "criação limpa";
});

await etapa("o split continua viajando na assinatura de cartão", async () => {
  await assinar("CREDIT_CARD");
  const corpo = corpoDoPost();
  if (!Array.isArray(corpo.split) || corpo.split.length === 0) {
    throw new Error("assinatura de cartão saiu sem split — a divisão com os sócios se perde");
  }
  const soma = corpo.split.reduce((t, f) => t + (f.percentualValue ?? 0), 0);
  return `${corpo.split.length} fatias, ${soma.toFixed(2)}%`;
});

console.log("\no plano anual");

/*
 * O ciclo vem do MESMO formulário, e corre o mesmo risco da forma de pagamento.
 * O lado seguro aqui é o MENSAL: o anual reserva doze meses de custo, o mensal
 * reserva um, e reservar de MENOS é o erro caro — seria pagar sócio com o
 * dinheiro que vai virar fatura da Backblaze. `cicloDe` fecha a lista.
 */
await etapa("qualquer coisa que não seja 'anual' vira mensal", () => {
  const lixo = ["ANUAL", "anual ", "yearly", "12", "", null, undefined, 1, {}, ["anual"]];
  for (const v of lixo) {
    if (cicloDe(v) !== "mensal") {
      throw new Error(`${JSON.stringify(v)} virou ${cicloDe(v)} — reservaria doze meses sem pedir`);
    }
  }
  if (cicloDe("anual") !== "anual") throw new Error('"anual" deveria virar anual');
  return `${lixo.length} valores recusados`;
});

await etapa("no anual, a fatura cobra dez meses de uma vez", async () => {
  await assinar("CREDIT_CARD", 13999 * MESES_PAGOS_NO_ANO, "anual");
  const corpo = corpoDoPost();
  if (corpo.cycle !== "YEARLY") throw new Error(`cycle veio "${corpo.cycle}"`);
  const esperado = (13999 * MESES_PAGOS_NO_ANO) / 100;
  if (corpo.value !== esperado) throw new Error(`value R$ ${corpo.value}, esperava R$ ${esperado}`);
  return `YEARLY · R$ ${corpo.value.toFixed(2)} (${MESES_PAGOS_NO_ANO} mensalidades)`;
});

/*
 * O ANUAL COM CARTÃO é o ponto do trabalho: cobrar uma vez por ano, sozinho.
 * Sem `billingType` chegando junto com `cycle`, o estúdio anual voltaria a ter
 * que abrir a fatura à mão — uma vez por ano, o que é ainda mais fácil de
 * esquecer que uma vez por mês.
 */
await etapa("anual e cartão viajam juntos", async () => {
  await assinar("CREDIT_CARD", 13999 * MESES_PAGOS_NO_ANO, "anual");
  const corpo = corpoDoPost();
  if (corpo.cycle !== "YEARLY" || corpo.billingType !== "CREDIT_CARD") {
    throw new Error(`cycle="${corpo.cycle}" billingType="${corpo.billingType}"`);
  }
});

/*
 * A INVARIANTE DO ANUAL, e é a que mais dói se quebrar: ele paga DEZ meses e
 * ocupa disco por DOZE, então a reserva do ano é maior em proporção e a fatia
 * do sócio é necessariamente MENOR que no mensal. Se algum dia o anual passar a
 * repassar a mesma porcentagem do mensal, dois meses de armazenamento saíram do
 * bolso de quem opera — sem erro, sem log, e só aparece no décimo primeiro mês.
 */
await etapa("no anual o sócio recebe uma fatia MENOR que no mensal", async () => {
  await assinar("CREDIT_CARD", 13999, "mensal");
  const mensal = corpoDoPost().split.reduce((t, f) => t + f.percentualValue, 0);
  pedidos.length = 0;
  await assinar("CREDIT_CARD", 13999 * MESES_PAGOS_NO_ANO, "anual");
  const anual = corpoDoPost().split.reduce((t, f) => t + f.percentualValue, 0);
  if (!(anual < mensal)) {
    throw new Error(
      `anual reparte ${anual.toFixed(2)}% e o mensal ${mensal.toFixed(2)}% — o anual tem de ` +
        `repartir MENOS, porque reserva doze meses de custo contra dez de preço`,
    );
  }
  return `mensal ${mensal.toFixed(2)}% · anual ${anual.toFixed(2)}%`;
});

/*
 * ── A ARMADILHA ───────────────────────────────────────────────────────────
 * Trocar de plano NÃO pode mandar `billingType`: mandar UNDEFINED devolveria o
 * estúdio para "pague na mão" e jogaria fora o cartão salvo, calado, e a pessoa
 * descobriria no mês seguinte quando a cobrança não acontecesse.
 */
await etapa("trocar de plano não mexe na forma de pagamento", async () => {
  await atualizarAssinatura({
    assinaturaId: "sub_1",
    planoId: "g:foto:2000",
    precoCentavos: 21999,
    ciclo: "mensal",
    descricao: "Teste maior",
  });
  const put = pedidos.find((x) => x.metodo === "PUT");
  if (!put) throw new Error("nenhum PUT chegou");
  const corpo = JSON.parse(put.corpo);
  if ("billingType" in corpo) {
    throw new Error(
      `a troca de plano mandou billingType "${corpo.billingType}" — o cartão salvo seria descartado`,
    );
  }
  return "billingType intocado";
});

console.log("\no cartão salvo na tela");

/*
 * A tela só promete "cobrança automática" quando consegue mostrar EM QUAL
 * cartão. Prometer sem mostrar deixa a pessoa sem como conferir; prometer por
 * engano faz quem paga por Pix parar de pagar, achando que já está resolvido.
 * Então tudo que não for cartão com os quatro dígitos vira `null`.
 */
await etapa("sem cartão salvo, a tela não promete nada", () => {
  for (const v of [null, undefined, {}, { creditCard: null }, { creditCard: {} }]) {
    const r = rotuloDoCartao(v);
    if (r !== null) throw new Error(`${JSON.stringify(v)} devolveu "${r}", esperava null`);
  }
});

await etapa("sem os quatro dígitos, também não promete", () => {
  const r = rotuloDoCartao({ creditCard: { creditCardBrand: "VISA", creditCardNumber: "  " } });
  if (r !== null) throw new Error(`devolveu "${r}" com número vazio`);
});

await etapa("com cartão salvo, mostra bandeira e os quatro dígitos", () => {
  const r = rotuloDoCartao({ creditCard: { creditCardBrand: "VISA", creditCardNumber: "4444" } });
  if (r !== "VISA •••• 4444") throw new Error(`veio "${r}"`);
  /* Bandeira ausente não pode virar "undefined •••• 4444" na cara da pessoa. */
  const semBandeira = rotuloDoCartao({ creditCard: { creditCardNumber: "4444" } });
  if (!semBandeira || semBandeira.includes("undefined")) {
    throw new Error(`sem bandeira veio "${semBandeira}"`);
  }
  return `${r} · sem bandeira: ${semBandeira}`;
});

console.log("\na carteira da própria conta (29/09/2026)");

/*
 * "Asaas: Não é permitido split para sua própria carteira." — uma cliente
 * de verdade, embaixo do "Ativar assinatura". A conta que cobra é a mesma do
 * Atomatiza, e uma das carteiras dos sócios é a dela. O servidor de mentira
 * recusa como o de verdade; as etapas provam que as três chamadas que mandam
 * split tiram essa linha, e só ela.
 */
const FELIPE = process.env.ASAAS_CARTEIRA_FELIPE;

await etapa("a regra: sai só a fatia da carteira da conta", () => {
  const fatias = montarFatias("g:foto:1000", 13999, "mensal");
  const sem = semACarteiraDaConta(fatias, FELIPE);
  if (sem.length !== fatias.length - 1) throw new Error(`${fatias.length} → ${sem.length} fatias`);
  if (sem.some((f) => f.carteira === FELIPE)) throw new Error("a carteira da conta ficou");
  if (semACarteiraDaConta(fatias, null).length !== fatias.length) {
    throw new Error("sem saber a carteira da conta, tirou alguma fatia");
  }
  return `${fatias.length} → ${sem.length} fatias`;
});

carteiraDaConta = FELIPE;

await etapa("a assinatura nasce, sem a carteira da conta no split", async () => {
  await assinar("UNDEFINED");
  const corpo = corpoDoPost();
  const carteiras = corpo.split.map((f) => f.walletId);
  if (carteiras.includes(FELIPE)) throw new Error("a carteira da conta foi no split");
  for (const outra of [process.env.ASAAS_CARTEIRA_CAROL, process.env.ASAAS_CARTEIRA_SIRIUS]) {
    if (!carteiras.includes(outra)) throw new Error(`a carteira ${outra.slice(0, 8)} sumiu junto`);
  }
  return `${carteiras.length} fatias, nenhuma da conta`;
});

await etapa("a troca de plano também não manda a carteira da conta", async () => {
  await atualizarAssinatura({
    assinaturaId: "sub_1",
    planoId: "g:foto:1000",
    precoCentavos: 13999,
    ciclo: "mensal",
    descricao: "Teste",
  });
  const p = pedidos.find((x) => x.metodo === "PUT");
  if (!p) throw new Error("nenhum PUT");
  if (JSON.parse(p.corpo).split.some((f) => f.walletId === FELIPE)) throw new Error("foi no split");
  return "PUT sem ela";
});

await etapa("nem a cobrança da diferença", async () => {
  await criarCobrancaAvulsa({
    clienteAsaasId: "cus_1",
    centavos: 13999,
    vencimento: "2026-10-01",
    descricao: "Diferença",
    referencia: "olumier:x:diferenca",
    fatias: montarFatias("g:foto:1000", 13999, "mensal"),
  });
  const corpo = corpoDoPost("/payments");
  /* Sem split nenhum a etapa não provaria nada: o valor é o de um plano
     inteiro justamente para ter lucro a dividir. */
  if (!corpo.split?.length) throw new Error("a cobrança saiu sem split — a etapa não mediu nada");
  if (corpo.split.some((f) => f.walletId === FELIPE)) throw new Error("foi no split");
  return `POST /payments com ${corpo.split.length} fatias, nenhuma da conta`;
});

servidor.close();
console.log(falhou ? "\n✗ a cobrança automática tem problema" : "\n✓ cobrança automática ok");
process.exitCode = falhou ? 1 : 0;
