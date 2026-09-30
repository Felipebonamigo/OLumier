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
      if (req.method === "DELETE") {
        asaas.escritas.push({ caminho: p, metodo: "DELETE" });
        a.deleted = true;
        return responder(200, { deleted: true, id: a.id });
      }
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

const atz = { pedidos: [], resposta: null, vinculo: null };
const ESTUDIO_ATZ = "7a1f0c2e-1111-4222-8333-944455556666";
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
    if (req.url === "/api/ponte/pacote/preparar") {
      if (atz.resposta) return responder(atz.resposta.status, atz.resposta.corpo);
      return responder(200, {
        ok: true,
        contaId: ESTUDIO_ATZ,
        contaNova: true,
        valorCentavos: 5134,
        nome: `Atomatiza ${dados.plano.faixa === "solo" ? "Solo" : "Equipe"}`,
        /* Uma carteira só de lá e uma que os dois produtos dividem. */
        split: [
          { walletId: "wal_socio_atz", percentual: 30 },
          { walletId: "wal_comum", percentual: 10 },
        ],
      });
    }
    if (req.url === "/api/ponte/pacote/vincular") {
      if (atz.vinculo) return responder(atz.vinculo.status, atz.vinculo.corpo);
      return responder(200, { ok: true });
    }
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
const rotaPreparar = await import("../src/app/api/ponte/pacote/preparar/route.ts");
const rotaVincular = await import("../src/app/api/ponte/pacote/vincular/route.ts");
const A = await import("../src/lib/asaas.ts");
const { recalcularCombo } = await import("../src/lib/combo.ts");
const { trocarPlano } = await import("../src/lib/troca-de-plano.ts");

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

  console.log("\nO split da fatura única:\n");

  await etapa("cada lado reescalado pela sua fatia do total, e a carteira comum numa parte só", () => {
    // Galeria 100 com 20% para "comum" e R$ 5 fixos para "g"; Atomatiza 50 com 30% "a" e 10% "comum".
    const r = Pac.juntarSplit(
      [
        { carteira: "wal_comum", centavos: 0, percentual: 20 },
        { carteira: "wal_g", centavos: 500 },
      ],
      10000,
      [
        { walletId: "wal_a", percentual: 30 },
        { walletId: "WAL_COMUM", percentual: 10 },
      ],
      5000,
    );
    const por = Object.fromEntries(r.map((f) => [f.carteira.toLowerCase(), f]));
    // comum: 20×100/150 + 10×50/150 = 13,33 + 3,33 = 16,66
    igual([por.wal_comum.percentual, por.wal_a.percentual, por.wal_g.centavos, por.wal_g.percentual], [16.66, 10, 500, undefined], "partes");
    igual(r.length, 3, "sem carteira repetida");
  });

  await etapa("fixo e percentual na mesma carteira viram um percentual só, nunca passando do total", () => {
    const r = Pac.juntarSplit([{ carteira: "w", centavos: 1500 }], 10000, [{ walletId: "w", percentual: 50 }], 5000);
    // 1500/15000 = 10% + 50×5000/15000 = 16,66% → 26,66%
    igual(r, [{ carteira: "w", centavos: 0, percentual: 26.66 }], "parte");
  });

  console.log("\nA ponte — preparar e vincular (o Atomatiza cria a fatura):\n");

  const DOC_P = "86288366757";
  await db.query("delete from tenants where cpf_cnpj = $1 and email like '%@teste.local'", [DOC_P]);

  await etapa("preparar cria a conta, põe no plano e responde preço e divisão, sem assinatura", async () => {
    const r = await chamar(rotaPreparar, "/api/ponte/pacote/preparar", {
      ...pedido({ documento: DOC_P, email: `prep-${MARCA}@teste.local`, plano: { gb: 1000 } }),
      pacote: undefined,
    });
    igual([r.status, r.corpo.ok, r.corpo.contaNova, r.corpo.valorCentavos, r.corpo.nome], [200, true, true, 9999, "Galeria Átomo 1 TB"], "resposta");
    if (!Array.isArray(r.corpo.split)) throw new Error("sem split");
    const t = await tenantDoDoc(DOC_P);
    criados.push(t.id);
    igual([t.id, t.plano_id, t.asaas_assinatura_id], [r.corpo.contaId, "g:foto:1000", null], "conta");
    return "1 TB + Solo: R$ 99,99 daqui";
  });

  await etapa("vincular confere a referência da assinatura no Asaas antes de gravar", async () => {
    const t = await tenantDoDoc(DOC_P);
    const alheia = { id: novoId("sub"), status: "ACTIVE", value: 149.9, externalReference: `pacote:${criados[0]}:${ESTUDIO_ATZ}`, description: "Pacote X + Atomatiza Solo · pacote" };
    asaas.assinaturas.push(alheia);
    const r = await chamar(rotaVincular, "/api/ponte/pacote/vincular", { documento: DOC_P, contaId: t.id, assinaturaId: alheia.id, clienteId: "cus_x", ciclo: "mensal" });
    igual(r.status, 400, "assinatura de outra conta");

    const certa = { id: novoId("sub"), status: "ACTIVE", value: 149.9, customer: "cus_atz", externalReference: `pacote:${t.id}:${ESTUDIO_ATZ}`, description: "Pacote Galeria Átomo 1 TB + Atomatiza Solo · pacote" };
    asaas.assinaturas.push(certa);
    const ok = await chamar(rotaVincular, "/api/ponte/pacote/vincular", { documento: DOC_P, contaId: t.id, assinaturaId: certa.id, clienteId: "cus_atz", ciclo: "mensal" });
    igual(ok.status, 200, "vínculo");
    const depois = await tenantDoDoc(DOC_P);
    igual([depois.asaas_assinatura_id, depois.pacote_atomatiza_id, depois.combo_atomatiza], [certa.id, ESTUDIO_ATZ, "solo"], "gravado");
    const de_novo = await chamar(rotaVincular, "/api/ponte/pacote/vincular", { documento: DOC_P, contaId: t.id, assinaturaId: certa.id, clienteId: "cus_atz", ciclo: "mensal" });
    igual(de_novo.status, 200, "idempotente");
  });

  await etapa("a situação diz que a assinatura é do pacote", async () => {
    const r = await chamar(rotaSituacao, "/api/ponte/situacao", { documento: DOC_P });
    igual(r.corpo.assinatura?.pacote, true, "pacote");
  });

  await etapa("a conferência do combo não mexe na fatura única", async () => {
    const t = await tenantDoDoc(DOC_P);
    const r = await recalcularCombo(t.id, "teste");
    igual([r?.mudou, asaas.escritas.length], [false, 0], "mudou / escritas");
  });

  await etapa("mudar de plano e cancelar vão pelo WhatsApp", async () => {
    const t = await tenantDoDoc(DOC_P);
    const r = await trocarPlano(t.id, "g:foto:2000", { ip: null });
    if (!r.erro?.includes("WhatsApp")) throw new Error(`troca: ${JSON.stringify(r)}`);
  });

  await etapa("o webhook reconhece a fatura única como desta conta", () => {
    const ref = `pacote:${criados[0]}:${ESTUDIO_ATZ}`;
    igual([A.eventoEhNosso(ref), A.tenantDaReferencia(ref), A.tipoDaReferencia(ref)], [true, criados[0], "assinatura"], "referência");
  });

  console.log("\nO botão \"Assinar o pacote\" (a Galeria cria a fatura):\n");

  const origem = async (slug, doc, planoId) => {
    const { rows } = await db.query(
      `insert into tenants (slug, nome_estudio, email, senha_hash, plano_id, quota_bytes, cpf_cnpj, status)
       values ($1, $2, $3, 'x', $4, $5, $6, 'trial') returning id`,
      [`${slug}-${MARCA}`, "Estúdio Origem", `${slug}-${MARCA}@teste.local`, planoId, String(1024 ** 4), doc],
    );
    criados.push(rows[0].id);
    return rows[0].id;
  };

  await etapa("uma assinatura só, com o total, a referência dos dois e o split dos dois produtos", async () => {
    const id = await origem("pacote-origem", DOC_C, "g:foto:1000");
    atz.pedidos.length = 0;
    const r = await Pac.assinarPacote(id, { faixa: "solo", ciclo: "mensal", forma: "cartao", documento: DOC_C, aceitouTermos: true });
    igual([r.ok, r.totalCentavos], [true, 9999 + 5134], "resultado");
    const criadas = asaas.escritas.filter((e) => e.caminho === "/subscriptions");
    igual(criadas.length, 1, "uma assinatura só");
    const c = criadas[0].corpo;
    igual([c.value, c.billingType, c.externalReference], [151.33, "CREDIT_CARD", `pacote:${id}:${ESTUDIO_ATZ}`], "assinatura");
    if (c.description !== `Pacote ${marca.nome} 1 TB + Atomatiza Solo · pacote`) throw new Error(`descrição: ${c.description}`);
    const partes = Object.fromEntries((c.split ?? []).map((f) => [f.walletId, f]));
    // 30% dos 51,34 do Atomatiza = 10,18% do total de 151,33.
    igual(partes.wal_socio_atz?.percentualValue, 10.17, "parte do sócio de lá, em % do total");
    const prep = atz.pedidos.find((x) => x.caminho === "/api/ponte/pacote/preparar")?.corpo;
    igual([prep?.plano, prep?.parceiro, prep?.forma, prep?.documento], [{ faixa: "solo" }, { gb: 1000 }, "cartao", DOC_C], "preparar lá");
    const vin = atz.pedidos.find((x) => x.caminho === "/api/ponte/pacote/vincular")?.corpo;
    igual([vin?.contaId, vin?.valorCentavos], [ESTUDIO_ATZ, 5134], "vincular lá");
    const t = (await db.query("select asaas_assinatura_id, pacote_atomatiza_id, combo_atomatiza from tenants where id = $1", [id])).rows[0];
    igual([Boolean(t.asaas_assinatura_id), t.pacote_atomatiza_id, t.combo_atomatiza], [true, ESTUDIO_ATZ, "solo"], "gravado aqui");
    return "R$ 99,99 + R$ 51,34 = R$ 151,33, uma fatura";
  });

  await etapa("o Atomatiza recusou no preparar: nada é criado", async () => {
    asaas.clientes = asaas.clientes.filter((c) => c.cpfCnpj !== DOC_B);
    const id = await origem("pacote-recusa", DOC_B, "g:foto:250");
    atz.resposta = { status: 409, corpo: { erro: "Este CPF/CNPJ já tem conta no Atomatiza com outro e-mail.", codigo: "conta_de_outro_email" } };
    try {
      const antes = asaas.assinaturas.length;
      const r = await Pac.assinarPacote(id, { faixa: "equipe", ciclo: "mensal", forma: "fatura", documento: DOC_B, aceitouTermos: true });
      igual([r.ok, r.galeriaAssinada], [false, false], "resultado");
      if (!r.erro.includes("outro e-mail")) throw new Error(`erro: ${r.erro}`);
      igual(asaas.assinaturas.length, antes, "nenhuma assinatura");
    } finally {
      atz.resposta = null;
    }
  });

  await etapa("o Atomatiza não gravou o vínculo: a fatura única é cancelada e a conta limpa", async () => {
    const DOC_D = "39053344705";
    await db.query("delete from tenants where cpf_cnpj = $1 and email like '%@teste.local'", [DOC_D]);
    const id = await origem("pacote-vinculo", DOC_D, "g:foto:500");
    atz.vinculo = { status: 500, corpo: { erro: "banco fora" } };
    try {
      const r = await Pac.assinarPacote(id, { faixa: "solo", ciclo: "mensal", forma: "cartao", documento: DOC_D, aceitouTermos: true });
      igual(r.ok, false, "resultado");
      const t = (await db.query("select asaas_assinatura_id, pacote_atomatiza_id from tenants where id = $1", [id])).rows[0];
      igual([t.asaas_assinatura_id, t.pacote_atomatiza_id], [null, null], "conta limpa");
      const apagou = asaas.escritas.some((e) => e.metodo === "DELETE");
      if (!apagou) throw new Error("a assinatura única não foi cancelada");
    } finally {
      atz.vinculo = null;
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
