#!/usr/bin/env node
/**
 * A ENTREGA POR E-MAIL E O "REMEMBER". Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-emails-da-galeria.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (01/10/2026) ─────────────────────────────────────────────────
 *
 * Juan: "estruturar um sistema de entrega de galeria, notificando por email (…)
 * O envio acontecerá para entrega da galeria quando ela estiver pronta. Esse
 * sistema de email também pode contar com emails sendo enviados 03 meses depois,
 * pedindo feedback. 06 meses depois do evento (…) 12 meses depois do evento
 * também. Relembrando 'amanhã' completará UM ANO do seu evento! E também um
 * email enviado no próprio dia do casamento."
 *
 * ── AS TRÊS REGRAS QUE ESTE ARQUIVO EXISTE PARA PRENDER ───────────────────
 *
 * 1. NINGUÉM RECEBE DUAS VEZES. "Sua galeria está pronta" chegando duas vezes na
 *    caixa da noiva é o erro que o fotógrafo não perdoa, e o botão do painel pode
 *    ser apertado duas vezes por engano.
 *
 * 2. DATA QUE JÁ PASSOU NÃO VIRA E-MAIL. A galeria costuma ser entregue semanas
 *    depois do casamento: sem esta regra, a primeira rodada do script diário
 *    mandaria "hoje é o dia", "faz seis meses" e "amanhã faz um ano" no mesmo
 *    minuto para quem casou no ano passado.
 *
 * 3. GALERIA FORA DO AR NÃO É ENTREGUE. O link iria para o casal e abriria um
 *    404 — e o fotógrafo descobriria pelo WhatsApp da noiva.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import {
  agendarEmails,
  calendarioDosEmails,
  cancelarPendentes,
  emailsDaGaleria,
  pendentesParaEnviar,
  MAX_DESTINATARIOS,
} from "../src/lib/emails-da-galeria.ts";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
};
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const g = await galeriaDaRodada(db, { nome: "emails", medias: 2 });
const cookie = cookieDeSessao(g.tenant_id);
const NOIVA = `noiva-emails-${Date.now()}@exemplo.com`;

console.log("A entrega por e-mail:\n");

/* ── A RÉGUA, sem banco ─────────────────────────────────────────────────── */

const HOJE = new Date("2026-10-02T12:00:00Z");

await etapa("sem lembretes, só a entrega — e é hoje", async () => {
  const c = calendarioDosEmails(HOJE, new Date("2026-09-01T12:00:00Z"), false);
  igual(c.length, 1, "quantos");
  igual(c[0].tipo, "entrega", "tipo");
  igual(c[0].quando, "2026-10-02", "quando");
});

await etapa("com lembretes e evento NO FUTURO, os cinco entram", async () => {
  /* Galeria criada antes do casamento: é o único caso em que "no próprio dia do
     casamento" tem como acontecer. */
  const c = calendarioDosEmails(HOJE, new Date("2026-12-20T12:00:00Z"), true);
  const tipos = c.map((x) => x.tipo).sort();
  igual(tipos.join(","), "dia_do_evento,entrega,feedback,relembrar,um_ano", "tipos");
  igual(c.find((x) => x.tipo === "dia_do_evento").quando, "2026-12-20", "dia do evento");
  igual(c.find((x) => x.tipo === "feedback").quando, "2026-12-31", "90 dias da entrega");
  return tipos.length + " tipos";
});

await etapa("evento NO PASSADO: o dia do casamento não é agendado", async () => {
  /* A regra 2. Casou em setembro, galeria entregue em outubro: "hoje é o dia"
     não existe mais, mas seis meses e um ano ainda estão à frente. */
  const c = calendarioDosEmails(HOJE, new Date("2026-09-01T12:00:00Z"), true);
  const tipos = c.map((x) => x.tipo).sort();
  if (tipos.includes("dia_do_evento")) throw new Error("agendou o dia do casamento no passado");
  igual(tipos.join(","), "entrega,feedback,relembrar,um_ano", "tipos");
  return "4 tipos";
});

await etapa("casamento de um ano atrás: só entrega e feedback", async () => {
  const c = calendarioDosEmails(HOJE, new Date("2025-06-10T12:00:00Z"), true);
  igual(
    c.map((x) => x.tipo).sort().join(","),
    "entrega,feedback",
    "tipos",
  );
});

await etapa("sem data de evento, nenhum lembrete do evento existe", async () => {
  const c = calendarioDosEmails(HOJE, null, true);
  igual(c.map((x) => x.tipo).sort().join(","), "entrega,feedback", "tipos");
});

/* ── AGENDAR ────────────────────────────────────────────────────────────── */

await etapa("galeria fora do ar não agenda nada", async () => {
  await db.query("update galerias set publicada = false where id = $1", [g.id]);
  const r = await agendarEmails(g.id, g.tenant_id, [{ email: NOIVA, nome: "Ana" }]);
  igual(r.agendados, 0, "agendados");
  if (!r.erro) throw new Error("deixou passar sem erro");
  return r.erro;
});

await etapa("e-mail que não é e-mail é recusado", async () => {
  await db.query("update galerias set publicada = true where id = $1", [g.id]);
  const r = await agendarEmails(g.id, g.tenant_id, [{ email: "ana" }, { email: "ana@" }]);
  igual(r.agendados, 0, "agendados");
  if (!r.erro) throw new Error("aceitou endereço inválido");
});

await etapa("agendar cria a entrega, e só ela sem lembretes", async () => {
  const r = await agendarEmails(g.id, g.tenant_id, [{ email: NOIVA, nome: "Ana" }]);
  igual(r.agendados, 1, "agendados");
  const lista = await emailsDaGaleria(g.id);
  igual(lista.length, 1, "linhas");
  igual(lista[0].tipo, "entrega", "tipo");
  igual(lista[0].para, NOIVA, "destinatário");
});

await etapa("apertar o botão DUAS VEZES não manda duas vezes", async () => {
  /* A regra 1, e a trava é o índice único da migração 059. */
  const r = await agendarEmails(g.id, g.tenant_id, [{ email: NOIVA, nome: "Ana" }]);
  igual(r.agendados, 0, "agendados na segunda");
  const lista = await emailsDaGaleria(g.id);
  igual(lista.length, 1, "linhas");
});

await etapa("com lembretes ligados, o resto entra na fila", async () => {
  await db.query(
    "update galerias set email_lembretes = true, data_evento = now() + interval '40 days' where id = $1",
    [g.id],
  );
  const r = await agendarEmails(g.id, g.tenant_id, [{ email: NOIVA, nome: "Ana" }]);
  /* A entrega já existia: entram os quatro que faltavam. */
  igual(r.agendados, 4, "agendados");
  const lista = await emailsDaGaleria(g.id);
  igual(lista.length, 5, "linhas");
  return lista.map((l) => l.tipo).join(", ");
});

await etapa("o mesmo endereço em maiúsculas é a mesma pessoa", async () => {
  const r = await agendarEmails(g.id, g.tenant_id, [{ email: NOIVA.toUpperCase() }]);
  igual(r.agendados, 0, "agendados");
});

await etapa("dois destinatários, duas filas", async () => {
  const noivo = `noivo-emails-${Date.now()}@exemplo.com`;
  const r = await agendarEmails(g.id, g.tenant_id, [{ email: noivo, nome: "Davi" }]);
  igual(r.agendados, 5, "agendados");
  const lista = await emailsDaGaleria(g.id);
  igual(lista.length, 10, "linhas");
});

await etapa("a lista de destinatários tem teto", async () => {
  const demais = Array.from({ length: MAX_DESTINATARIOS + 5 }, (_, i) => ({
    email: `teto-${i}-${Date.now()}@exemplo.com`,
  }));
  const antes = (await emailsDaGaleria(g.id)).length;
  await agendarEmails(g.id, g.tenant_id, demais);
  const depois = (await emailsDaGaleria(g.id)).length;
  const novos = (depois - antes) / 5;
  if (novos > MAX_DESTINATARIOS) throw new Error(`entraram ${novos} destinatários`);
  return `${novos} de ${demais.length} pedidos`;
});

/* ── A FILA E O SCRIPT ──────────────────────────────────────────────────── */

await etapa("a entrega de hoje aparece como pendente", async () => {
  const pendentes = await pendentesParaEnviar(new Date());
  const minha = pendentes.filter((p) => p.galeriaId === g.id);
  if (minha.length === 0) throw new Error("a entrega de hoje não entrou na fila");
  /* Só a entrega: os lembretes estão agendados para o futuro. */
  for (const p of minha) igual(p.tipo, "entrega", "tipo pendente");
  return `${minha.length} pendente(s)`;
});

await etapa("lembrete do futuro NÃO entra na fila de hoje", async () => {
  const pendentes = await pendentesParaEnviar(new Date());
  const futuros = pendentes.filter((p) => p.galeriaId === g.id && p.tipo !== "entrega");
  igual(futuros.length, 0, "lembretes na fila");
});

await etapa("o endereço do e-mail é o canônico do produto", async () => {
  const { urlDoEmail } = await import("../src/lib/emails-da-galeria.ts");
  const [p] = (await pendentesParaEnviar(new Date())).filter((x) => x.galeriaId === g.id);
  const url = urlDoEmail(p);
  if (!url.startsWith(`https://${g.tslug}.`)) throw new Error(`endereço estranho: ${url}`);
  if (!url.endsWith(`/${g.gslug}`)) throw new Error(`endereço estranho: ${url}`);
  return url;
});

await etapa("o e-mail montado diz o que é, e leva o link", async () => {
  const { montarEmailDaGaleria } = await import("../src/config/email-da-galeria.ts");
  const [p] = (await pendentesParaEnviar(new Date())).filter((x) => x.galeriaId === g.id);
  const { urlDoEmail } = await import("../src/lib/emails-da-galeria.ts");
  const url = urlDoEmail(p);
  const { assunto, html, texto } = montarEmailDaGaleria({
    tipo: "entrega",
    template: "claro",
    nome: "Ana",
    estudio: { nome: "Estúdio de Teste", cor: "#223344", logoUrl: null },
    galeria: { titulo: p.titulo, url, capaUrl: null, dataEvento: p.dataEvento },
    mensagem: null,
    destaques: [],
  });
  if (!assunto.includes(p.titulo)) throw new Error(`assunto sem o nome da galeria: ${assunto}`);
  if (!html.includes(url)) throw new Error("o HTML não tem o link da galeria");
  if (!texto.includes(url)) throw new Error("a versão em texto não tem o link");
  /* O nome do casal é texto do fotógrafo e vai para a caixa de e-mail de
     terceiros: escapar não é opcional. */
  const comHtml = montarEmailDaGaleria({
    tipo: "entrega",
    template: "claro",
    nome: "Ana",
    estudio: { nome: "<script>x</script>", cor: "#223344", logoUrl: null },
    galeria: { titulo: "<img src=x onerror=alert(1)>", url, capaUrl: null, dataEvento: null },
    mensagem: null,
    destaques: [],
  });
  if (/<img src=x onerror=/.test(comHtml.html)) throw new Error("o título virou marcação");
  if (/<script>x<\/script>/.test(comHtml.html)) throw new Error("o nome do estúdio virou marcação");
  return assunto;
});

await etapa("o script em modo seco não manda nada nem mexe na fila", async () => {
  const { execFileSync } = await import("node:child_process");
  const saida = execFileSync(
    process.execPath,
    [
      "--env-file=.env.local",
      "--experimental-strip-types",
      "--import",
      "./scripts/registrar-ts.mjs",
      "scripts/enviar-emails-da-galeria.mjs",
    ],
    { encoding: "utf8", cwd: process.cwd() },
  );
  if (!/modo seco/.test(saida)) throw new Error("não disse que era modo seco");
  const lista = await emailsDaGaleria(g.id);
  if (lista.some((l) => l.enviadoEm)) throw new Error("o modo seco marcou alguém como enviado");
  return "fila intacta";
});

await etapa("galeria fora do ar: o script pula e escreve o motivo", async () => {
  /* A regra 3 — e com `--aplicar`, que é o caminho de produção. O envio nem é
     tentado: não há chave de e-mail nesta bancada, e o pulo acontece antes. */
  await db.query("update galerias set publicada = false where id = $1", [g.id]);
  const { execFileSync } = await import("node:child_process");
  let saida = "";
  try {
    saida = execFileSync(
      process.execPath,
      [
        "--env-file=.env.local",
        "--experimental-strip-types",
        "--import",
        "./scripts/registrar-ts.mjs",
        "scripts/enviar-emails-da-galeria.mjs",
        "--aplicar",
      ],
      { encoding: "utf8", cwd: process.cwd() },
    );
  } catch (e) {
    /*
     * Sem chave de e-mail o script sai 1 — e é o certo. O que importa aqui
     * continua valendo e continua sendo conferido abaixo: ele PULOU a galeria
     * fora do ar e escreveu o motivo na fila, sem marcar ninguém como enviado.
     */
    saida = String(e.stdout ?? "") + String(e.stderr ?? "");
    if (!/não dá para enviar|pulado/.test(saida)) throw e;
  }
  const lista = await emailsDaGaleria(g.id);
  const entrega = lista.find((l) => l.tipo === "entrega");
  if (entrega.enviadoEm) throw new Error("mandou de uma galeria fora do ar");
  if (!entrega.erro) throw new Error("não escreveu o motivo de ter pulado");
  await db.query("update galerias set publicada = true where id = $1", [g.id]);
  return entrega.erro;
});

/* ── CANCELAR ───────────────────────────────────────────────────────────── */

await etapa("cancelar tira o pendente e NÃO mexe no que já saiu", async () => {
  /* E-mail enviado não se desfaz: tirar a linha dele faria a tela mentir sobre
     o que o casal recebeu. */
  await db.query(
    "update emails_da_galeria set enviado_em = now(), erro = null where galeria_id = $1 and tipo = 'entrega'",
    [g.id],
  );
  const antes = await emailsDaGaleria(g.id);
  const enviados = antes.filter((l) => l.enviadoEm).length;
  const quantos = await cancelarPendentes(g.id, g.tenant_id);
  const depois = await emailsDaGaleria(g.id);
  igual(depois.length, enviados, "linhas que sobraram");
  if (quantos === 0) throw new Error("não cancelou nada");
  return `${quantos} cancelados, ${enviados} preservados`;
});

await etapa("cancelar de OUTRO estúdio não cancela nada", async () => {
  const { segundoEstudioDaRodada } = await import("./fixture-de-teste.mjs");
  const outro = await segundoEstudioDaRodada(db);
  await agendarEmails(g.id, g.tenant_id, [{ email: `vizinho-${Date.now()}@exemplo.com` }]);
  const antes = (await emailsDaGaleria(g.id)).length;
  const quantos = await cancelarPendentes(g.id, outro.id);
  igual(quantos, 0, "cancelados");
  igual((await emailsDaGaleria(g.id)).length, antes, "linhas");
});

/* ── A TELA DO FOTÓGRAFO ────────────────────────────────────────────────── */

await etapa("a aba Entrega oferece avisar o cliente por e-mail", async () => {
  const r = await fetch(`${BASE}/painel/galerias/${g.id}/entrega`, {
    headers: { cookie },
    cache: "no-store",
  });
  igual(r.status, 200, "status");
  const html = (await r.text()).replace(/<script[\s\S]*?<\/script>/g, "");
  if (!/[Aa]visar o cliente/.test(html)) {
    throw new Error("a aba Entrega não fala de avisar o cliente por e-mail");
  }
  return "está na Entrega";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a entrega por e-mail não fecha" : "\n✓ a entrega por e-mail ok");
process.exitCode = falhou ? 1 : 0;
