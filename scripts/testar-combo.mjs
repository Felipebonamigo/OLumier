#!/usr/bin/env node
/**
 * Testa o COMBO GALERIA ÁTOMO + ATOMATIZA — a cobrança dos dois juntos.
 * Uso: node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-combo.mjs
 *
 * ── O QUE FOI DECIDIDO (28/09/2026) ───────────────────────────────────────
 *
 * Quem assina os dois paga menos, e o desconto é dividido MEIO A MEIO entre as
 * plataformas: cada uma baixa a SUA assinatura na SUA metade, e divide com os
 * sócios pela própria regra. Quem já tem uma e assina a outra paga o mesmo
 * combo. Ver `src/config/combo.ts`.
 *
 * ── O QUE ESTE ARQUIVO PRENDE ─────────────────────────────────────────────
 *
 *   1. A TABELA. Os totais da proposta aprovada, os preços redondos dos dois
 *      lados, a divisão meio a meio e o lucro que continua positivo em toda
 *      faixa — com desconto, o split ainda tem o que dividir.
 *   2. O CONTRATO DAS DESCRIÇÕES. Cada lado lê o plano do outro na descrição da
 *      assinatura, no Asaas. Se a nossa deixar de dizer o tamanho, o Atomatiza
 *      para de achar a linha da tabela — em silêncio.
 *   3. A CONFERÊNCIA, contra um Asaas de mentira: só o Atomatiza vivo e em dia
 *      conta; o valor mudado à mão não é desfeito; subir de preço não mexe na
 *      fatura já emitida; o plano antigo não entra.
 *   4. O GATILHO no webhook (leitura do fonte, como `testar-periodo-pago`).
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, segundoEstudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

process.env.ASAAS_API_KEY = "chave-de-mentira";
delete process.env.ASAAS_AMBIENTE;

/* ── O Asaas de mentira ─────────────────────────────────────────────────── */

const estado = {
  clientes: [], // { id, cpfCnpj, externalReference, deleted? }
  assinaturas: [], // { id, customer, status, value, cycle, description, externalReference, deleted? }
  vencidas: new Set(), // ids de assinatura com cobrança OVERDUE
  pagas: new Set(), // ids de assinatura com alguma cobrança RECEIVED
};
const escritas = []; // { metodo, caminho, corpo }

const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (p) => (corpo += p));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const responder = (status, dados) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(dados));
    };
    const p = url.pathname;

    if (req.method !== "GET") {
      escritas.push({ metodo: req.method, caminho: p, corpo: JSON.parse(corpo || "{}") });
      const m = /^\/subscriptions\/([^/]+)$/.exec(p);
      const a = m && estado.assinaturas.find((x) => x.id === m[1]);
      if (!a) return responder(404, { errors: [{ description: "não achei" }] });
      const dados = JSON.parse(corpo || "{}");
      if (dados.value !== undefined) a.value = dados.value;
      if (dados.description !== undefined) a.description = dados.description;
      return responder(200, a);
    }

    if (p === "/customers") {
      const doc = url.searchParams.get("cpfCnpj");
      return responder(200, { data: estado.clientes.filter((c) => c.cpfCnpj === doc) });
    }
    let m = /^\/customers\/([^/]+)$/.exec(p);
    if (m) {
      const c = estado.clientes.find((x) => x.id === m[1]);
      return c ? responder(200, c) : responder(404, {});
    }
    if (p === "/subscriptions") {
      const cliente = url.searchParams.get("customer");
      return responder(200, { data: estado.assinaturas.filter((a) => a.customer === cliente) });
    }
    m = /^\/subscriptions\/([^/]+)\/payments$/.exec(p);
    if (m) {
      const cobrancas = [
        ...(estado.pagas.has(m[1]) ? [{ id: "pay_paga", status: "RECEIVED" }] : [{ id: "pay_aberta", status: "PENDING" }]),
        ...(estado.vencidas.has(m[1]) ? [{ id: "pay_vencida", status: "OVERDUE" }] : []),
      ];
      const filtro = url.searchParams.get("status");
      return responder(200, { data: cobrancas.filter((c) => !filtro || c.status === filtro) });
    }
    m = /^\/subscriptions\/([^/]+)$/.exec(p);
    if (m) {
      const a = estado.assinaturas.find((x) => x.id === m[1]);
      return a ? responder(200, a) : responder(404, {});
    }
    return responder(404, {});
  });
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
process.env.ASAAS_API = `http://127.0.0.1:${servidor.address().port}`;

const C = await import("../src/config/combo.ts");
const { faixaDoAtomatiza, recalcularCombo, recalcularComboDoCliente } = await import("../src/lib/combo.ts");
const { planoPorId, todasAsMontagens, montar, MESES_PAGOS_NO_ANO } = await import("../src/config/planos.ts");
const { lucroCentavos } = await import("../src/config/socios.ts");
const { marca } = await import("../src/config/marca.ts");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  escritas.length = 0;
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

/* Os preços do Atomatiza de hoje (`src/lib/planos.ts` de lá). Escritos aqui à
 * mão de propósito: a tabela é um acordo entre os dois preços, e este teste é
 * o lugar em que um reajuste de lá faz a conta daqui ficar vermelha. */
const ATOMATIZA = { solo: 5990, equipe: 8990, estudio: 19990 };
const LINHAS = ["250", "500", "1000"];
const FAIXAS = ["solo", "equipe", "estudio"];

try {
  console.log("\nA tabela:\n");

  await etapa("os três combos da proposta fecham no preço prometido", () => {
    const total = (gb, faixa) => {
      const g = montar({ segmento: "foto", espacoGb: gb });
      const d = C.DESCONTOS_DO_COMBO[C.linhaDaGaleria(gb)][faixa];
      return g.precoCentavos - d.galeria + ATOMATIZA[faixa] - d.atomatiza;
    };
    igual(total(250, "solo"), 8990, "250 GB + Solo");
    igual(total(500, "equipe"), 13990, "500 GB + Equipe");
    igual(total(1000, "estudio"), 26990, "1 TB + Estúdio");
    return "R$ 89,90 · R$ 139,90 · R$ 269,90";
  });

  await etapa("em todo par o desconto é meio a meio, e os dois preços fecham redondos", () => {
    for (const linha of LINHAS) {
      const g = montar({ segmento: "foto", espacoGb: Number(linha) });
      for (const faixa of FAIXAS) {
        const d = C.DESCONTOS_DO_COMBO[linha][faixa];
        if (d.atomatiza - d.galeria !== 1) {
          throw new Error(`${linha}/${faixa}: ${d.galeria} × ${d.atomatiza} não é meio a meio`);
        }
        if ((g.precoCentavos - d.galeria) % 100 !== 0) throw new Error(`${linha}/${faixa}: a Galeria não fecha em ,00`);
        if ((ATOMATIZA[faixa] - d.atomatiza) % 100 !== 90) throw new Error(`${linha}/${faixa}: o Atomatiza não fecha em ,90`);
      }
    }
    return "9 pares";
  });

  await etapa("toda montagem da grade, com qualquer combo, ainda deixa lucro para dividir", () => {
    let pares = 0;
    for (const m of todasAsMontagens()) {
      const plano = montar(m);
      for (const faixa of FAIXAS) {
        for (const ciclo of ["mensal", "anual"]) {
          const preco = C.precoDoCicloComComboCentavos(plano, ciclo, faixa);
          if (lucroCentavos(plano.id, preco, ciclo) <= 0) {
            throw new Error(`${plano.id} ${ciclo} + ${faixa}: R$ ${preco / 100} não paga o próprio custo`);
          }
          pares++;
        }
      }
    }
    return `${pares} combinações`;
  });

  await etapa("acima de 1 TB vale a linha de 1 TB, e plano antigo não entra", () => {
    igual(C.linhaDaGaleria(499), "250", "499 GB");
    igual(C.linhaDaGaleria(500), "500", "500 GB");
    igual(C.linhaDaGaleria(5000), "1000", "5 TB");
    const dois = planoPorId("g:foto:2000");
    igual(C.descontoDaGaleriaCentavos(dois, "estudio"), 2499, "2 TB + Estúdio");
    igual(C.descontoDaGaleriaCentavos(planoPorId("foto-100"), "estudio"), 0, "foto-100 (antigo)");
    igual(C.descontoDaGaleriaCentavos(planoPorId("g:foto:250"), null), 0, "sem Atomatiza");
  });

  await etapa("no anual o desconto é de dez mensalidades, como o próprio preço", () => {
    const p = planoPorId("g:foto:250");
    igual(C.precoDoCicloComComboCentavos(p, "anual", "solo"), (4999 - 999) * MESES_PAGOS_NO_ANO, "250 GB anual + Solo");
  });

  console.log("\nO contrato das descrições:\n");

  await etapa("a faixa do Atomatiza é lida na descrição que ele escreve", () => {
    igual(C.faixaDaDescricaoAtomatiza("Atomatiza — plano solo"), "solo", "solo");
    igual(C.faixaDaDescricaoAtomatiza("Atomatiza — plano equipe"), "equipe", "equipe");
    igual(C.faixaDaDescricaoAtomatiza("Atomatiza — plano estúdio"), "estudio", "estúdio");
    igual(C.faixaDaDescricaoAtomatiza("Atomatiza — plano estúdio · combo com a Galeria Átomo"), "estudio", "com combo");
    igual(C.faixaDaDescricaoAtomatiza("Atomatiza — plano mensal"), "solo", "antigo mensal");
    igual(C.faixaDaDescricaoAtomatiza("Atomatiza — plano anual"), "solo", "antigo anual");
    igual(C.faixaDaDescricaoAtomatiza("Galeria Átomo — Foto · 250 GB"), null, "a nossa");
    igual(C.faixaDaDescricaoAtomatiza(null), null, "vazia");
  });

  await etapa("a descrição que ESCREVEMOS continua dizendo o tamanho para o Atomatiza", () => {
    let n = 0;
    for (const m of todasAsMontagens()) {
      const plano = montar(m);
      for (const ciclo of ["mensal", "anual"]) {
        for (const faixa of [null, "equipe"]) {
          const d = C.descricaoDaAssinatura(marca.nome, plano, ciclo, faixa);
          if (C.gbDaDescricaoGaleria(d) !== plano.quotaGb) {
            throw new Error(`"${d}" lê ${C.gbDaDescricaoGaleria(d)} GB, o plano tem ${plano.quotaGb}`);
          }
          n++;
        }
      }
    }
    igual(
      C.descricaoDaAssinatura(marca.nome, planoPorId("g:foto:500"), "anual", "equipe"),
      `${marca.nome} — Foto · 500 GB (anual) · combo com o Atomatiza`,
      "descrição com combo",
    );
    return `${n} descrições`;
  });

  console.log("\nA conferência, contra um Asaas de mentira:\n");

  const DOC = "12345678909";
  const reset = () => {
    estado.clientes = [
      { id: "cus_nosso", cpfCnpj: DOC, externalReference: "olumier:x" },
      { id: "cus_atz", cpfCnpj: DOC, externalReference: "atz:studio:1" },
    ];
    estado.assinaturas = [];
    estado.vencidas = new Set();
    estado.pagas = new Set();
  };
  const atomatiza = (faixa, extra = {}, { paga = true } = {}) => {
    const a = {
      id: `sub_atz_${estado.assinaturas.length}`,
      customer: "cus_atz",
      status: "ACTIVE",
      value: ATOMATIZA[faixa] / 100,
      cycle: "MONTHLY",
      description: `Atomatiza — plano ${C.NOME_DA_FAIXA[faixa].toLowerCase()}`,
      externalReference: "atz:sub:studio-1",
      ...extra,
    };
    estado.assinaturas.push(a);
    if (paga) estado.pagas.add(a.id);
    return a;
  };

  await etapa("sem Atomatiza, não há combo", async () => {
    reset();
    igual(await faixaDoAtomatiza(DOC), null, "faixa");
  });

  await etapa("o Atomatiza vivo e em dia dá a faixa dele — no cliente de lá ou no nosso", async () => {
    reset();
    atomatiza("equipe");
    igual(await faixaDoAtomatiza(DOC), "equipe", "cliente de lá");
    reset();
    atomatiza("estudio", { customer: "cus_nosso" });
    igual(await faixaDoAtomatiza("123.456.789-09"), "estudio", "cliente nosso, documento com pontuação");
  });

  await etapa("atrasado, inativo ou apagado não conta", async () => {
    reset();
    const a = atomatiza("equipe");
    estado.vencidas.add(a.id);
    igual(await faixaDoAtomatiza(DOC), null, "com cobrança vencida");
    reset();
    atomatiza("equipe", { status: "INACTIVE" });
    igual(await faixaDoAtomatiza(DOC), null, "inativa");
    reset();
    atomatiza("equipe", { deleted: true });
    igual(await faixaDoAtomatiza(DOC), null, "apagada");
  });

  await etapa("assinatura do Atomatiza que nunca foi paga não dá combo", async () => {
    reset();
    atomatiza("equipe", {}, { paga: false });
    igual(await faixaDoAtomatiza(DOC), null, "sem pagamento");
  });

  await etapa("só conta assinatura com a referência do Atomatiza", async () => {
    reset();
    atomatiza("equipe", { externalReference: "olumier:qualquer" });
    igual(await faixaDoAtomatiza(DOC), null, "referência nossa");
    reset();
    atomatiza("equipe", { externalReference: null });
    igual(await faixaDoAtomatiza(DOC), null, "sem referência");
  });

  await etapa("com duas faixas vivas, vale a de desconto menor", async () => {
    reset();
    atomatiza("estudio");
    atomatiza("solo");
    igual(await faixaDoAtomatiza(DOC), "solo", "faixa");
  });

  /* O estúdio da rodada, com assinatura na nossa ponta. */
  const t = await estudioDaRodada(db);
  const nossa = (valor, extra = {}) => {
    const a = {
      id: "sub_nossa",
      customer: "cus_nosso",
      status: "ACTIVE",
      value: valor,
      cycle: "MONTHLY",
      description: "Galeria Átomo — Foto · 500 GB",
      externalReference: `olumier:${t.id}`,
      ...extra,
    };
    estado.assinaturas = estado.assinaturas.filter((x) => x.id !== "sub_nossa");
    estado.assinaturas.push(a);
    return a;
  };
  const prepararEstudio = async (planoId, ciclo = "mensal") => {
    await db.query(
      `update tenants set plano_id = $1, ciclo_cobranca = $2, cpf_cnpj = $3,
              asaas_assinatura_id = 'sub_nossa', combo_atomatiza = null where id = $4`,
      [planoId, ciclo, DOC, t.id],
    );
  };
  const comboNoBanco = async () =>
    (await db.query("select combo_atomatiza from tenants where id = $1", [t.id])).rows[0].combo_atomatiza;

  await etapa("entrou o Atomatiza: a nossa assinatura baixa, na fatura já emitida inclusive", async () => {
    reset();
    atomatiza("equipe");
    nossa(79.99);
    await prepararEstudio("g:foto:500");
    const r = await recalcularCombo(t.id, "teste");
    igual(r.depoisCentavos, 6500, "valor novo");
    igual(escritas.length, 1, "uma escrita no Asaas");
    const corpo = escritas[0].corpo;
    igual(corpo.value, 65, "value");
    igual(corpo.updatePendingPayments, true, "a fatura aberta baixa junto");
    if (!corpo.description.includes("combo com o Atomatiza")) throw new Error(`descrição: ${corpo.description}`);
    if (!Array.isArray(corpo.split)) throw new Error("o split não foi junto — os sócios dividiriam o preço velho");
    igual(await comboNoBanco(), "equipe", "combo_atomatiza");
    const ev = await db.query(
      "select detalhe from eventos where tenant_id = $1 and acao = 'assinatura.combo' order by criado_em desc limit 1",
      [t.id],
    );
    igual([ev.rows[0]?.detalhe?.deCentavos, ev.rows[0]?.detalhe?.paraCentavos], [7999, 6500], "evento registrado");
    return "R$ 79,99 → R$ 65,00";
  });

  await etapa("conferir de novo não escreve nada", async () => {
    const r = await recalcularCombo(t.id, "teste");
    igual([r.mudou, escritas.length], [false, 0], "mudou / escritas");
  });

  await etapa("o Atomatiza atrasou: volta ao cheio, mas a fatura já emitida fica como está", async () => {
    estado.vencidas.add(estado.assinaturas.find((a) => a.externalReference?.startsWith("atz:sub:")).id);
    const r = await recalcularCombo(t.id, "teste");
    igual(r.depoisCentavos, 7999, "valor");
    igual(escritas[0]?.corpo.updatePendingPayments, false, "updatePendingPayments");
    igual(await comboNoBanco(), null, "combo_atomatiza");
  });

  await etapa("valor mudado à mão no Asaas não é desfeito", async () => {
    reset();
    atomatiza("equipe");
    nossa(50.0);
    await prepararEstudio("g:foto:500");
    const avisos = [];
    const aviso = console.warn;
    console.warn = (m) => avisos.push(String(m));
    try {
      const r = await recalcularCombo(t.id, "teste");
      igual(r.mudou, false, "mudou");
    } finally {
      console.warn = aviso;
    }
    igual(escritas.length, 0, "escritas");
    if (!avisos.some((a) => a.includes("à mão"))) throw new Error("não avisou no log");
  });

  await etapa("anual com Solo: dez mensalidades já com o desconto", async () => {
    reset();
    atomatiza("solo");
    nossa(499.9, { cycle: "YEARLY" });
    await prepararEstudio("g:foto:250", "anual");
    const r = await recalcularCombo(t.id, "teste");
    igual(r.depoisCentavos, 40000, "valor");
    igual(escritas[0]?.corpo.value, 400, "value");
  });

  await etapa("plano antigo continua no preço dele, com ou sem Atomatiza", async () => {
    reset();
    atomatiza("estudio");
    nossa(99.0);
    await prepararEstudio("foto-100");
    const r = await recalcularCombo(t.id, "teste");
    igual([r.mudou, r.faixa, escritas.length], [false, null, 0], "mudou / faixa / escritas");
  });

  await etapa("assinatura nossa cancelada não é tocada", async () => {
    reset();
    atomatiza("equipe");
    nossa(79.99, { status: "INACTIVE" });
    await prepararEstudio("g:foto:500");
    igual(await recalcularCombo(t.id, "teste"), null, "resultado");
    igual(escritas.length, 0, "escritas");
  });

  await etapa("evento do Atomatiza acha o estúdio pelo documento, e só ele", async () => {
    reset();
    atomatiza("equipe");
    nossa(79.99);
    await prepararEstudio("g:foto:500");
    const vizinho = await segundoEstudioDaRodada(db);
    await db.query(
      "update tenants set plano_id = 'g:foto:500', cpf_cnpj = '98765432100', asaas_assinatura_id = 'sub_vizinho' where id = $1",
      [vizinho.id],
    );
    igual(await recalcularComboDoCliente("cus_atz", "PAYMENT_CONFIRMED"), 1, "estúdios conferidos");
    igual(escritas.map((e) => e.caminho), ["/subscriptions/sub_nossa"], "escritas");
  });

  await etapa("id de cliente forjado não vira outra rota da conta", async () => {
    let erro = null;
    try {
      await recalcularComboDoCliente("..", "teste");
    } catch (e) {
      erro = e.message;
    }
    if (!erro?.includes("identificador inválido")) throw new Error(`esperava recusa, veio ${erro}`);
  });

  console.log("\nO gatilho no webhook:\n");

  await etapa("evento do Atomatiza confere o combo depois da resposta, e o nosso pagamento também", () => {
    const fonte = readFileSync(new URL("../src/app/api/asaas/webhook/route.ts", import.meta.url), "utf8");
    const antesDeSair = fonte.indexOf('ignorado: "outro produto"');
    const gatilhoDeLa = fonte.indexOf("recalcularComboDoCliente(");
    if (gatilhoDeLa < 0 || gatilhoDeLa > antesDeSair) {
      throw new Error("o evento do Atomatiza sai do webhook sem conferir o combo");
    }
    if (!/after\(\(\) =>\s*recalcularComboDoCliente\(/.test(fonte)) {
      throw new Error("a conferência do Atomatiza não está em after() — seguraria a fila do Asaas");
    }
    if (!/after\(\(\) =>\s*recalcularCombo\(tenantId/.test(fonte)) {
      throw new Error("o nosso pagamento não confere o combo — um aviso perdido do Atomatiza nunca se acertaria");
    }
    if (!/\.catch\(/.test(fonte.slice(gatilhoDeLa, gatilhoDeLa + 200))) {
      throw new Error("erro na conferência sem .catch — vira rejeição solta no servidor");
    }
  });
} finally {
  await limparRodada(db);
  await db.end();
  servidor.close();
}

if (falhou) {
  console.error("\n✗ O combo tem etapa vermelha.\n");
  process.exit(1);
}
console.log("\n✓ Combo conferido.\n");
