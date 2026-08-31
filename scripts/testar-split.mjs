#!/usr/bin/env node
/**
 * Testa COMO o split chega ao Asaas — não quanto cada sócio ganha.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-split.mjs
 *
 * ── POR QUE ESTA SUÍTE EXISTE (31/08/2026) ────────────────────────────────
 *
 * O split nasceu dividindo o LUCRO: a reserva de custo ficava na conta
 * principal, que é de onde saem as faturas da Backblaze e da Cloudflare, e cada
 * sócio recebia um `fixedValue` calculado sobre o que sobrava. Em 31/08 o
 * Felipe mudou a regra: dividir a RECEITA, e acertar o custo entre os sócios
 * por fora.
 *
 * A mudança parece de uma linha e não é, por causa de uma regra do Asaas:
 *
 *   O SPLIT É VALIDADO CONTRA O VALOR LÍQUIDO, não contra o valor da cobrança.
 *
 * Líquido é o que sobra depois da taxa — e a taxa DEPENDE DO MEIO DE PAGAMENTO,
 * que aqui é escolha do cliente (`billingType: "UNDEFINED"`). Pix, boleto e
 * cartão cobram valores diferentes, e o cartão cobra percentual. Ou seja: no
 * momento em que a assinatura é criada, ninguém sabe qual será a taxa.
 *
 * Dividir "toda a receita" com `fixedValue` seria, então, chutar a taxa. Chute
 * baixo e a soma passa do líquido: o Asaas BLOQUEIA a cobrança, dispara
 * `PAYMENT_SPLIT_DIVERGENCE_BLOCK`, dá 2 dias úteis para consertar e depois
 * cancela os splits. Chute alto e sobra dinheiro parado sem dono.
 *
 * Por isso a base "receita" vai em PERCENTUAL: o Asaas aplica a porcentagem
 * sobre o líquido que ele mesmo calculou, a soma nunca passa de 100% e a taxa
 * deixa de ser adivinhação. É o que esta suíte prende — e ela existe porque o
 * defeito que ela evita não aparece em teste nenhum: aparece dois dias depois,
 * na primeira cobrança de verdade, em forma de webhook de bloqueio.
 */
import { createServer } from "node:http";

/* Mesma armadilha do `testar-asaas.mjs`: no `.env.local` a chave existe VAZIA,
 * e string vazia é "definida" — `??=` não preencheria. Vale a falsidade. */
if (!process.env.ASAAS_API_KEY?.trim()) process.env.ASAAS_API_KEY = "chave-de-mentira";
delete process.env.ASAAS_AMBIENTE;

/* Carteiras de mentira ANTES do import: `montarFatias` lê o ambiente em cada
 * chamada, mas quem lê a lista de sócios é o módulo, e ler o ambiente cedo
 * demais é o tipo de acoplamento que faz a suíte passar sozinha e falhar em
 * bateria. Aqui elas entram antes de qualquer coisa, e pronto. */
const CARTEIRAS = {
  ASAAS_CARTEIRA_FELIPE: "11111111-1111-1111-1111-111111111111",
  ASAAS_CARTEIRA_CAROL: "22222222-2222-2222-2222-222222222222",
  ASAAS_CARTEIRA_SIRIUS: "33333333-3333-3333-3333-333333333333",
};
for (const [k, v] of Object.entries(CARTEIRAS)) process.env[k] = v;

const pedidos = [];
const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (p) => (corpo += p));
  req.on("end", () => {
    pedidos.push({ metodo: req.method, caminho: req.url, corpo });
    /* A busca por assinatura viva devolve lista vazia, senão `criarAssinatura`
       encontra uma e volta sem fazer o POST — que é justamente o que queremos
       inspecionar. */
    const vazio = req.url.startsWith("/subscriptions?");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(vazio ? '{"data":[]}' : '{"id":"sub_1","status":"ACTIVE"}');
  });
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
process.env.ASAAS_API = `http://127.0.0.1:${servidor.address().port}`;

const { criarAssinatura } = await import("../src/lib/asaas.ts");
const { SOCIOS, BASE_DO_SPLIT, montarFatias } = await import("../src/config/socios.ts");

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

const assinar = (planoId = "g:foto:1000", precoCentavos = 13999, ciclo = "mensal") =>
  criarAssinatura({
    clienteAsaasId: "cus_1",
    tenantId: "11111111-2222-3333-4444-555555555555",
    planoId,
    precoCentavos,
    ciclo,
    descricao: "Teste de split",
    primeiroVencimento: new Date("2026-09-01"),
  });

/** O split que foi de fato enviado no POST da assinatura. */
function splitEnviado() {
  const post = pedidos.find((p) => p.metodo === "POST" && p.caminho.startsWith("/subscriptions"));
  if (!post) throw new Error("nenhum POST de assinatura chegou ao servidor");
  const corpo = JSON.parse(post.corpo);
  if (!Array.isArray(corpo.split)) throw new Error("a assinatura foi criada sem split");
  return corpo.split;
}

console.log("a divisão");

await etapa("os percentuais dos sócios somam 100", () => {
  const soma = SOCIOS.reduce((t, s) => t + s.percentual, 0);
  if (soma !== 100) throw new Error(`somam ${soma}, não 100`);
  return SOCIOS.map((s) => `${s.nome} ${s.percentual}%`).join(" · ");
});

await etapa("a base do split está declarada", () => {
  if (BASE_DO_SPLIT !== "lucro" && BASE_DO_SPLIT !== "receita") {
    throw new Error(`base desconhecida: ${BASE_DO_SPLIT}`);
  }
  return BASE_DO_SPLIT;
});

console.log("\no que chega ao Asaas");

await etapa("dividindo a receita, o split vai em PERCENTUAL", async () => {
  if (BASE_DO_SPLIT !== "receita") return "base é lucro — etapa não se aplica";
  await assinar();
  const split = splitEnviado();
  const comValorFixo = split.filter((f) => f.fixedValue !== undefined);
  if (comValorFixo.length) {
    throw new Error(
      `${comValorFixo.length} fatia(s) em valor fixo — a taxa do Asaas depende do meio de ` +
        `pagamento, então valor fixo sobre a receita inteira estoura o líquido e bloqueia a cobrança`,
    );
  }
  if (split.some((f) => typeof f.percentualValue !== "number")) {
    throw new Error("fatia sem percentualValue");
  }
  return `${split.length} fatias em percentual`;
});

await etapa("a soma do split nunca passa de 100%", async () => {
  if (BASE_DO_SPLIT !== "receita") return "base é lucro — etapa não se aplica";
  await assinar();
  const split = splitEnviado();
  const soma = split.reduce((t, f) => t + (f.percentualValue ?? 0), 0);
  if (soma > 100) {
    throw new Error(`soma ${soma}% — o Asaas bloqueia a cobrança e cancela o split em 2 dias`);
  }
  if (soma === 0) throw new Error("nenhuma fatia trouxe percentual — a soma de zero não prova nada");
  return `${soma}%`;
});

await etapa("cada sócio configurado aparece uma vez, com a carteira dele", async () => {
  await assinar();
  const split = splitEnviado();
  for (const socio of SOCIOS) {
    const carteira = process.env[socio.variavelCarteira];
    const dele = split.filter((f) => f.walletId === carteira);
    if (dele.length !== 1) throw new Error(`${socio.nome}: ${dele.length} fatias, esperava 1`);
  }
  return `${split.length} sócios`;
});

await etapa("sócio sem carteira fica de fora, e a parte dele fica na conta", async () => {
  const guardada = process.env.ASAAS_CARTEIRA_CAROL;
  delete process.env.ASAAS_CARTEIRA_CAROL;
  try {
    await assinar();
    const split = splitEnviado();
    if (split.some((f) => f.walletId === guardada)) {
      throw new Error("a carteira apagada continuou no split");
    }
    const soma = split.reduce((t, f) => t + (f.percentualValue ?? 0), 0);
    const esperado = SOCIOS.filter((s) => s.id !== "carol").reduce((t, s) => t + s.percentual, 0);
    if (BASE_DO_SPLIT === "receita" && soma !== esperado) {
      throw new Error(`soma ${soma}%, esperava ${esperado}%`);
    }
    return `${split.length} fatias, ${100 - esperado}% ficou na conta principal`;
  } finally {
    process.env.ASAAS_CARTEIRA_CAROL = guardada;
  }
});

/*
 * O ANUAL NÃO PODE MULTIPLICAR O PERCENTUAL.
 *
 * Na base "lucro" o ciclo importa muito: a reserva de doze meses precisa ficar
 * na conta, e por isso `lucroCentavos` recebe o ciclo. Em percentual o ciclo não
 * muda nada — 25% de uma cobrança anual já são 25% do ano inteiro. Um `* 12`
 * distraído aqui viraria 300% e bloquearia a cobrança.
 */
await etapa("no plano anual o percentual continua o mesmo", async () => {
  if (BASE_DO_SPLIT !== "receita") return "base é lucro — etapa não se aplica";
  await assinar("g:foto:1000", 13999 * 10, "anual");
  const split = splitEnviado();
  for (const f of split) {
    const socio = SOCIOS.find((s) => process.env[s.variavelCarteira] === f.walletId);
    if (f.percentualValue !== socio.percentual) {
      throw new Error(`${socio.nome}: ${f.percentualValue}%, esperava ${socio.percentual}%`);
    }
  }
  return "percentuais intactos";
});

console.log("\na conta bate");

await etapa("montarFatias devolve o percentual quando a base é receita", () => {
  if (BASE_DO_SPLIT !== "receita") return "base é lucro — etapa não se aplica";
  const fatias = montarFatias("g:foto:1000", 13999, "mensal");
  for (const f of fatias) {
    if (f.percentual !== f.socio.percentual) {
      throw new Error(`${f.socio.nome}: percentual ${f.percentual}, esperava ${f.socio.percentual}`);
    }
  }
  return `${fatias.length} fatias`;
});

/* `process.exit()` aqui derruba o Node com uma asserção do libuv
   ("UV_HANDLE_CLOSING", em win/async.c) e devolve 127 — que a bateria leria
   como suíte QUEBRADA, não como suíte vermelha, escondendo a falha real. Fecha
   o servidor e deixa o processo terminar sozinho, com o código no `exitCode`.
   É o mesmo fim do `testar-asaas.mjs`, e pelo mesmo motivo. */
servidor.close();
console.log(falhou ? "\n✗ o split tem problema" : "\n✓ split ok");
process.exitCode = falhou ? 1 : 0;
