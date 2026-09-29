#!/usr/bin/env node
/**
 * Testa a PONTE COM O ATOMATIZA — quem vê o seletor "Galeria Átomo | Atomatiza".
 * Uso: node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-ponte-atomatiza.mjs
 *
 * ── O QUE FOI DECIDIDO (29/09/2026) ───────────────────────────────────────
 *
 * O seletor de plataforma "só vai aparecer pra quem tem cadastro nas duas
 * plataformas". Quem sabe da conta de lá é o Atomatiza: ele pergunta em
 * `/api/ponte/conta`, e o sim marca `tenants.atomatiza_visto_em`. Ver
 * `src/lib/ponte-atomatiza.ts`.
 *
 * ── O QUE ESTE ARQUIVO PRENDE ─────────────────────────────────────────────
 *
 *   1. A PORTA. Sem segredo, fechada; com segredo errado, recusada. Aberta,
 *      ela diria a qualquer um se um e-mail é nosso cliente.
 *   2. A RESPOSTA. E-mail (sem diferença de caixa) ou CPF/CNPJ acham o
 *      estúdio; o que não é de ninguém não marca ninguém.
 *   3. O SELETOR. Aparece com a marca recente e some sozinho depois de
 *      30 dias sem o Atomatiza perguntar.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada, marcaDaRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

const SEGREDO = "s".repeat(40);
process.env.PONTE_ATOMO_SEGREDO = SEGREDO;

const { NextRequest } = await import("next/server");
const { POST } = await import("../src/app/api/ponte/conta/route.ts");
const P = await import("../src/lib/ponte-atomatiza.ts");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
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

/** Uma pergunta do Atomatiza, como ela chega de verdade. */
const perguntar = async (corpo, autorizacao = `Bearer ${SEGREDO}`) => {
  const cabecalhos = { "content-type": "application/json" };
  if (autorizacao) cabecalhos.authorization = autorizacao;
  const r = await POST(
    new NextRequest("http://ponte.teste/api/ponte/conta", {
      method: "POST",
      headers: cabecalhos,
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }),
  );
  return { status: r.status, corpo: await r.json() };
};

const DOC = "52998224725"; // CPF válido de exemplo, o mesmo do testar-combo

try {
  const t = await estudioDaRodada(db);
  const visto = async () =>
    (await db.query("select atomatiza_visto_em from tenants where id = $1", [t.id])).rows[0].atomatiza_visto_em;
  const zerar = () => db.query("update tenants set atomatiza_visto_em = null, cpf_cnpj = null where id = $1", [t.id]);

  console.log("\nA porta:\n");

  await etapa("sem segredo configurado, a porta fica fechada (503)", async () => {
    delete process.env.PONTE_ATOMO_SEGREDO;
    try {
      igual((await perguntar({ email: t.email })).status, 503, "status");
    } finally {
      process.env.PONTE_ATOMO_SEGREDO = SEGREDO;
    }
  });

  await etapa("segredo curto demais não vale como segredo", async () => {
    process.env.PONTE_ATOMO_SEGREDO = "curto";
    try {
      igual((await perguntar({ email: t.email }, "Bearer curto")).status, 503, "status");
    } finally {
      process.env.PONTE_ATOMO_SEGREDO = SEGREDO;
    }
  });

  await etapa("sem cabeçalho, ou com segredo errado, é recusado (401) e não marca nada", async () => {
    await zerar();
    igual((await perguntar({ email: t.email }, null)).status, 401, "sem cabeçalho");
    igual((await perguntar({ email: t.email }, `Bearer ${"x".repeat(40)}`)).status, 401, "segredo errado");
    igual((await perguntar({ email: t.email }, "Bearer s")).status, 401, "segredo pela metade");
    igual(await visto(), null, "atomatiza_visto_em");
  });

  await etapa("corpo que não é JSON devolve 400", async () => {
    igual((await perguntar("isto não é json")).status, 400, "status");
  });

  console.log("\nA resposta:\n");

  await etapa("o e-mail acha o estúdio, sem diferença de caixa, e marca a data", async () => {
    await zerar();
    const r = await perguntar({ email: `  ${t.email.toUpperCase()} ` });
    igual([r.status, r.corpo], [200, { conta: true }], "resposta");
    if (!(await visto())) throw new Error("não marcou atomatiza_visto_em");
  });

  await etapa("o CPF/CNPJ acha o estúdio mesmo com outro e-mail, com ou sem pontuação", async () => {
    await zerar();
    await db.query("update tenants set cpf_cnpj = $1 where id = $2", [DOC, t.id]);
    const r = await perguntar({ email: "outra-pessoa@teste.local", documento: "529.982.247-25" });
    igual(r.corpo, { conta: true }, "resposta");
    if (!(await visto())) throw new Error("não marcou atomatiza_visto_em");
  });

  await etapa("quem não tem conta aqui ouve não, e ninguém é marcado", async () => {
    await zerar();
    const r = await perguntar({ email: `ninguem-${marcaDaRodada()}@teste.local`, documento: "11144477735" });
    igual(r.corpo, { conta: false }, "resposta");
    igual(await visto(), null, "atomatiza_visto_em");
  });

  await etapa("pergunta vazia não casa com estúdio sem documento", async () => {
    await zerar();
    igual((await perguntar({})).corpo, { conta: false }, "vazio");
    igual((await perguntar({ documento: "" })).corpo, { conta: false }, "documento vazio");
    igual((await perguntar({ email: "   ", documento: "123" })).corpo, { conta: false }, "curtos");
    igual((await perguntar({ email: 42, documento: ["x"] })).corpo, { conta: false }, "tipos errados");
    igual(await visto(), null, "atomatiza_visto_em");
  });

  await etapa("perguntar de novo na mesma hora não reescreve a data", async () => {
    await zerar();
    await perguntar({ email: t.email });
    const primeira = (await visto()).getTime();
    await new Promise((ok) => setTimeout(ok, 20));
    await perguntar({ email: t.email });
    igual((await visto()).getTime(), primeira, "atomatiza_visto_em");
  });

  await etapa("mais de uma hora depois, a data anda", async () => {
    await db.query("update tenants set atomatiza_visto_em = now() - interval '2 hours' where id = $1", [t.id]);
    const antes = (await visto()).getTime();
    await perguntar({ email: t.email });
    if (!((await visto()).getTime() > antes)) throw new Error("a data não andou");
  });

  console.log("\nO seletor:\n");

  await etapa("aparece com a marca recente, e não sem ela", () => {
    const agora = new Date("2026-09-29T12:00:00Z");
    igual(P.usaOAtomatiza({ atomatiza_visto_em: null }, agora), false, "nunca visto");
    igual(P.usaOAtomatiza({ atomatiza_visto_em: new Date("2026-09-29T11:00:00Z") }, agora), true, "visto agora");
    igual(P.usaOAtomatiza({ atomatiza_visto_em: new Date("2026-08-31T12:00:00Z") }, agora), true, "29 dias");
  });

  await etapa("some sozinho depois de 30 dias sem o Atomatiza perguntar", () => {
    const agora = new Date("2026-09-29T12:00:00Z");
    igual(P.usaOAtomatiza({ atomatiza_visto_em: new Date("2026-08-29T11:00:00Z") }, agora), false, "31 dias");
  });

  await etapa("o link leva ao /login de lá, que manda o logado direto ao painel", () => {
    if (!P.LINK_ATOMATIZA.endsWith("/login")) throw new Error(`link: ${P.LINK_ATOMATIZA}`);
  });

  await etapa("os nomes das abas são os que o Atomatiza usa", () => {
    // Mudou aqui, mude lá: `src/lib/galeria-atomo.ts` do Atomatiza.
    igual([P.JANELA_GALERIA, P.JANELA_ATOMATIZA], ["galeria-atomo", "atomatiza"], "janelas");
  });
} finally {
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ A ponte com o Atomatiza tem etapa vermelha.\n");
  process.exit(1);
}
console.log("\n✓ Ponte com o Atomatiza conferida.\n");
