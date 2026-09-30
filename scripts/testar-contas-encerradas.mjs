#!/usr/bin/env node
/**
 * A CONTA ENCERRADA — três meses, quatro avisos, e só então apagar. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-contas-encerradas.mjs
 *
 * Decisão do Felipe, 30/09/2026: "3 meses, mas colocando vários avisos"
 * (`config/retencao.ts`, `lib/contas-encerradas.ts`). É a segunda rotina do
 * sistema que apaga arquivo sem o dono ter pedido, e o que esta suíte prende é
 * o mesmo da primeira (`testar-cadastro-protegido.mjs`): o CALENDÁRIO — os
 * quatro avisos, nunca apagar sem o último — e as TRAVAS — quem pagou, quem
 * reativou, e-mail que não saiu, o teto.
 *
 * O e-mail e o Asaas vão para servidores de mentira deste processo.
 */
import http from "node:http";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada, marcaDaRodada } from "./fixture-de-teste.mjs";
import { urlDeUpload, objetoExiste } from "../src/lib/r2.ts";

exigirBancoDeTeste();

const recebidos = [];
const canceladasNoAsaas = [];
const servidor = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/emails") {
      const email = JSON.parse(corpo);
      if (email.to.some((p) => p.includes("falha"))) {
        res.writeHead(500);
        res.end('{"message":"recusado de propósito"}');
        return;
      }
      recebidos.push(email);
      res.end('{"id":"teste"}');
      return;
    }
    const m = req.method === "DELETE" && req.url.match(/^\/asaas\/subscriptions\/([^/]+)$/);
    if (m) {
      canceladasNoAsaas.push(decodeURIComponent(m[1]));
      res.end('{"deleted":true}');
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const porta = servidor.address().port;
process.env.EMAIL_API = `http://127.0.0.1:${porta}/emails`;
process.env.RESEND_API_KEY = "re_so_da_suite_local";
process.env.EMAIL_REMETENTE = "avisos@teste.local";
process.env.ALERTA_EMAIL_DESTINO = "alerta@teste.local";
process.env.ASAAS_API = `http://127.0.0.1:${porta}/asaas`;
process.env.ASAAS_API_KEY = "chave-de-mentira";

const retencao = await import("../src/lib/contas-encerradas.ts");
const { DIAS_DE_RETENCAO, TOTAL_DE_AVISOS } = await import("../src/config/retencao.ts");
const { ACOES } = await import("../src/lib/eventos.ts");
const { TETO_POR_RODADA } = await import("../src/lib/testes-abandonados.ts");
const { situacaoDoTenant } = await import("../src/lib/assinatura.ts");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const DIA = 24 * 60 * 60 * 1000;
const MARCA = marcaDaRodada();

/* ══ a regra, pura ══════════════════════════════════════════════════════ */

const FIM = new Date("2026-10-01T03:00:00Z");
const conta = (extra = {}) => ({
  status: "cancelado",
  pago_ate: FIM,
  trial_ate: null,
  retencao_aviso_em: null,
  retencao_avisos: 0,
  retencao_apagar_em: null,
  galerias: 2,
  ...extra,
});
const dia = (n) => new Date(FIM.getTime() + n * DIA);

/** Percorre o calendário dia a dia, aplicando cada passo como a rotina faria. */
function percorrer(c, ate = 200) {
  const log = [];
  for (let d = -5; d <= ate; d++) {
    const agora = dia(d);
    const p = retencao.proximoPassoDaRetencao(c, agora);
    if (p.tipo === "aviso") {
      log.push({ d, tipo: `aviso ${p.numero}`, apagarEm: p.apagarEm });
      if (p.numero === 1) Object.assign(c, { retencao_aviso_em: agora, retencao_avisos: 1, retencao_apagar_em: p.apagarEm });
      else Object.assign(c, { retencao_avisos: p.numero, retencao_apagar_em: p.apagarEm });
    } else if (p.tipo === "apagar") {
      log.push({ d, tipo: "apagar" });
      break;
    }
  }
  return log;
}

console.log("o calendário (regra pura)");

await etapa(`1º aviso no fim do período, depois 30, 7 e 1 dia antes; apaga aos ${DIAS_DE_RETENCAO}`, () => {
  const log = percorrer(conta());
  const resumo = log.map((l) => `${l.tipo}@${l.d}`).join(" ");
  igual(resumo, "aviso 1@0 aviso 2@60 aviso 3@83 aviso 4@89 apagar@90", "calendário");
  return resumo;
});

await etapa("toda data prometida é a data em que se apaga", () => {
  const log = percorrer(conta());
  const apagar = log.find((l) => l.tipo === "apagar");
  for (const l of log.filter((x) => x.apagarEm)) {
    igual(l.apagarEm.getTime(), dia(apagar.d).getTime(), `promessa do ${l.tipo}`);
  }
});

await etapa("e-mail ligado tarde: o calendário anda a partir do 1º aviso que SAIU", () => {
  const c = conta();
  const log = [];
  /* Nada roda até o dia 40 — como se o e-mail estivesse desligado. */
  for (let d = 40; d <= 200; d++) {
    const p = retencao.proximoPassoDaRetencao(c, dia(d));
    if (p.tipo === "aviso") {
      log.push(`aviso ${p.numero}@${d}`);
      if (p.numero === 1) Object.assign(c, { retencao_aviso_em: dia(d), retencao_avisos: 1, retencao_apagar_em: p.apagarEm });
      else Object.assign(c, { retencao_avisos: p.numero, retencao_apagar_em: p.apagarEm });
    } else if (p.tipo === "apagar") {
      log.push(`apagar@${d}`);
      break;
    }
  }
  igual(log.join(" "), "aviso 1@40 aviso 2@100 aviso 3@123 aviso 4@129 apagar@130", "calendário");
});

await etapa("aviso atrasado empurra a data para garantir a antecedência", () => {
  /* O 3º aviso (7 dias antes) só consegue sair na véspera da data. */
  const c = conta({ retencao_aviso_em: dia(0), retencao_avisos: 2, retencao_apagar_em: dia(90) });
  const p = retencao.proximoPassoDaRetencao(c, dia(89));
  igual(p.tipo, "aviso", "passo");
  igual(p.numero, 3, "número");
  igual(p.apagarEm.getTime(), dia(89 + 7).getTime(), "a data andou sete dias");
});

await etapa(`sem os ${TOTAL_DE_AVISOS} avisos gravados, nunca apaga`, () => {
  for (const avisos of [1, 2, 3]) {
    const c = conta({ retencao_aviso_em: dia(0), retencao_avisos: avisos, retencao_apagar_em: dia(90) });
    const p = retencao.proximoPassoDaRetencao(c, dia(400));
    if (p.tipo === "apagar") throw new Error(`apagou com ${avisos} aviso(s)`);
  }
});

await etapa("pagou, reativou, é cortesia, conta vazia, data ilegível: nada", () => {
  const avisada = { retencao_aviso_em: dia(0), retencao_avisos: 4, retencao_apagar_em: dia(90) };
  for (const [o, c] of [
    ["ativo", conta({ status: "ativo", ...avisada })],
    ["trial", conta({ status: "trial", ...avisada })],
    ["cortesia", conta({ status: "cortesia", ...avisada })],
    ["vazia", conta({ galerias: 0, ...avisada })],
    ["sem data", conta({ pago_ate: null, trial_ate: null, ...avisada })],
    ["data ruim", conta({ pago_ate: "ontem", trial_ate: null, ...avisada })],
  ]) {
    igual(retencao.proximoPassoDaRetencao(c, dia(200)).tipo, "nada", o);
  }
});

await etapa("reassinou e cancelou de novo: os avisos do ciclo velho não valem", () => {
  const novoFim = dia(400);
  const c = conta({ pago_ate: novoFim, retencao_aviso_em: dia(0), retencao_avisos: 4, retencao_apagar_em: dia(90) });
  igual(retencao.proximoPassoDaRetencao(c, dia(399)).tipo, "nada", "antes do novo fim");
  const p = retencao.proximoPassoDaRetencao(c, dia(400));
  igual(p.tipo, "aviso", "no novo fim");
  igual(p.numero, 1, "recomeça do primeiro");
});

await etapa("quem nunca pagou conta do fim do teste", () => {
  const c = conta({ status: "cancelado", pago_ate: null, trial_ate: FIM });
  igual(retencao.proximoPassoDaRetencao(c, dia(0)).tipo, "aviso", "tem de onde contar");
});

await etapa("os recados da tela dizem o prazo e o aviso", () => {
  for (const status of ["cancelado", "inadimplente"]) {
    const s = situacaoDoTenant({ status, trial_ate: null, pago_ate: new Date(Date.now() - DIA) }, true);
    if (!/3 meses/.test(s.recado) || !/aviso/.test(s.recado)) throw new Error(`${status}: ${s.recado}`);
  }
  const s = situacaoDoTenant({ status: "cancelado", trial_ate: null, pago_ate: new Date(Date.now() + 30 * DIA) }, true);
  if (!/3 meses/.test(s.aviso)) throw new Error(`cancelado com período: ${s.aviso}`);
});

/* ══ a rotina, com banco, armazém e e-mail ══════════════════════════════ */

console.log("\na rotina, com banco, armazém e e-mail");

const criados = [];
let contador = 0;
async function contaDeTeste(campos = {}) {
  contador++;
  const { rows } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status, trial_ate,
                          pago_ate, asaas_assinatura_id, retencao_aviso_em, retencao_avisos, retencao_apagar_em)
     values ($1, $2, $3, 'x', $4, $5, null, $6, $7, $8, $9, $10)
     returning *`,
    [
      `estudio-${MARCA}-enc-${contador}`,
      campos.nome ?? `Encerrada ${contador}`,
      campos.email ?? `${MARCA}-enc-${contador}@teste.local`,
      String(10 * 1024 ** 3),
      campos.status ?? "cancelado",
      campos.pagoAte ?? new Date(Date.now() - DIA),
      campos.assinatura ?? null,
      campos.aviso ?? null,
      campos.avisos ?? 0,
      campos.apagarEm ?? null,
    ],
  );
  criados.push(rows[0].id);
  return rows[0];
}

async function objetoReal(chave) {
  const r = await fetch(await urlDeUpload(chave, "image/jpeg"), {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: Buffer.from("foto de teste"),
  });
  if (!r.ok) throw new Error(`PUT ${chave}: ${r.status}`);
}

async function galeriaCom(tenant, { reais = false } = {}) {
  const g = await galeriaDaRodada(db, { dono: tenant, nome: `e${tenant.id.slice(0, 8)}`, medias: 2 });
  if (!reais) return { g, objetos: [] };
  const objetos = [];
  for (const m of g.midias) {
    const { rows } = await db.query("select chave, chave_thumb, chave_preview from medias where id = $1", [m.id]);
    for (const c of Object.values(rows[0])) {
      await objetoReal(c);
      objetos.push(c);
    }
  }
  return { g, objetos };
}

try {
  const agora = new Date();
  const cancelada = await contaDeTeste({ email: `${MARCA}-cancelada@teste.local` });
  const { objetos } = await galeriaCom(cancelada, { reais: true });
  const devendo = await contaDeTeste({ status: "inadimplente", assinatura: `sub_${MARCA}_devendo` });
  await galeriaCom(devendo);
  const pagante = await contaDeTeste({ status: "ativo" });
  await galeriaCom(pagante);
  const noPeriodo = await contaDeTeste({ pagoAte: new Date(Date.now() + 30 * DIA) });
  await galeriaCom(noPeriodo);
  const semCorreio = await contaDeTeste({ email: `${MARCA}-falha@teste.local` });
  await galeriaCom(semCorreio);
  const alvo = [cancelada.id, devendo.id, pagante.id, noPeriodo.id, semCorreio.id];
  const rodar = (quando, extra = {}) =>
    retencao.rodarRetencaoDeContasEncerradas({ aplicar: true, forcarLigada: true, apenas: alvo, agora: quando, ...extra });
  /* Daqui para a frente, só as duas que estão no calendário: a do período em
   * curso entraria nele aos 30 dias e embaralharia a contagem. */
  const rodarAs2 = (quando) =>
    retencao.rodarRetencaoDeContasEncerradas({
      aplicar: true,
      forcarLigada: true,
      apenas: [cancelada.id, devendo.id],
      agora: quando,
    });

  await etapa("simulação não envia nem grava", async () => {
    const antes = recebidos.length;
    const r = await retencao.rodarRetencaoDeContasEncerradas({ aplicar: false, forcarLigada: true, apenas: alvo, agora });
    igual(r.avisos, 3, "cancelada, inadimplente e a do correio que falha");
    igual(recebidos.length, antes, "e-mails");
  });

  await etapa("1º aviso: só para as encerradas com o período vencido, e registrado", async () => {
    const antes = recebidos.length;
    const r = await rodar(agora);
    igual(r.avisos, 2, "avisos");
    igual(r.falhasDeEnvio, 1, "o e-mail que o servidor recusou");
    const para = recebidos.slice(antes).map((e) => e.to[0]).sort();
    igual(JSON.stringify(para), JSON.stringify([cancelada.email, devendo.email].sort()), "destinatários");
    const { rows } = await db.query("select id, retencao_avisos from tenants where id = any($1)", [alvo]);
    const por = Object.fromEntries(rows.map((x) => [x.id, x.retencao_avisos]));
    igual(por[cancelada.id], 1, "cancelada");
    igual(por[semCorreio.id], 0, "aviso que não saiu não conta");
    igual(por[noPeriodo.id], 0, "ainda no período pago");
    const { rows: ev } = await db.query(
      "select detalhe from eventos where tenant_id = $1 and acao = $2",
      [cancelada.id, ACOES.AVISO_RETENCAO_ENVIADO],
    );
    igual(ev.length, 1, "evento");
    if (ev[0].detalhe.para || !ev[0].detalhe.para_hash) throw new Error("o destinatário não foi em hash");
  });

  await etapa("rodar de novo no mesmo dia não repete", async () => {
    const antes = recebidos.length;
    await rodar(agora);
    igual(recebidos.slice(antes).filter((e) => e.to[0] === cancelada.email).length, 0, "repetidos");
  });

  await etapa("os outros três avisos saem nas datas, e nada é apagado antes", async () => {
    const quando = (d) => new Date(agora.getTime() + d * DIA);
    for (const [d, esperado] of [[59, 0], [60, 2], [82, 0], [83, 2], [88, 0], [89, 2]]) {
      igual((await rodarAs2(quando(d))).avisos, esperado, `avisos no dia ${d}`);
    }
    const ultimo = recebidos.filter((e) => e.to[0] === cancelada.email).at(-1);
    if (!/Último aviso/.test(ultimo.subject)) throw new Error(`assunto: ${ultimo.subject}`);
    for (const c of objetos) if (!(await objetoExiste(c))) throw new Error(`${c} sumiu antes da data`);
  });

  await etapa("no dia prometido, os arquivos saem; a conta fica; a inadimplente é cancelada no Asaas", async () => {
    const r = await rodarAs2(new Date(agora.getTime() + 90 * DIA));
    igual(r.apagadas, 2, "contas limpas");
    for (const c of objetos) if (await objetoExiste(c)) throw new Error(`${c} continua no armazém`);
    const { rows } = await db.query(
      "select id, status, asaas_assinatura_id, arquivos_limpos_em from tenants where id = any($1)",
      [[cancelada.id, devendo.id]],
    );
    igual(rows.length, 2, "as contas continuam existindo");
    const d = rows.find((x) => x.id === devendo.id);
    igual(d.status, "cancelado", "a inadimplente virou cancelada");
    igual(d.asaas_assinatura_id, null, "sem assinatura");
    if (!canceladasNoAsaas.includes(`sub_${MARCA}_devendo`)) throw new Error("o Asaas não recebeu o cancelamento");
    const { rows: ev } = await db.query(
      "select detalhe from eventos where tenant_id = $1 and acao = $2",
      [cancelada.id, ACOES.ARQUIVOS_DA_CONTA_ENCERRADA_APAGADOS],
    );
    igual(ev.length, 1, "evento da limpeza");
    igual(ev[0].detalhe.avisos, TOTAL_DE_AVISOS, "com os avisos contados");
  });

  await etapa("quem paga e quem ainda está no período não foram tocados", async () => {
    const { rows } = await db.query(
      "select count(*)::int as n from galerias where tenant_id = any($1)",
      [[pagante.id, noPeriodo.id, semCorreio.id]],
    );
    igual(rows[0].n, 3, "galerias intactas");
  });

  await etapa("pagou depois do último aviso: não apaga", async () => {
    const t = await contaDeTeste({
      pagoAte: new Date(agora.getTime() - 91 * DIA),
      aviso: new Date(agora.getTime() - 91 * DIA),
      avisos: TOTAL_DE_AVISOS,
      apagarEm: new Date(agora.getTime() - DIA),
    });
    await galeriaCom(t);
    /* Todos os avisos dados e a data vencida — mas o pagamento chegou. A
     * conferência na hora de apagar (`apagarArquivosDaContaEncerrada`) é a
     * segunda trava para o caso de ele chegar no meio da rodada. */
    await db.query("update tenants set status = 'ativo', pago_ate = $2 where id = $1", [
      t.id,
      new Date(agora.getTime() + 300 * DIA),
    ]);
    const r = await retencao.rodarRetencaoDeContasEncerradas({ aplicar: true, forcarLigada: true, apenas: [t.id], agora });
    igual(r.apagadas, 0, "nada apagado");
    const { rows } = await db.query("select count(*)::int as n from galerias where tenant_id = $1", [t.id]);
    igual(rows[0].n, 1, "galeria intacta");
  });

  await etapa(`mais de ${TETO_POR_RODADA} contas numa madrugada: para e chama uma pessoa`, async () => {
    const muitas = [];
    for (let i = 0; i <= TETO_POR_RODADA; i++) {
      const t = await contaDeTeste({
        pagoAte: new Date(agora.getTime() - 91 * DIA),
        aviso: new Date(agora.getTime() - 91 * DIA),
        avisos: TOTAL_DE_AVISOS,
        apagarEm: new Date(agora.getTime() - DIA),
      });
      await db.query(
        "insert into galerias (tenant_id, slug, titulo, publicada, estado) values ($1, $2, 'x', true, 'online')",
        [t.id, `galeria-${MARCA}-enc-teto-${i}`],
      );
      muitas.push(t.id);
    }
    const antes = recebidos.length;
    const r = await retencao.rodarRetencaoDeContasEncerradas({ aplicar: true, forcarLigada: true, apenas: muitas, agora });
    igual(r.apagadas, 0, "nada apagado");
    igual(r.travadasPeloTeto, muitas.length, "travadas");
    if (!recebidos.slice(antes).some((e) => e.to[0] === "alerta@teste.local")) throw new Error("ninguém foi chamado");
    const liberada = await retencao.rodarRetencaoDeContasEncerradas({
      aplicar: true,
      forcarLigada: true,
      apenas: muitas,
      agora,
      liberarTeto: true,
    });
    igual(liberada.apagadas, muitas.length, "com a liberação de uma pessoa, todas");
  });
} finally {
  if (criados.length) await db.query("delete from tenants where id = any($1)", [criados]);
  const l = await limparRodada(db);
  await db.end();
  await globalThis._pgPool?.end();
  servidor.close();
  console.log(`\nlimpeza: ${criados.length + l.estudios} estúdio(s) de teste removido(s)`);
}

if (falhou) {
  console.log("\n✗ falhou");
  process.exit(1);
}
console.log("\n✓ conta encerrada: três meses e quatro avisos");
