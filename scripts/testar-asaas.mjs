#!/usr/bin/env node
/**
 * O cliente do Asaas diante de respostas que a API de verdade não devolve sob
 * encomenda. Uso:
 *
 *   node --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-asaas.mjs
 *
 * Sobe um Asaas de mentira em `localhost` e aponta `ASAAS_API` para ele. Não
 * fala com a internet, não cria cobrança e não precisa de chave — por isso pode
 * rodar na bateria de todo `npm test`, ao contrário de `ensaio-cobranca.mjs`.
 *
 * ── OS DOIS BURACOS QUE ISTO FECHA ────────────────────────────────────────
 *
 * Achados no ensaio de 27/08/2026, contra o sandbox de verdade.
 *
 * 1. `chamar()` fazia `JSON.parse` ANTES de olhar o status. Qualquer resposta
 *    não-JSON — 502, 429, página de WAF — estourava com "Unexpected token '<'"
 *    e DESTRUÍA a única informação que diria o que houve: o status. O fotógrafo
 *    lia isso na tela.
 *
 * 2. Pior: a requisição que estourou no parse TINHA criado a assinatura no
 *    Asaas. Como `criarAssinaturaAction` cai no catch e não grava o
 *    `asaas_assinatura_id`, a guarda `if (tenant.asaas_assinatura_id) return`
 *    não dispara no clique seguinte — e o fotógrafo fica com DUAS assinaturas
 *    ativas cobrando todo mês. Reproduzido: as duas existiam, mesmo
 *    `externalReference`.
 *
 *    A mordida final é o cancelamento: o webhook mapeia SUBSCRIPTION_DELETED
 *    sem olhar QUAL assinatura. Quem percebe a cobrança dobrada e cancela uma
 *    perde o acesso continuando a pagar a outra.
 *
 * O conserto de (2) é o padrão que `garantirCliente` já usava uma função acima,
 * e pelo mesmo motivo escrito lá: procurar por `externalReference` antes de
 * criar.
 */
import { createServer } from "node:http";

/* `??=` não serve aqui: o `.env.local` tem `ASAAS_API_KEY=` VAZIA, e string
 * vazia é "definida" — a suíte passava sozinha e morria dentro de
 * `testar-tudo.mjs` com "ASAAS_API_KEY não configurada". Vale a falsidade, não
 * a ausência. */
if (!process.env.ASAAS_API_KEY?.trim()) process.env.ASAAS_API_KEY = "chave-de-mentira";
delete process.env.ASAAS_AMBIENTE;

/* Servidor de mentira. `roteiro` decide a resposta de cada requisição e
 * `pedidos` guarda o que chegou — é assim que se prova que o cliente NÃO fez o
 * POST, que é metade do conserto. */
let roteiro = () => ({ status: 200, corpo: "{}" });
const pedidos = [];

const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (p) => (corpo += p));
  req.on("end", () => {
    pedidos.push({ metodo: req.method, caminho: req.url, corpo });
    const r = roteiro(req, corpo);
    res.writeHead(r.status, { "Content-Type": r.tipo ?? "application/json" });
    res.end(r.corpo);
  });
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
process.env.ASAAS_API = `http://127.0.0.1:${servidor.address().port}`;

const { criarAssinatura, garantirCliente } = await import("../src/lib/asaas.ts");

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

const HTML =
  "<!DOCTYPE HTML><html><head><title>502 Bad Gateway</title></head><body>oops</body></html>";
const TENANT = "11111111-2222-3333-4444-555555555555";
const REF = `olumier:${TENANT}`;

const assinar = () =>
  criarAssinatura({
    clienteAsaasId: "cus_1",
    tenantId: TENANT,
    planoId: "g:foto:100",
    precoCentavos: 4999,
    ciclo: "mensal",
    descricao: "Teste",
    primeiroVencimento: new Date("2026-09-01"),
  });

const deveEstourar = async (fn) => {
  try {
    await fn();
  } catch (e) {
    return e.message;
  }
  throw new Error("não estourou — esperava erro");
};

const CRU = /Unexpected token|is not valid JSON|JSON\.parse/i;

console.log("O cliente do Asaas:\n");

/* ── respostas que não são JSON ───────────────────────────────────────────── */

await etapa("502 com HTML vira erro que DIZ 502", async () => {
  roteiro = () => ({ status: 502, corpo: HTML, tipo: "text/html" });
  const msg = await deveEstourar(assinar);
  if (CRU.test(msg)) throw new Error(`o parse comeu o status: "${msg.slice(0, 70)}"`);
  if (!msg.includes("502")) throw new Error(`não diz o status: "${msg.slice(0, 70)}"`);
  return "o status sobrevive ao erro";
});

await etapa("200 com HTML também vira erro legível", async () => {
  roteiro = () => ({ status: 200, corpo: HTML, tipo: "text/html" });
  const msg = await deveEstourar(assinar);
  if (CRU.test(msg)) throw new Error(`SyntaxError cru chegou em quem chamou: "${msg.slice(0, 70)}"`);
  return "resposta estranha com 200 não passa batido";
});

await etapa("corpo vazio com 500 não vira SyntaxError", async () => {
  roteiro = () => ({ status: 500, corpo: "" });
  const msg = await deveEstourar(assinar);
  if (CRU.test(msg)) throw new Error(msg.slice(0, 70));
  if (!msg.includes("500")) throw new Error(`não diz o status: "${msg.slice(0, 70)}"`);
});

await etapa("erro do Asaas em JSON mantém a descrição dele", async () => {
  /* Regressão: o `errors[].description` existe porque ele diz o que fazer ("CPF
   * inválido"). Um conserto que trocasse tudo por "HTTP 400" seria pior que o
   * defeito. */
  roteiro = () => ({
    status: 400,
    corpo: JSON.stringify({ errors: [{ description: "CPF ou CNPJ inválido" }] }),
  });
  const msg = await deveEstourar(assinar);
  if (!msg.includes("CPF ou CNPJ inválido")) throw new Error(`perdeu a descrição: "${msg}"`);
});

/* ── a duplicata ─────────────────────────────────────────────────────────── */

const VIVA = {
  id: "sub_ja_existe",
  status: "ACTIVE",
  deleted: false,
  nextDueDate: "2026-09-01",
  value: 49.99,
  externalReference: REF,
};

const responder = (existentes) => (req) =>
  req.method === "GET"
    ? { status: 200, corpo: JSON.stringify({ data: existentes }) }
    : { status: 200, corpo: JSON.stringify({ id: "sub_NOVA", status: "ACTIVE" }) };

await etapa("assinatura já existente é REAPROVEITADA, não duplicada", async () => {
  roteiro = responder([VIVA]);
  const a = await assinar();
  if (pedidos.some((p) => p.metodo === "POST")) {
    throw new Error("criou uma SEGUNDA assinatura para o mesmo estúdio — a cobrança dobrada");
  }
  if (a.id !== "sub_ja_existe") throw new Error(`devolveu ${a.id}, esperava a que já existia`);
  return "nenhum POST, devolveu a de sempre";
});

await etapa("assinatura CANCELADA não é reaproveitada", async () => {
  /* Reaproveitar uma assinatura morta seria pior que duplicar: o estúdio pagaria
   * a mensalidade e nunca receberia cobrança nenhuma, porque a assinatura
   * devolvida não emite mais nada. */
  roteiro = responder([{ ...VIVA, status: "INACTIVE", deleted: true }]);
  const a = await assinar();
  if (a.id !== "sub_NOVA") throw new Error("reaproveitou uma assinatura morta");
  return "criou uma nova";
});

await etapa("sem assinatura nenhuma, cria normalmente", async () => {
  roteiro = responder([]);
  const a = await assinar();
  if (a.id !== "sub_NOVA") throw new Error(`devolveu ${a.id}`);
  const posts = pedidos.filter((p) => p.metodo === "POST");
  if (posts.length !== 1) throw new Error(`fez ${posts.length} POST(s), esperava 1`);
  if (!posts[0].corpo.includes(REF)) throw new Error("o POST foi sem externalReference");
});

await etapa("a busca filtra pelo externalReference DESTE estúdio", async () => {
  /* Buscar sem filtro devolveria a assinatura de outro fotógrafo, e o estúdio
   * ficaria amarrado à cobrança alheia. */
  roteiro = responder([]);
  await assinar();
  const get = pedidos.find((p) => p.metodo === "GET");
  if (!get) throw new Error("não procurou antes de criar");
  if (!decodeURIComponent(get.caminho).includes(REF)) {
    throw new Error(`procurou sem filtrar pelo estúdio: ${get.caminho}`);
  }
});

/* `garantirCliente` já fazia certo — a etapa existe para o conserto de um não
 * quebrar o outro. */
await etapa("garantirCliente continua reaproveitando o cliente", async () => {
  roteiro = (req) =>
    req.method === "GET"
      ? { status: 200, corpo: JSON.stringify({ data: [{ id: "cus_ja", name: "x", email: "a@b" }] }) }
      : { status: 200, corpo: JSON.stringify({ id: "cus_NOVO" }) };
  const c = await garantirCliente({ tenantId: TENANT, nome: "Estúdio", email: "a@b" });
  if (c.id !== "cus_ja") throw new Error("duplicou o cliente");
});

servidor.close();
console.log(falhou ? "\n✗ o cliente do Asaas tem problema" : "\n✓ cliente do Asaas ok");
process.exitCode = falhou ? 1 : 0;
