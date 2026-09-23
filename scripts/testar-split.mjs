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
const CARTEIRA_OPERACAO = "44444444-4444-4444-4444-444444444444";
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

await etapa("o split vai em PERCENTUAL, nunca em valor fixo", async () => {
  await assinar();
  const split = splitEnviado();
  const comValorFixo = split.filter((f) => f.fixedValue !== undefined);
  if (comValorFixo.length) {
    throw new Error(
      `${comValorFixo.length} fatia(s) em valor fixo — a taxa do Asaas depende do meio de ` +
        `pagamento, então valor fixo é chute, e chute baixo bloqueia a cobrança`,
    );
  }
  if (split.some((f) => typeof f.percentualValue !== "number")) {
    throw new Error("fatia sem percentualValue");
  }
  return `${split.length} fatias em percentual`;
});

await etapa("a soma do split nunca passa de 100%", async () => {
  await assinar();
  const split = splitEnviado();
  const soma = split.reduce((t, f) => t + (f.percentualValue ?? 0), 0);
  if (soma > 100) {
    throw new Error(`soma ${soma}% — o Asaas bloqueia a cobrança e cancela o split em 2 dias`);
  }
  if (soma === 0) throw new Error("nenhuma fatia trouxe percentual — a soma de zero não prova nada");
  return `${soma.toFixed(2)}%`;
});

/*
 * ── A ETAPA QUE PAGA A FATURA ─────────────────────────────────────────────
 *
 * Dividindo o lucro, o que NÃO é distribuído é a reserva de custo: é dela que
 * saem a Backblaze e a Cloudflare. Se o split levar tudo, a fatura passa a sair
 * do bolso de quem opera — que foi exatamente o descoberto de R$ 5.501,75 (ano
 * de 10 TB) que fez o Felipe voltar atrás em 31/08/2026.
 *
 * A conta é medida faixa por faixa porque a reserva varia MUITO: 12,7% da
 * receita em 100 GB, 74,8% em 10 TB. Uma etapa que olhasse só um plano passaria
 * verde no plano pequeno e deixaria o grande sangrar.
 */
/*
 * ── ESTA ETAPA JÁ FOI TAUTOLÓGICA (05/09/2026) ────────────────────────────
 *
 * Ela media a reserva contra um líquido calculado com a MESMA constante de taxa
 * que a reserva usava. Qualquer valor de taxa passava — errado inclusive — porque
 * o erro se cancelava nos dois lados da conta. Era um teste que provava que o
 * código concorda consigo mesmo.
 *
 * A taxa REAL veio da conta do Felipe (`GET /myAccount/fees`, 05/09/2026):
 *
 *     boleto  R$ 1,99      pix  R$ 1,99      cartão  R$ 0,49 + 2,99%
 *
 * O código assumia R$ 3,00 fixo. No Pix e no boleto isso reserva DEMAIS, que é
 * inofensivo. No cartão reserva de MENOS, e o cartão é justamente a opção que
 * virou padrão da tela em 05/09: a 10 TB anual faltavam R$ 211,47 para pagar a
 * Backblaze — direto do bolso de quem opera.
 *
 * Agora o líquido é calculado com a taxa do CARTÃO, medida na conta, e não com a
 * constante do código. É a única forma de a etapa medir a realidade em vez do
 * próprio umbigo.
 */
const TAXA_CARTAO_REAL = (preco) => Math.ceil(49 + preco * 0.0299);

await etapa("a reserva paga a fatura mesmo na taxa real do cartão", async () => {
  if (BASE_DO_SPLIT !== "lucro") {
    throw new Error("base é receita — não existe reserva, e a fatura sai do bolso de quem opera");
  }
  const { ESPACOS, montar } = await import("../src/config/planos.ts");
  const { lucroCentavos, taxaCobrancaCentavos } = await import("../src/config/socios.ts");
  let pior = Infinity;
  let piorFaixa = "";

  for (const f of ESPACOS) {
    const p = montar({ segmento: "foto", espacoGb: f.gb });
    for (const ciclo of ["mensal", "anual"]) {
      const preco = ciclo === "anual" ? f.precoCentavos * 10 : f.precoCentavos;

      /* O CUSTO do fornecedor: a reserva menos a taxa que ela embute. É o número
         que precisa sobrar na conta — a Backblaze não aceita percentual. */
      const custo = preco - lucroCentavos(p.id, preco, ciclo) - taxaCobrancaCentavos(preco);

      /* O que o Asaas realmente deposita, e sobre o que ele aplica o percentual
         do split: o preço menos a taxa DE VERDADE, não a estimada. */
      const liquidoReal = preco - TAXA_CARTAO_REAL(preco);
      const distribuido = montarFatias(p.id, preco, ciclo)
        .filter((x) => x.socio.id !== "operacao")
        .reduce((t, x) => t + (x.percentual ?? 0), 0);
      const sobra = liquidoReal - Math.round((liquidoReal * distribuido) / 100);

      if (sobra < custo) {
        throw new Error(
          `${f.gb} GB ${ciclo}: sobram R$ ${(sobra / 100).toFixed(2)} para um custo de ` +
            `R$ ${(custo / 100).toFixed(2)} — faltam R$ ${((custo - sobra) / 100).toFixed(2)} ` +
            `do bolso de quem opera`,
        );
      }
      if (sobra - custo < pior) {
        pior = sobra - custo;
        piorFaixa = `${f.gb} GB ${ciclo}`;
      }
    }
  }
  return `folga mínima R$ ${(pior / 100).toFixed(2)} em ${piorFaixa}`;
});

/*
 * A taxa que o código reserva não pode ficar ABAIXO da que o Asaas cobra. É a
 * mesma verdade da etapa acima, dita sobre a função em vez de sobre a grade —
 * assim o dia em que alguém "simplificar" a taxa de volta para um número fixo
 * falha aqui, com o nome do defeito na mensagem.
 */
await etapa("a taxa reservada cobre a taxa real do cartão", async () => {
  const { taxaCobrancaCentavos } = await import("../src/config/socios.ts");
  for (const preco of [4999, 13999, 79999, 139990, 799990]) {
    const reservada = taxaCobrancaCentavos(preco);
    const real = TAXA_CARTAO_REAL(preco);
    if (reservada < real) {
      throw new Error(
        `em R$ ${(preco / 100).toFixed(2)} o código reserva R$ ${(reservada / 100).toFixed(2)} ` +
          `e o Asaas cobra R$ ${(real / 100).toFixed(2)}`,
      );
    }
  }
  return `R$ 0,49 + 2,99% · em R$ 799,99 são R$ ${(taxaCobrancaCentavos(79999) / 100).toFixed(2)}`;
});

/*
 * ── O CUSTO EM TRÊS PARTES IGUAIS ─────────────────────────────────────────
 *
 * Acordo de 01/09/2026: o custo todo dividido em três, e o que sobra 50/25/25.
 * Em conta: cada um recebe `fatia × líquido − custo/3`.
 *
 * Isso tem duas bordas que o rateio proporcional não tinha, e as duas viram
 * dinheiro errado se ninguém prender:
 *
 *   1. Um terço do custo pode ser MAIOR que a fatia de quem tem 25%. Acontece
 *      quando o custo passa de 75% da receita — o anual de 5 TB e o de 10 TB
 *      estão lá. Split negativo não existe: a fatia trava em zero.
 *
 *   2. Travar em zero SOBE a soma distribuída, e a soma não pode passar do
 *      lucro: o que passar sai da reserva, que é o dinheiro do fornecedor. Por
 *      isso, depois de travar, o excedente é tirado de quem ainda tem de onde.
 */
await etapa("com o custo em terços, ninguém fica negativo e a reserva fica inteira", async () => {
  const { RATEIO_DO_CUSTO } = await import("../src/config/socios.ts");
  if (RATEIO_DO_CUSTO !== "igual") throw new Error(`rateio é "${RATEIO_DO_CUSTO}", esperava "igual"`);

  const { ESPACOS, montar } = await import("../src/config/planos.ts");
  const { lucroCentavos, taxaCobrancaCentavos } = await import("../src/config/socios.ts");
  let zerados = 0;

  for (const f of ESPACOS) {
    const p = montar({ segmento: "foto", espacoGb: f.gb });
    for (const ciclo of ["mensal", "anual"]) {
      const preco = ciclo === "anual" ? f.precoCentavos * 10 : f.precoCentavos;
      const liquido = preco - taxaCobrancaCentavos(preco);
      const lucro = lucroCentavos(p.id, preco, ciclo);
      const fatias = montarFatias(p.id, preco, ciclo);

      for (const x of fatias) {
        if (x.percentual <= 0) throw new Error(`${f.gb} GB ${ciclo}: ${x.socio.nome} com ${x.percentual}%`);
      }
      const distribuido = fatias.reduce((t, x) => t + Math.round((liquido * x.percentual) / 100), 0);
      if (distribuido > lucro) {
        throw new Error(
          `${f.gb} GB ${ciclo}: distribui R$ ${(distribuido / 100).toFixed(2)} e o lucro é ` +
            `R$ ${(lucro / 100).toFixed(2)} — a diferença sai da reserva do fornecedor`,
        );
      }
      if (fatias.length < SOCIOS.length) zerados++;
    }
  }
  return zerados === 0
    ? "todas as faixas com os três recebendo"
    : `${zerados} faixa(s) em que alguém zerou (o terço dele passou da fatia)`;
});

await etapa("o custo em terços bate com a conta na mão", async () => {
  const { lucroCentavos, taxaCobrancaCentavos } = await import("../src/config/socios.ts");
  const preco = 13999;
  const liquido = preco - taxaCobrancaCentavos(preco);
  const custo = liquido - lucroCentavos("g:foto:1000", preco, "mensal");
  const terco = custo / 3;

  for (const f of montarFatias("g:foto:1000", preco, "mensal")) {
    const naMao = (liquido * f.socio.percentual) / 100 - terco;
    const recebido = (liquido * f.percentual) / 100;
    /* Tolerância de um centavo: o percentual é arredondado para baixo em duas
       casas, e a diferença vai para a reserva de propósito. */
    if (recebido > naMao + 1 || recebido < naMao - liquido * 0.0001 - 1) {
      throw new Error(
        `${f.socio.nome}: recebe R$ ${(recebido / 100).toFixed(2)}, a conta dá ` +
          `R$ ${(naMao / 100).toFixed(2)}`,
      );
    }
  }
  return `custo R$ ${(custo / 100).toFixed(2)} · terço R$ ${(terco / 100).toFixed(2)}`;
});

await etapa("nenhum sócio recebe mais do que o percentual nominal dele", async () => {
  const fatias = montarFatias("g:foto:1000", 13999, "mensal");
  for (const f of fatias) {
    if (f.socio.id === "operacao") continue;
    if ((f.percentual ?? 0) > f.socio.percentual) {
      throw new Error(`${f.socio.nome}: ${f.percentual}% acima do nominal ${f.socio.percentual}%`);
    }
  }
  return fatias
    .filter((f) => f.socio.id !== "operacao")
    .map((f) => `${f.socio.nome} ${f.percentual}%`)
    .join(" · ");
});

/*
 * O CAIXA DA OPERAÇÃO é opcional, e as duas metades precisam funcionar: sem ele
 * a reserva fica na conta principal (o Asaas deixa o não distribuído lá), com
 * ele a reserva vira linha nomeada e a soma fecha 100%.
 */
await etapa("sem carteira de operação, a reserva fica na conta principal", async () => {
  delete process.env.ASAAS_CARTEIRA_OPERACAO;
  await assinar();
  const split = splitEnviado();
  if (split.some((f) => f.walletId === CARTEIRA_OPERACAO)) {
    throw new Error("mandou fatia para uma carteira de operação que não está configurada");
  }
  const soma = split.reduce((t, f) => t + f.percentualValue, 0);
  if (soma >= 100) throw new Error(`soma ${soma}% — não sobrou reserva na conta`);
  return `${(100 - soma).toFixed(2)}% ficou na conta`;
});

await etapa("com carteira de operação, a reserva vira linha e a soma fecha 100%", async () => {
  process.env.ASAAS_CARTEIRA_OPERACAO = CARTEIRA_OPERACAO;
  try {
    await assinar();
    const split = splitEnviado();
    const daOperacao = split.find((f) => f.walletId === CARTEIRA_OPERACAO);
    if (!daOperacao) throw new Error("a reserva não virou fatia");
    const soma = split.reduce((t, f) => t + f.percentualValue, 0);
    if (Math.abs(soma - 100) > 0.001) throw new Error(`soma ${soma}%, esperava 100%`);
    return `operação com ${daOperacao.percentualValue}%`;
  } finally {
    delete process.env.ASAAS_CARTEIRA_OPERACAO;
  }
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
  const carol = SOCIOS.find((s) => s.id === "carol");
  const dela = montarFatias("g:foto:1000", 13999, "mensal").find((f) => f.socio.id === "carol");
  if (!dela) throw new Error("a Carol não aparece nem com carteira configurada");

  const guardada = process.env.ASAAS_CARTEIRA_CAROL;
  delete process.env.ASAAS_CARTEIRA_CAROL;
  try {
    await assinar();
    const split = splitEnviado();
    if (split.some((f) => f.walletId === guardada)) {
      throw new Error("a carteira apagada continuou no split");
    }
    if (split.length !== SOCIOS.length - 1) {
      throw new Error(`${split.length} fatias, esperava ${SOCIOS.length - 1}`);
    }
    /* A fatia dela não pode ter sido REDISTRIBUÍDA entre os outros: quem não tem
       carteira ainda tem direito, e o dinheiro espera na conta em vez de virar
       lucro alheio calado. */
    for (const f of split) {
      const socio = SOCIOS.find((s) => process.env[s.variavelCarteira] === f.walletId);
      const esperado = montarFatias("g:foto:1000", 13999, "mensal").find(
        (x) => x.socio.id === socio.id,
      );
      if (f.percentualValue !== esperado.percentual) {
        throw new Error(
          `${socio.nome} passou de ${esperado.percentual}% para ${f.percentualValue}% — ` +
            `a parte da ${carol.nome} foi redistribuída em vez de esperar na conta`,
        );
      }
    }
    const soma = split.reduce((t, f) => t + f.percentualValue, 0);
    return `${split.length} fatias · os ${dela.percentual}% dela ficaram na conta, com a reserva ` +
      `(${(100 - soma).toFixed(2)}% no total)`;
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
await etapa("o anual não multiplica o percentual", async () => {
  await assinar("g:foto:1000", 13999 * 10, "anual");
  const split = splitEnviado();
  for (const f of split) {
    const socio = SOCIOS.find((s) => process.env[s.variavelCarteira] === f.walletId);
    if (!socio) continue;
    if (f.percentualValue > socio.percentual) {
      throw new Error(
        `${socio.nome}: ${f.percentualValue}% acima do nominal ${socio.percentual}% — ` +
          `um "* 12" distraído aqui viraria 300% e bloquearia a cobrança`,
      );
    }
  }
  const soma = split.reduce((t, f) => t + f.percentualValue, 0);
  return `soma ${soma.toFixed(2)}% no ano`;
});

console.log("\na conta bate");

await etapa("toda fatia sai com percentual, nas duas bases", async () => {
  const { taxaCobrancaCentavos: taxaDoPreco } = await import("../src/config/socios.ts");
  const fatias = montarFatias("g:foto:1000", 13999, "mensal");
  if (fatias.length === 0) throw new Error("nenhuma fatia — as carteiras de teste sumiram?");
  for (const f of fatias) {
    if (typeof f.percentual !== "number" || f.percentual <= 0) {
      throw new Error(`${f.socio.nome}: percentual ${f.percentual}`);
    }
    /* `centavos` é estimativa (a taxa real depende do meio de pagamento), mas
       não pode divergir do percentual — é o número que o extrato vai mostrar. */
    const esperado = Math.floor(((13999 - taxaDoPreco(13999)) * f.percentual) / 100);
    if (f.centavos !== esperado) {
      throw new Error(`${f.socio.nome}: centavos ${f.centavos}, esperava ${esperado}`);
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
