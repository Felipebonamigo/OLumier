#!/usr/bin/env node
/**
 * Testa o PACOTE GALERIA ÁTOMO + ATOMATIZA — o lado da Galeria.
 * Uso: node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-pacote.mjs
 *
 * ── O QUE FOI DECIDIDO (30/09/2026) ───────────────────────────────────────
 *
 * "Assinar os 2 juntos, o sistema reconhecer se o cpf/cnpj já tem login no
 * outro sistema, e a pessoa poder montar o pacote dela." Duas assinaturas
 * criadas no mesmo clique, a conta do outro lado criada sozinha, e o desconto
 * valendo desde a assinatura. O contrato está em `docs/pacote.md`.
 *
 * ── O QUE ESTE ARQUIVO PRENDE ─────────────────────────────────────────────
 *
 *   1. A MARCA `· pacote` e a tabela da tela (o preço dos dois juntos).
 *   2. A REGRA DO COMBO: o Atomatiza marcado conta antes de pagar, e para de
 *      contar quando vence.
 *   3. A PORTA E AS RESPOSTAS da ponte (`situacao` e `assinar`): segredo,
 *      conta nova sem senha e com o convite, a trava do e-mail, `ja_assina`.
 *   4. A ORDEM de "Assinar o pacote": a nossa no cheio, a de lá, e a nossa
 *      baixa só quando a de lá existe.
 */
import { createServer } from "node:http";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { marcaDaRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

const SEGREDO = "p".repeat(40);
process.env.PONTE_ATOMO_SEGREDO = SEGREDO;
process.env.ASAAS_API_KEY = "chave-de-mentira";
delete process.env.ASAAS_AMBIENTE;

/* ── O Asaas de mentira ─────────────────────────────────────────────────── */

const asaas = { clientes: [], assinaturas: [], pagas: new Set(), vencidas: new Set(), escritas: [] };
let seq = 0;
const novoId = (p) => `${p}_${++seq}`;

const servidorAsaas = createServer((req, res) => {
  let corpo = "";
  req.on("data", (p) => (corpo += p));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const q = url.searchParams;
    const dados = corpo ? JSON.parse(corpo) : {};
    const responder = (status, d) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(d));
    };

    if (p === "/customers" && req.method === "POST") {
      const c = { id: novoId("cus"), ...dados };
      asaas.clientes.push(c);
      return responder(200, c);
    }
    if (p === "/customers") {
      const ref = q.get("externalReference");
      const doc = q.get("cpfCnpj");
      return responder(200, {
        data: asaas.clientes.filter((c) => (ref ? c.externalReference === ref : doc ? c.cpfCnpj === doc : true)),
      });
    }
    let m = /^\/customers\/([^/]+)$/.exec(p);
    if (m) {
      const c = asaas.clientes.find((x) => x.id === m[1]);
      return c ? responder(200, c) : responder(404, {});
    }
    if (p === "/subscriptions" && req.method === "POST") {
      const a = { id: novoId("sub"), status: "ACTIVE", ...dados };
      asaas.assinaturas.push(a);
      asaas.escritas.push({ caminho: p, corpo: dados });
      return responder(200, a);
    }
    if (p === "/subscriptions") {
      const ref = q.get("externalReference");
      const cliente = q.get("customer");
      return responder(200, {
        data: asaas.assinaturas.filter((a) => (ref ? a.externalReference === ref : a.customer === cliente)),
      });
    }
    m = /^\/subscriptions\/([^/]+)\/payments$/.exec(p);
    if (m) {
      const id = m[1];
      const cobrancas = [
        {
          id: `pay_${id}`,
          status: asaas.pagas.has(id) ? "RECEIVED" : "PENDING",
          dueDate: "2026-10-13",
          value: asaas.assinaturas.find((a) => a.id === id)?.value ?? 0,
          invoiceUrl: `https://asaas.teste/i/${id}`,
        },
        ...(asaas.vencidas.has(id) ? [{ id: `venc_${id}`, status: "OVERDUE" }] : []),
      ];
      const filtro = q.get("status");
      return responder(200, { data: cobrancas.filter((c) => !filtro || c.status === filtro) });
    }
    m = /^\/subscriptions\/([^/]+)$/.exec(p);
    if (m) {
      const a = asaas.assinaturas.find((x) => x.id === m[1]);
      if (!a) return responder(404, {});
      if (req.method !== "GET") {
        asaas.escritas.push({ caminho: p, corpo: dados });
        if (dados.value !== undefined) a.value = dados.value;
        if (dados.description !== undefined) a.description = dados.description;
      }
      return responder(200, a);
    }
    return responder(404, { errors: [{ description: `rota não prevista: ${p}` }] });
  });
});
await new Promise((ok) => servidorAsaas.listen(0, "127.0.0.1", ok));
process.env.ASAAS_API = `http://127.0.0.1:${servidorAsaas.address().port}`;

/* ── O Atomatiza de mentira: responde a ponte e cria a assinatura de lá no
 *    mesmo Asaas, como o de verdade faria. ─────────────────────────────── */

const atz = { pedidos: [], resposta: null };
const servidorAtz = createServer((req, res) => {
  let corpo = "";
  req.on("data", (p) => (corpo += p));
  req.on("end", () => {
    const dados = corpo ? JSON.parse(corpo) : {};
    const responder = (status, d) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(d));
    };
    if (req.headers.authorization !== `Bearer ${SEGREDO}`) return responder(401, { erro: "não autorizado" });
    atz.pedidos.push({ caminho: req.url, corpo: dados });
    if (req.url === "/api/ponte/situacao") return responder(200, { conta: false, emailMascarado: null, assinatura: null });
    if (atz.resposta) return responder(atz.resposta.status, atz.resposta.corpo);
    const cliente = { id: novoId("cus"), cpfCnpj: dados.documento, externalReference: "atz:sub:st-1" };
    asaas.clientes.push(cliente);
    asaas.assinaturas.push({
      id: novoId("sub"),
      customer: cliente.id,
      status: "ACTIVE",
      value: 51.34,
      cycle: "MONTHLY",
      description: `Atomatiza — plano ${dados.plano.faixa} · combo com a Galeria Átomo · pacote`,
      externalReference: "atz:sub:st-1",
    });
    return responder(200, { ok: true, contaNova: true, valorCentavos: 5134, faturaUrl: null });
  });
});
await new Promise((ok) => servidorAtz.listen(0, "127.0.0.1", ok));
process.env.ATOMATIZA_URL = `http://127.0.0.1:${servidorAtz.address().port}`;

const C = await import("../src/config/combo.ts");
const { planoPorId } = await import("../src/config/planos.ts");
const { marca } = await import("../src/config/marca.ts");
const Pac = await import("../src/lib/pacote.ts");
const { faixaDoAtomatiza } = await import("../src/lib/combo.ts");
const { NextRequest } = await import("next/server");
const rotaSituacao = await import("../src/app/api/ponte/situacao/route.ts");
const rotaAssinar = await import("../src/app/api/ponte/assinar/route.ts");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  asaas.escritas.length = 0;
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

const MARCA = marcaDaRodada();
const criados = [];
/* CPFs válidos de exemplo, um por cenário: o documento é único entre as contas. */
const DOC_A = "52998224725";
const DOC_B = "11144477735";
const DOC_C = "45041663000192";

const chamar = async (rota, caminho, corpo, autorizacao = `Bearer ${SEGREDO}`) => {
  const cabecalhos = { "content-type": "application/json" };
  if (autorizacao) cabecalhos.authorization = autorizacao;
  const r = await rota.POST(
    new NextRequest(`http://ponte.teste${caminho}`, {
      method: "POST",
      headers: cabecalhos,
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }),
  );
  return { status: r.status, corpo: await r.json() };
};

const pedido = (extra = {}) => ({
  documento: DOC_A,
  email: `pacote-${MARCA}@teste.local`,
  nome: `Estúdio do Pacote ${MARCA}`,
  plano: { gb: 500 },
  ciclo: "mensal",
  forma: "cartao",
  vencimento: "2026-10-13",
  pacote: true,
  parceiro: { faixa: "solo" },
  aceitouTermos: true,
  ...extra,
});

const tenantDoDoc = async (doc) =>
  (await db.query("select * from tenants where cpf_cnpj = $1", [doc])).rows[0] ?? null;

try {
  /* Nenhum resto de rodada anterior com estes documentos. */
  await db.query("delete from tenants where cpf_cnpj = any($1) and email like '%@teste.local'", [[DOC_A, DOC_B, DOC_C]]);

  console.log("\nA marca e a tabela:\n");

  await etapa("a marca vai no fim, e o tamanho continua legível para o Atomatiza", () => {
    const d = C.descricaoDaAssinatura(marca.nome, planoPorId("g:foto:500"), "mensal", "solo", true);
    igual(d, `${marca.nome} — Foto · 500 GB · combo com o Atomatiza · pacote`, "descrição");
    igual([C.ehDoPacote(d), C.gbDaDescricaoGaleria(d)], [true, 500], "marca / gigas");
    igual(C.ehDoPacote(C.descricaoDaAssinatura(marca.nome, planoPorId("g:foto:500"), "mensal", "solo")), false, "sem marca");
    igual(C.faixaDaDescricaoAtomatiza("Atomatiza — plano equipe · combo com a Galeria Átomo · pacote"), "equipe", "faixa de lá com a marca");
  });

  await etapa("a tabela da tela: 500 GB + Solo fecham em R$ 119,90", () => {
    const p = C.precosDoPacote(planoPorId("g:foto:500")).solo;
    igual([p.galeriaCheio, p.galeria, p.atomatizaCheio, p.atomatiza], [7999, 6856, 5990, 5134], "preços");
    igual(p.galeria + p.atomatiza, 11990, "total");
  });

  await etapa("o e-mail mascarado mostra o começo e o domínio", () => {
    igual(Pac.mascararEmail("BiBizaco@Gmail.com"), "bi•••@gmail.com", "máscara");
    igual(Pac.mascararEmail("a@x.com"), "a•••@x.com", "curto");
  });

  console.log("\nA regra do combo:\n");

  const atomatizaNoAsaas = (extra = {}) => {
    const c = { id: novoId("cus"), cpfCnpj: DOC_B, externalReference: "atz:studio:9" };
    asaas.clientes.push(c);
    const a = {
      id: novoId("sub"),
      customer: c.id,
      status: "ACTIVE",
      value: 51.34,
      description: "Atomatiza — plano solo · combo com a Galeria Átomo · pacote",
      externalReference: "atz:sub:st-9",
      ...extra,
    };
    asaas.assinaturas.push(a);
    return a;
  };

  await etapa("o Atomatiza do pacote conta antes de pagar", async () => {
    atomatizaNoAsaas();
    igual(await faixaDoAtomatiza(DOC_B), "solo", "faixa");
  });
  await etapa("…e para de contar quando a primeira fatura vence", async () => {
    asaas.vencidas.add(asaas.assinaturas.at(-1).id);
    igual(await faixaDoAtomatiza(DOC_B), null, "faixa");
  });
  await etapa("sem a marca, continua exigindo o primeiro pagamento", async () => {
    asaas.clientes = asaas.clientes.filter((c) => c.cpfCnpj !== DOC_B);
    atomatizaNoAsaas({ description: "Atomatiza — plano solo" });
    igual(await faixaDoAtomatiza(DOC_B), null, "sem pagamento");
    asaas.pagas.add(asaas.assinaturas.at(-1).id);
    igual(await faixaDoAtomatiza(DOC_B), "solo", "depois de pagar");
  });

  console.log("\nA ponte — situação:\n");

  await etapa("sem segredo certo, a porta recusa", async () => {
    igual((await chamar(rotaSituacao, "/api/ponte/situacao", { documento: DOC_A }, "Bearer errado")).status, 401, "401");
    igual((await chamar(rotaSituacao, "/api/ponte/situacao", "{nao-json", null)).status, 401, "sem cabeçalho");
    igual((await chamar(rotaSituacao, "/api/ponte/situacao", "{nao-json")).status, 400, "json inválido");
  });

  await etapa("documento sem conta, ou inválido: conta false", async () => {
    igual((await chamar(rotaSituacao, "/api/ponte/situacao", { documento: DOC_A })).corpo, { conta: false, emailMascarado: null, assinatura: null }, "sem conta");
    igual((await chamar(rotaSituacao, "/api/ponte/situacao", { documento: "123" })).corpo.conta, false, "inválido");
  });

  console.log("\nA ponte — assinar:\n");

  await etapa("pedido inválido volta 400 com a frase pronta", async () => {
    const r = await chamar(rotaAssinar, "/api/ponte/assinar", pedido({ plano: { gb: 333 } }));
    igual([r.status, r.corpo.erro], [400, "Tamanho de Galeria inválido."], "gigas");
    const s = await chamar(rotaAssinar, "/api/ponte/assinar", pedido({ forma: "boleto" }));
    igual(s.status, 400, "forma");
  });

  await etapa("sem aceitar os termos, a conta nova não nasce", async () => {
    const r = await chamar(rotaAssinar, "/api/ponte/assinar", pedido({ aceitouTermos: false }));
    igual(r.status, 400, "status");
    igual(await tenantDoDoc(DOC_A), null, "conta");
  });

  await etapa("documento novo: cria a conta sem senha, o aceite, o convite e a assinatura com o combo", async () => {
    const r = await chamar(rotaAssinar, "/api/ponte/assinar", pedido());
    igual([r.status, r.corpo.ok, r.corpo.contaNova, r.corpo.valorCentavos], [200, true, true, 6856], "resposta");
    const t = await tenantDoDoc(DOC_A);
    criados.push(t.id);
    igual([t.senha_hash, t.plano_id, Boolean(t.email_confirmado_em), Boolean(t.atomatiza_visto_em)], ["sem-senha", "g:foto:500", true, true], "conta");
    const ev = await db.query("select detalhe from eventos where tenant_id = $1 and acao = 'conta.criada'", [t.id]);
    igual([ev.rows[0]?.detalhe?.origem, Boolean(ev.rows[0]?.detalhe?.aceitou?.termos)], ["pacote", true], "aceite");
    const conv = await db.query("select origem, expira_em from recuperacoes where tenant_id = $1 and usado_em is null", [t.id]);
    const dias = (new Date(conv.rows[0].expira_em) - Date.now()) / 86_400_000;
    if (conv.rows[0]?.origem !== "pacote" || dias < 6.9) throw new Error(`convite: ${JSON.stringify(conv.rows[0])}`);
    const sub = asaas.assinaturas.find((a) => a.id === t.asaas_assinatura_id);
    igual([sub.value, sub.nextDueDate, sub.billingType], [68.56, "2026-10-13", "CREDIT_CARD"], "assinatura");
    if (!C.ehDoPacote(sub.description)) throw new Error(`sem a marca: ${sub.description}`);
    return "R$ 68,56 com o Solo, vencendo junto";
  });

  await etapa("a situação passa a dizer que tem conta, e a assinatura pendente", async () => {
    const r = await chamar(rotaSituacao, "/api/ponte/situacao", { documento: DOC_A });
    igual(r.corpo, {
      conta: true,
      emailMascarado: `pa•••@teste.local`,
      assinatura: { status: "pendente", plano: { gb: 500 }, ciclo: "mensal" },
    }, "situação");
  });

  await etapa("pedido repetido: ja_assina, sem segunda assinatura", async () => {
    const antes = asaas.assinaturas.length;
    const r = await chamar(rotaAssinar, "/api/ponte/assinar", pedido());
    igual([r.status, r.corpo.codigo], [409, "ja_assina"], "resposta");
    igual(asaas.assinaturas.length, antes, "assinaturas");
  });

  await etapa("documento com conta aqui e OUTRO e-mail: não mexe em nada", async () => {
    await db.query("update tenants set asaas_assinatura_id = null where id = $1", [criados[0]]);
    const antes = asaas.assinaturas.length;
    const r = await chamar(rotaAssinar, "/api/ponte/assinar", pedido({ email: `outro-${MARCA}@teste.local` }));
    igual([r.status, r.corpo.codigo], [409, "conta_de_outro_email"], "resposta");
    igual(asaas.assinaturas.length, antes, "assinaturas");
  });

  await etapa("documento novo com e-mail que já é de outra conta: email_em_uso", async () => {
    const r = await chamar(rotaAssinar, "/api/ponte/assinar", pedido({ documento: DOC_B }));
    igual([r.status, r.corpo.codigo], [409, "email_em_uso"], "resposta");
    igual(await tenantDoDoc(DOC_B), null, "conta");
  });

  console.log("\nO botão \"Assinar o pacote\":\n");

  await etapa("a nossa nasce no cheio, a de lá é pedida, e a nossa baixa quando a de lá existe", async () => {
    const { rows } = await db.query(
      `insert into tenants (slug, nome_estudio, email, senha_hash, plano_id, quota_bytes, cpf_cnpj, status)
       values ($1, $2, $3, 'x', 'g:foto:500', $4, $5, 'trial') returning id`,
      [`pacote-origem-${MARCA}`, "Estúdio Origem", `origem-${MARCA}@teste.local`, String(500 * 1024 ** 3), DOC_C],
    );
    criados.push(rows[0].id);
    atz.pedidos.length = 0;
    const r = await Pac.assinarPacote(rows[0].id, {
      faixa: "solo",
      ciclo: "mensal",
      forma: "cartao",
      documento: DOC_C,
      aceitouTermos: true,
    });
    igual(r.ok, true, "resultado");
    const criacao = asaas.escritas.find((e) => e.caminho === "/subscriptions");
    igual(criacao?.corpo.value, 79.99, "a nossa nasceu no cheio");
    const p = atz.pedidos.find((x) => x.caminho === "/api/ponte/assinar")?.corpo;
    igual([p?.plano, p?.parceiro, p?.pacote, p?.forma, p?.documento], [{ faixa: "solo" }, { gb: 500 }, true, "cartao", DOC_C], "pedido a lá");
    const t = (await db.query("select asaas_assinatura_id, combo_atomatiza from tenants where id = $1", [rows[0].id])).rows[0];
    const nossa = asaas.assinaturas.find((a) => a.id === t.asaas_assinatura_id);
    igual([nossa.value, t.combo_atomatiza], [68.56, "solo"], "a nossa baixou");
    if (!C.ehDoPacote(nossa.description)) throw new Error(`a marca sumiu na conferência: ${nossa.description}`);
    const baixa = asaas.escritas.find((e) => e.caminho === `/subscriptions/${nossa.id}`);
    igual(baixa?.corpo.updatePendingPayments, true, "a fatura emitida baixou junto");
  });

  await etapa("o Atomatiza recusou: a nossa fica no cheio, e a tela sabe que ela nasceu", async () => {
    const { rows } = await db.query(
      `insert into tenants (slug, nome_estudio, email, senha_hash, plano_id, quota_bytes, cpf_cnpj, status)
       values ($1, $2, $3, 'x', 'g:foto:250', $4, $5, 'trial') returning id`,
      [`pacote-recusa-${MARCA}`, "Estúdio Recusa", `recusa-${MARCA}@teste.local`, String(250 * 1024 ** 3), DOC_B],
    );
    criados.push(rows[0].id);
    /* O DOC_B tem um Atomatiza pago de uma etapa acima: fora, para a nossa
     * nascer no cheio de verdade. */
    asaas.clientes = asaas.clientes.filter((c) => c.cpfCnpj !== DOC_B);
    atz.resposta = { status: 409, corpo: { erro: "Este CPF/CNPJ já tem conta no Atomatiza com outro e-mail.", codigo: "conta_de_outro_email" } };
    try {
      const r = await Pac.assinarPacote(rows[0].id, { faixa: "equipe", ciclo: "mensal", forma: "fatura", documento: DOC_B, aceitouTermos: true });
      igual([r.ok, r.galeriaAssinada], [false, true], "resultado");
      if (!r.erro.includes("outro e-mail")) throw new Error(`erro: ${r.erro}`);
      const t = (await db.query("select asaas_assinatura_id from tenants where id = $1", [rows[0].id])).rows[0];
      const sub = asaas.assinaturas.find((a) => a.id === t.asaas_assinatura_id);
      igual(sub?.value, 49.99, "cheio");
      if (C.ehDoPacote(sub?.description)) throw new Error(`a marca ficou sem o outro lado: ${sub?.description}`);
    } finally {
      atz.resposta = null;
    }
  });
} finally {
  if (criados.length) {
    await db.query("delete from recuperacoes where tenant_id = any($1)", [criados]).catch(() => {});
    await db.query("delete from eventos where tenant_id = any($1)", [criados]).catch(() => {});
    await db.query("delete from tenants where id = any($1)", [criados]);
  }
  await db.end();
  servidorAsaas.close();
  servidorAtz.close();
}

if (falhou) process.exit(1);
console.log("\n✓ Pacote conferido.");
