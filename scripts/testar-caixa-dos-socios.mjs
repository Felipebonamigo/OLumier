#!/usr/bin/env node
/**
 * O CAIXA DOS SÓCIOS — Galeria Átomo e Atomatiza numa página só. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-caixa-dos-socios.mjs
 *
 * Felipe, 29/09/2026: "os mesmos 3 sócios nos 2 sistemas. Só muda a
 * porcentagem de cada um para cada sistema." O que prende aqui:
 *
 *  1. CADA PAGAMENTO NO SEU PRODUTO — pelo `externalReference`, e o que não é
 *     de nenhum dos dois numa coluna própria, em vez de engordar um lado.
 *  2. O DINHEIRO FECHA — em cada produto, o que foi para os sócios mais o que
 *     ficou na conta é exatamente o líquido. Repasse cancelado conta como
 *     ficou na conta, e não como pago.
 *  3. OS TRÊS SÓCIOS SEMPRE APARECEM, e carteira desconhecida aparece com o
 *     final do código, nunca some.
 *  4. O CUSTO DOS DOIS É CONTADO UMA VEZ, e o painel da Galeria continua
 *     vendo o mesmo custo fixo de antes.
 *  5. SÓ O ADMIN MUDA A LISTA — a ação confere de novo, porque server action é
 *     endpoint; e a página não existe para estúdio comum.
 *  6. O ASAAS É LIDO INTEIRO — paginado, com as datas certas, e avisando
 *     quando a lista passou do teto.
 */
import { registerHooks } from "node:module";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

/* A ação importa o portão do admin e o `redirect` do Next. Os dois trocados
 * por cascas: o portão devolve quem o teste disser, e o redirect lança o
 * endereço para o teste ler — que é o que o do Next faz, com outro nome. */
const CASCAS = {
  "@/lib/portao-admin": "export const adminDaRequisicao = async () => globalThis.__admin ?? null;",
  "next/navigation": `export function redirect(url) { const e = new Error("REDIRECT"); e.url = url; throw e; }`,
  "next/cache": "export const revalidatePath = () => {};",
};
registerHooks({
  resolve(esp, ctx, proximo) {
    if (CASCAS[esp] && ctx.parentURL?.includes("/admin/caixa/")) {
      return { url: `casca:${esp}`, shortCircuit: true };
    }
    return proximo(esp, ctx);
  },
  load(url, ctx, proximo) {
    if (url.startsWith("casca:")) return { format: "module", source: CASCAS[url.slice(6)], shortCircuit: true };
    return proximo(url, ctx);
  },
});

const caixa = await import("../src/lib/caixa-dos-socios.ts");
const regras = await import("../src/lib/custos-da-sociedade-regras.ts");
const { custoFixoMensalCentavos } = await import("../src/config/custos-fixos.ts");

let falhou = false;
async function etapa(nome, fn) {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
  }
};

// ---------------------------------------------------------------------------
console.log("\nCada pagamento no seu produto\n");

await etapa("olumier: é da Galeria, atz: do Atomatiza, o resto de nenhum", () => {
  igual(caixa.sistemaDaReferencia("olumier:abc"), "galeria", "mensalidade");
  igual(caixa.sistemaDaReferencia("olumier:abc:diferenca:1"), "galeria", "diferença");
  igual(caixa.sistemaDaReferencia("atz:sub:st-1"), "atomatiza", "assinatura");
  igual(caixa.sistemaDaReferencia("atz:dif:st-1:2"), "atomatiza", "diferença de lá");
  igual(caixa.sistemaDaReferencia(null), "outros", "sem referência");
  igual(caixa.sistemaDaReferencia("xolumier:abc"), "outros", "parecido não é igual");
});

await etapa("o valor de um repasse: o calculado pelo Asaas, senão o fixo, senão o percentual", () => {
  igual(caixa.centavosDoRepasse({ totalValue: 12.34, fixedValue: 99 }, 5000), 1234, "totalValue manda");
  igual(caixa.centavosDoRepasse({ fixedValue: 10 }, 5000), 1000, "fixo");
  igual(caixa.centavosDoRepasse({ percentualValue: 33.3333 }, 8791), 2930, "percentual do líquido, para baixo");
  igual(caixa.centavosDoRepasse({}, 5000), 0, "vazio");
});

// ---------------------------------------------------------------------------
console.log("\nO dinheiro fecha\n");

const CARTEIRAS = caixa.carteirasConhecidas({
  ASAAS_CARTEIRA_FELIPE: "w-felipe",
  ASAAS_CARTEIRA_CAROL: "w-carol",
  ASAAS_CARTEIRA_SIRIUS: "w-sirius",
});

const PAGAMENTOS = [
  // Galeria, 500 GB com o pacote, no Pix. Split do lucro para os três.
  {
    id: "pay_g1", status: "RECEIVED", value: 65.87, netValue: 63.88, billingType: "PIX",
    paymentDate: "2026-09-10", externalReference: "olumier:t-1", description: "Galeria Átomo — Foto · 500 GB",
    split: [
      { walletId: "w-felipe", totalValue: 20.5, status: "DONE" },
      { walletId: "w-carol", totalValue: 10.25, status: "DONE" },
      { walletId: "w-sirius", totalValue: 10.25, status: "DONE" },
    ],
  },
  // Atomatiza, Equipe com o pacote, no cartão. Carol e Sirius num terço cada,
  // e uma carteira que a Galeria não conhece.
  {
    id: "pay_a1", status: "RECEIVED", value: 74.03, netValue: 71.33, billingType: "CREDIT_CARD",
    paymentDate: "2026-09-12", externalReference: "atz:sub:st-1", description: "Atomatiza — plano equipe",
    split: [
      { walletId: "w-carol", percentualValue: 33.3333, totalValue: 23.77, status: "DONE" },
      { walletId: "w-sirius", percentualValue: 33.3333, totalValue: 23.77, status: "DONE" },
      { walletId: "w-desconhecida-abc123", fixedValue: 1, status: "DONE" },
    ],
  },
  // Repasse cancelado: o dinheiro ficou na conta.
  {
    id: "pay_a2", status: "RECEIVED", value: 10, netValue: 8.01, billingType: "PIX",
    paymentDate: "2026-09-13", externalReference: "atz:dif:st-1:9", description: "Atomatiza — diferença",
    split: [{ walletId: "w-carol", totalValue: 2.67, status: "CANCELLED" }],
  },
  // Lançado à mão no painel do Asaas, sem produto.
  { id: "pay_x", status: "RECEIVED_IN_CASH", value: 30, netValue: 30, paymentDate: "2026-09-14" },
  // Não entram: aprovado e não liberado, e estornado.
  { id: "pay_c", status: "CONFIRMED", value: 99, netValue: 95, externalReference: "olumier:t-2", estimatedCreditDate: "2026-10-20" },
  { id: "pay_r", status: "REFUNDED", value: 50, netValue: 48, paymentDate: "2026-09-11", externalReference: "olumier:t-3" },
];

const c = caixa.montarCaixa(PAGAMENTOS, CARTEIRAS);

await etapa("só o que caiu na conta entra, cada um no seu produto", () => {
  igual(c.porSistema.galeria.pagamentos, 1, "galeria");
  igual(c.porSistema.atomatiza.pagamentos, 2, "atomatiza");
  igual(c.porSistema.outros.pagamentos, 1, "sem produto");
  igual(c.total.brutoCentavos, 6587 + 7403 + 1000 + 3000, "bruto");
  igual(c.total.taxaCentavos, (6587 - 6388) + (7403 - 7133) + (1000 - 801), "taxa");
});

await etapa("em cada produto, repassado + ficou na conta = líquido", () => {
  for (const s of caixa.SISTEMAS) {
    const somaDestinos = c.destinos.reduce((t, d) => t + d.porSistema[s], 0);
    igual(somaDestinos, c.porSistema[s].liquidoCentavos, s);
  }
  igual(c.destinos.find((d) => d.destino.chave === "conta").porSistema.galeria, 6388 - 4100, "reserva da Galeria");
});

await etapa("a mesma pessoa soma os dois produtos, cada um com a sua porcentagem", () => {
  const carol = c.destinos.find((d) => d.destino.nome === "Carol");
  igual(carol.porSistema, { galeria: 1025, atomatiza: 2377, outros: 0 }, "Carol");
  igual(carol.totalCentavos, 3402, "total da Carol");
  const felipe = c.destinos.find((d) => d.destino.nome === "Felipe");
  igual(felipe.porSistema.atomatiza, 0, "o Felipe não tem repasse no Atomatiza — o dele fica na conta");
});

await etapa("repasse cancelado conta como ficou na conta, e é avisado", () => {
  igual(c.repassesQueNaoSairam, 1, "contagem");
  const conta = c.destinos.find((d) => d.destino.chave === "conta");
  igual(conta.porSistema.atomatiza, 7133 - 2377 * 2 - 100 + 801, "o dinheiro do cancelado ficou");
  const linha = c.pagamentos.find((p) => p.id === "pay_a2");
  igual(linha.repasses[0].saiu, false, "a linha mostra que não saiu");
});

await etapa("carteira desconhecida aparece com o final do código, antes da conta principal", () => {
  const nomes = c.destinos.map((d) => d.destino.nome);
  igual(nomes, ["Felipe", "Carol", "Sirius", "Carteira …abc123", "Ficou na conta principal"], "ordem");
});

await etapa("sócio sem carteira configurada continua na lista, marcado", () => {
  const semCarol = caixa.montarCaixa(PAGAMENTOS, caixa.carteirasConhecidas({ ASAAS_CARTEIRA_FELIPE: "w-felipe" }));
  const carol = semCarol.destinos.find((d) => d.destino.nome === "Carol");
  igual([carol.destino.semCarteira, carol.totalCentavos], [true, 0], "Carol sem carteira");
  if (!semCarol.destinos.some((d) => d.destino.nome === "Carteira …-carol")) {
    throw new Error("o repasse para a carteira dela sumiu em vez de aparecer como desconhecida");
  }
});

await etapa("a receber: cartão aprovado e ainda não liberado, com a data mais distante", () => {
  const r = caixa.somarAReceber(PAGAMENTOS);
  igual([r.totalCentavos, r.porSistema.galeria.pagamentos, r.ultimaLiberacao], [9500, 1, "2026-10-20"], "a receber");
});

await etapa("a lista de pagamentos vem do mais recente para o mais antigo", () => {
  igual(c.pagamentos.map((p) => p.id), ["pay_x", "pay_a2", "pay_a1", "pay_g1"], "ordem");
});

// ---------------------------------------------------------------------------
console.log("\nO mês\n");

await etapa("limites, fevereiro e ano bissexto", () => {
  igual(caixa.limitesDoMes("2026-09"), { de: "2026-09-01", ate: "2026-09-30" }, "setembro");
  igual(caixa.limitesDoMes("2026-02").ate, "2026-02-28", "fevereiro");
  igual(caixa.limitesDoMes("2028-02").ate, "2028-02-29", "bissexto");
});

await etapa("vizinhos atravessam o ano; o mês é o de Brasília", () => {
  igual(caixa.mesVizinho("2026-01", -1), "2025-12", "para trás");
  igual(caixa.mesVizinho("2026-12", 1), "2027-01", "para a frente");
  igual(caixa.mesDeBrasilia(new Date("2026-10-01T02:00:00Z")), "2026-09", "23h do dia 30 ainda é setembro");
});

await etapa("do endereço, só AAAA-MM válido", () => {
  igual(caixa.mesValido("2026-09"), "2026-09", "válido");
  for (const v of ["2026-13", "2026-9", "setembro", "2026-09-01", "", undefined, ["2026-09"]]) {
    igual(caixa.mesValido(v), null, JSON.stringify(v));
  }
});

// ---------------------------------------------------------------------------
console.log("\nOs custos\n");

await etapa("o valor digitado vira centavos, do jeito que se escreve no Brasil", () => {
  const casos = {
    "76": 7600, "76,00": 7600, "76,5": 7650, "R$ 76,50": 7650, "1.234,56": 123456,
    "1.234": 123400, "76.50": 7650, "0": 0, " 12 ": 1200,
  };
  for (const [t, v] of Object.entries(casos)) igual(regras.lerReais(t), v, t);
  for (const t of ["", "abc", "-5", "1,234,56", "76,555", "1.23.4", "100.001,00", "12e3", null]) {
    igual(regras.lerReais(t), null, JSON.stringify(t));
  }
});

await etapa("uma linha inválida diz o que está errado", () => {
  const base = { nome: "Supabase", sistema: "atomatiza", valor: "130,00", confirmado: "on", nota: "" };
  igual(regras.lerCusto(base), {
    custo: { nome: "Supabase", sistema: "atomatiza", centavosPorMes: 13000, confirmado: true, nota: "" },
  }, "válida");
  igual(regras.lerCusto({ ...base, nome: "   " }), { erro: "nome" }, "sem nome");
  igual(regras.lerCusto({ ...base, sistema: "outro" }), { erro: "sistema" }, "sistema");
  igual(regras.lerCusto({ ...base, valor: "caro" }), { erro: "valor" }, "valor");
  igual(regras.lerCusto({ ...base, nota: "x".repeat(301) }), { erro: "nota" }, "nota");
  igual(regras.lerCusto({ ...base, confirmado: null }).custo.confirmado, false, "desmarcado");
});

await etapa("o custo dos dois entra uma vez no total", () => {
  const lista = [
    { sistema: "galeria", centavos_por_mes: 333, confirmado: false },
    { sistema: "atomatiza", centavos_por_mes: 13000, confirmado: true },
    { sistema: "os-dois", centavos_por_mes: 5000, confirmado: false },
  ];
  igual(regras.somarCustos(lista, 1000), {
    galeria: 1333, atomatiza: 13000, osDois: 5000, estimativas: 2, total: 19333,
  }, "soma");
  igual(regras.custoFixoDaGaleriaCentavos(lista), 5333, "a Galeria carrega o dos dois inteiro, como antes");
});

// ---------------------------------------------------------------------------
console.log("\nO Asaas lido inteiro\n");

process.env.ASAAS_API_KEY = "chave-de-teste";
process.env.ASAAS_API = "https://asaas.teste/v3";
const pedidos = [];
let paginasDoFalso = 3;
const fetchDeVerdade = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.host !== "asaas.teste") return fetchDeVerdade(url, init);
  pedidos.push(u);
  const offset = Number(u.searchParams.get("offset"));
  const pagina = offset / 100;
  const data = [{ id: `pay_${pagina}`, status: "RECEIVED", value: 10, netValue: 9 }];
  return new Response(JSON.stringify({ data, hasMore: pagina < paginasDoFalso - 1 }), {
    headers: { "content-type": "application/json" },
  });
};
const asaas = await import("../src/lib/asaas.ts");

await etapa("pede pela data em que caiu na conta, de 100 em 100, até acabar", async () => {
  const r = await asaas.pagamentosRecebidos("2026-09-01", "2026-09-30");
  igual([r.pagamentos.length, r.incompleto], [3, false], "três páginas");
  igual(pedidos[0].searchParams.get("paymentDate[ge]"), "2026-09-01", "de");
  igual(pedidos[0].searchParams.get("paymentDate[le]"), "2026-09-30", "até");
  igual(pedidos.map((u) => u.searchParams.get("offset")), ["0", "100", "200"], "páginas");
  igual(pedidos[0].searchParams.get("limit"), "100", "limite");
});

await etapa("passou do teto: para e avisa que está incompleto", async () => {
  pedidos.length = 0;
  paginasDoFalso = 1000;
  const r = await asaas.pagamentosRecebidos("2026-09-01", "2026-09-30");
  igual([r.pagamentos.length, r.incompleto, pedidos.length], [30, true, 30], "teto");
});

await etapa("a receber pede só o cartão aprovado", async () => {
  pedidos.length = 0;
  paginasDoFalso = 1;
  await asaas.pagamentosAReceber();
  igual(pedidos[0].searchParams.get("status"), "CONFIRMED", "status");
});
globalThis.fetch = fetchDeVerdade;

// ---------------------------------------------------------------------------
await exigirBancoDeTeste();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const criados = [];

try {
  console.log("\nO banco\n");

  await etapa("a tabela nasce com os custos fixos da Galeria, e o total é o mesmo de antes", async () => {
    const { rows } = await db.query(
      "select chave, sistema, centavos_por_mes from custos_da_sociedade where chave is not null order by chave",
    );
    igual(rows.map((r) => [r.chave, r.sistema]), [
      ["contabilidade", "os-dois"], ["das-mei", "os-dois"], ["dominio", "galeria"],
      ["servidor-zip", "galeria"], ["vps", "os-dois"],
    ], "semente");
    igual(regras.custoFixoDaGaleriaCentavos(rows), custoFixoMensalCentavos(), "o painel da Galeria não muda");
  });

  await etapa("o banco recusa valor negativo, sistema estranho e nome vazio", async () => {
    for (const [nome, sistema, valor] of [["X", "galeria", -1], ["X", "outro", 1], ["  ", "galeria", 1]]) {
      const ok = await db
        .query("insert into custos_da_sociedade (nome, sistema, centavos_por_mes) values ($1, $2, $3)", [nome, sistema, valor])
        .then(() => true, () => false);
      if (ok) throw new Error(`aceitou ${JSON.stringify([nome, sistema, valor])}`);
    }
  });

  console.log("\nSó o admin muda a lista\n");

  const { salvarCustoAction, apagarCustoAction } = await import("../src/app/painel/admin/caixa/actions.ts");
  const estudio = await estudioDaRodada(db);
  const formulario = (campos) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(campos)) f.set(k, v);
    return f;
  };
  const destino = async (acao, form) => {
    try {
      await acao(form);
      return null;
    } catch (e) {
      if (e.message !== "REDIRECT") throw e;
      return e.url;
    }
  };
  const NOVO = { nome: "Supabase (teste do caixa)", sistema: "atomatiza", valor: "130,00", nota: "", mes: "2026-09" };

  await etapa("quem não é admin é mandado embora, e nada é gravado", async () => {
    globalThis.__admin = null;
    const url = await destino(salvarCustoAction, formulario(NOVO));
    igual(url, "/painel", "destino");
    const { rows } = await db.query("select 1 from custos_da_sociedade where nome = $1", [NOVO.nome]);
    igual(rows.length, 0, "linhas");
  });

  await etapa("o admin cadastra, e a auditoria guarda quem foi", async () => {
    globalThis.__admin = { id: estudio.id, nome_estudio: estudio.nome_estudio };
    const url = await destino(salvarCustoAction, formulario(NOVO));
    igual(url, "/painel/admin/caixa?mes=2026-09&ok=criado#custos", "destino");
    const { rows } = await db.query(
      "select id, centavos_por_mes, confirmado, atualizado_por from custos_da_sociedade where nome = $1",
      [NOVO.nome],
    );
    igual([rows.length, rows[0]?.centavos_por_mes, rows[0]?.confirmado, rows[0]?.atualizado_por], [1, 13000, false, estudio.id], "linha");
    criados.push(rows[0].id);
    const ev = await db.query(
      "select detalhe from eventos where acao = 'sociedade.custo' and alvo_id = $1",
      [rows[0].id],
    );
    igual(ev.rows[0]?.detalhe?.operacao, "criado", "auditoria");
  });

  await etapa("valor inválido volta com o erro, sem gravar", async () => {
    const url = await destino(salvarCustoAction, formulario({ ...NOVO, id: criados[0], valor: "muito" }));
    igual(url, "/painel/admin/caixa?mes=2026-09&erro=valor#custos", "destino");
    const { rows } = await db.query("select centavos_por_mes from custos_da_sociedade where id = $1", [criados[0]]);
    igual(rows[0].centavos_por_mes, 13000, "não mudou");
  });

  await etapa("o admin altera e confirma", async () => {
    const url = await destino(salvarCustoAction, formulario({ ...NOVO, id: criados[0], valor: "125,90", confirmado: "on" }));
    igual(url, "/painel/admin/caixa?mes=2026-09&ok=alterado#custos", "destino");
    const { rows } = await db.query("select centavos_por_mes, confirmado from custos_da_sociedade where id = $1", [criados[0]]);
    igual([rows[0].centavos_por_mes, rows[0].confirmado], [12590, true], "linha");
  });

  await etapa("id forjado ou que não existe não vira erro de banco", async () => {
    igual(await destino(salvarCustoAction, formulario({ ...NOVO, id: "'; drop table x; --" })),
      "/painel/admin/caixa?mes=2026-09&erro=nao-achou#custos", "forjado");
    igual(await destino(apagarCustoAction, formulario({ id: "00000000-0000-4000-8000-000000000000", mes: "2026-09" })),
      "/painel/admin/caixa?mes=2026-09&erro=nao-achou#custos", "inexistente");
  });

  await etapa("mês forjado não entra no endereço de volta", async () => {
    const url = await destino(salvarCustoAction, formulario({ ...NOVO, id: criados[0], valor: "125,90", confirmado: "on", mes: "javascript:alert(1)" }));
    igual(url, "/painel/admin/caixa?ok=alterado#custos", "destino");
  });

  await etapa("quem não é admin não apaga", async () => {
    globalThis.__admin = null;
    igual(await destino(apagarCustoAction, formulario({ id: criados[0], mes: "2026-09" })), "/painel", "destino");
    const { rows } = await db.query("select 1 from custos_da_sociedade where id = $1", [criados[0]]);
    igual(rows.length, 1, "continua lá");
  });

  await etapa("o admin apaga, e a auditoria guarda o que era", async () => {
    globalThis.__admin = { id: estudio.id, nome_estudio: estudio.nome_estudio };
    igual(await destino(apagarCustoAction, formulario({ id: criados[0], mes: "2026-09" })),
      "/painel/admin/caixa?mes=2026-09&ok=apagado#custos", "destino");
    const { rows } = await db.query("select 1 from custos_da_sociedade where id = $1", [criados[0]]);
    igual(rows.length, 0, "apagado");
    const ev = await db.query(
      "select detalhe from eventos where acao = 'sociedade.custo' and alvo_id = $1 order by id desc limit 1",
      [criados[0]],
    );
    igual([ev.rows[0]?.detalhe?.operacao, ev.rows[0]?.detalhe?.centavos_por_mes], ["apagado", 12590], "auditoria");
    criados.length = 0;
  });

  // --- a página, pela rota ---------------------------------------------------
  const BASE = process.env.BASE_URL ?? "http://localhost:3040";
  let servidor = false;
  try {
    servidor = (await fetchDeVerdade(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    servidor = false;
  }
  if (!servidor) {
    console.log("\n⚠ servidor fora do ar — a parte da rota foi pulada");
  } else {
    console.log("\nA página, pela rota\n");

    await etapa("sem sessão a página não existe", async () => {
      const r = await fetchDeVerdade(`${BASE}/painel/admin/caixa`, { redirect: "manual" });
      if (r.status === 200) throw new Error("respondeu 200 sem sessão");
      return `HTTP ${r.status}`;
    });

    await etapa("estúdio comum recebe 404, sem nada da página", async () => {
      const r = await fetchDeVerdade(`${BASE}/painel/admin/caixa?mes=2026-09`, {
        headers: { cookie: cookieDeSessao(estudio.id) },
      });
      igual(r.status, 404, "status");
      const corpo = await r.text();
      if (/caixa dos s[óo]cios|para onde foi|conta principal/i.test(corpo)) {
        throw new Error("a página vazou conteúdo para quem não é admin");
      }
    });
  }
} finally {
  if (criados.length) await db.query("delete from custos_da_sociedade where id = any($1)", [criados]);
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ o caixa dos sócios tem problema" : "\n✓ o caixa dos sócios fecha, e só o admin mexe na lista\n");
process.exit(falhou ? 1 : 0);
