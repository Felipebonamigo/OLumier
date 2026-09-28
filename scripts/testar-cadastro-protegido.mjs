#!/usr/bin/env node
/**
 * UMA CONTA DE TESTE POR PESSOA — as quatro travas de 28/09/2026.
 * Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-cadastro-protegido.mjs
 *
 * Felipe: "para criar a conta, precisa de um cpf/cnpj? para garantir que não
 * criem contas repetidas para usar os 10 GB". E depois: CPF/CNPJ único no
 * cadastro, confirmar o e-mail antes de subir fotos, limite de cadastros por
 * IP, e apagar os arquivos de testes abandonados 60 dias após vencer, com
 * aviso por e-mail. Ver `db/migracoes/045-cadastro-protegido.sql`.
 *
 * A etapa que mais importa é a última: é a única rotina do sistema que apaga
 * arquivo sem o dono ter pedido. O que ela prende é o CALENDÁRIO (dois avisos
 * antes, nunca apagar sem o último) e as TRAVAS (assinatura, e-mail que não
 * saiu, o teto que para tudo e chama uma pessoa).
 *
 * O e-mail vai para um servidor de mentira deste processo — nada sai daqui.
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada, marcaDaRodada } from "./fixture-de-teste.mjs";
import { urlDeUpload, objetoExiste } from "../src/lib/r2.ts";

exigirBancoDeTeste();

/* ── o e-mail de mentira ─────────────────────────────────────────────────
 * Antes de importar qualquer módulo que leia `EMAIL_API`: `lib/email.ts` lê o
 * endereço uma vez, ao carregar. Destinatário com "falha" no nome recebe 500 —
 * é como a suíte prova que aviso que não saiu não conta. */
const recebidos = [];
const correio = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    const email = JSON.parse(corpo);
    if (email.to.some((p) => p.includes("falha"))) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"message":"recusado de propósito"}');
      return;
    }
    recebidos.push(email);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"id":"teste"}');
  });
});
await new Promise((r) => correio.listen(0, "127.0.0.1", r));
process.env.EMAIL_API = `http://127.0.0.1:${correio.address().port}/emails`;
process.env.RESEND_API_KEY = "re_so_da_suite_local";
process.env.EMAIL_REMETENTE = "avisos@teste.local";
process.env.ALERTA_EMAIL_DESTINO = "alerta@teste.local";

const { formatarDocumento } = await import("../src/lib/documento.ts");
const { criarTenant } = await import("../src/lib/tenants.ts");
const { PLANO_INICIAL } = await import("../src/config/planos.ts");
const { hashDeIp } = await import("../src/lib/ip.ts");
const { registrarEvento, ACOES } = await import("../src/lib/eventos.ts");
const cadastro = await import("../src/lib/cadastro.ts");
const confirmacao = await import("../src/lib/confirmacao-email.ts");
const { hashDoToken } = await import("../src/lib/recuperacao.ts");
const limpeza = await import("../src/lib/testes-abandonados.ts");

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
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

/** CPF válido e novo a cada chamada — rodadas em paralelo não colidem. */
function cpfAleatorio() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const casas of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < casas; i++) soma += d[i] * (casas + 1 - i);
    const resto = (soma * 10) % 11;
    d.push(resto === 10 ? 0 : resto);
  }
  const s = d.join("");
  return /^(\d)\1+$/.test(s) ? cpfAleatorio() : s;
}

/* Tudo o que esta suíte cria fora da bancada padrão, para a limpeza final. */
const criados = [];
let contador = 0;
async function contaDeTeste(campos = {}) {
  contador++;
  const { rows } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status, trial_ate,
                          cpf_cnpj, asaas_assinatura_id, aviso_limpeza_em, aviso_limpeza_final_em)
     values ($1, $2, $3, 'x', $4, $5, $6, $7, $8, $9, $10)
     returning *`,
    [
      `estudio-${MARCA}-${contador}`,
      campos.nome ?? `Teste ${contador}`,
      campos.email ?? `${MARCA}-${contador}@teste.local`,
      String(10 * 1024 ** 3),
      campos.status ?? "trial",
      campos.trialAte ?? new Date(Date.now() - 31 * DIA),
      campos.cpf ?? null,
      campos.assinatura ?? null,
      campos.aviso ?? null,
      campos.avisoFinal ?? null,
    ],
  );
  criados.push(rows[0].id);
  return rows[0];
}

/** Um objeto de verdade no armazém — para provar que a limpeza o apaga. */
async function objetoReal(chave) {
  const r = await fetch(await urlDeUpload(chave, "image/jpeg"), {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: Buffer.from("foto de teste"),
  });
  if (!r.ok) throw new Error(`PUT ${chave}: ${r.status}`);
}

async function galeriaCom(tenant, { reais = false } = {}) {
  const g = await galeriaDaRodada(db, { dono: tenant, nome: `g${tenant.id.slice(0, 8)}`, medias: 2 });
  if (reais) {
    for (const m of g.midias) {
      const { rows } = await db.query(
        "select chave, chave_thumb, chave_preview from medias where id = $1",
        [m.id],
      );
      for (const c of Object.values(rows[0])) await objetoReal(c);
    }
    const capa = `${tenant.id}/${g.id}/capa-${MARCA}.jpg`;
    await objetoReal(capa);
    await db.query("update galerias set capa_chave = $1 where id = $2", [capa, g.id]);
  }
  return g;
}

try {
  /* ══ 1. CPF/CNPJ único ═══════════════════════════════════════════════════ */
  console.log("CPF/CNPJ único");

  const cpf = cpfAleatorio();
  const dono = await contaDeTeste({ status: "ativo", cpf });

  await etapa("o documento já usado é reconhecido, formatado ou não", async () => {
    igual(await cadastro.documentoEmUso(cpf), true, "só dígitos");
    igual(await cadastro.documentoEmUso(formatarDocumento(cpf)), true, "com pontuação");
    igual(await cadastro.documentoEmUso(cpfAleatorio()), false, "outro documento");
  });

  await etapa("a própria conta não colide consigo (ativar a assinatura)", async () => {
    igual(await cadastro.documentoEmUso(cpf, dono.id), false, "excetoTenantId");
  });

  await etapa("o banco recusa a segunda conta com o mesmo documento", async () => {
    try {
      await criarTenant({ nomeEstudio: "Duplicada", email: `${MARCA}-dup@teste.local`, senha: "x".repeat(12), planoId: PLANO_INICIAL, cpfCnpj: cpf });
    } catch (e) {
      if (!cadastro.colisaoDeDocumento(e)) throw new Error(`erro inesperado: ${e.message}`);
      return "e o erro é reconhecido como colisão de documento";
    }
    throw new Error("aceitou dois estúdios com o mesmo CPF");
  });

  await etapa("o cadastro pede o campo, e confere as três travas no servidor", async () => {
    const html = await fetch(`${BASE}/cadastrar`).then((r) => r.text());
    if (!html.includes('name="documento"')) throw new Error("/cadastrar não tem o campo de documento");
    const acao = readFileSync("src/app/(auth)/actions.ts", "utf8");
    const corpo = acao.slice(acao.indexOf("export async function cadastrarAction"), acao.indexOf("export async function sairAction"));
    for (const f of ["conferirDocumento(", "documentoEmUso(", "ipPodeCadastrar(", "colisaoDeDocumento(", "cpfCnpj: documento"]) {
      if (!corpo.includes(f)) throw new Error(`cadastrarAction não chama ${f}`);
    }
  });

  await etapa("o link do Atomatiza preenche o cadastro pelo fragmento, e só pelo fragmento", async () => {
    const { lerPreenchimento } = await import("../src/lib/preenchimento-cadastro.ts");
    const p = lerPreenchimento("#origem=atomatiza&documento=52998224725&email=oi%40sirius.com.br&estudio=Ana+%26+Bia");
    igual(p.documento, "529.982.247-25", "documento formatado");
    igual(p.email, "oi@sirius.com.br", "e-mail");
    igual(p.estudio, "Ana & Bia", "estúdio");
    igual(p.doAtomatiza, true, "origem");
    igual(lerPreenchimento("").documento, "", "sem fragmento");
    igual(lerPreenchimento("#documento=" + "9".repeat(40)).documento.replace(/\D/g, "").length, 14, "documento cortado");
    igual(lerPreenchimento("#estudio=" + "x".repeat(500)).estudio.length, 80, "nome cortado");
    /* O formulário lê `window.location.hash` — nunca a query, que iria para o
     * log do servidor com o CPF dentro. */
    const form = readFileSync("src/app/(auth)/cadastrar/form.tsx", "utf8");
    if (!form.includes("window.location.hash")) throw new Error("o formulário não lê o fragmento");
    if (/searchParams|location\.search/.test(form)) throw new Error("o formulário lê a query");
  });

  /* ══ 2. Confirmar o e-mail ═══════════════════════════════════════════════ */
  console.log("\nconfirmação do e-mail");

  await etapa("a regra: só trava com o e-mail ligado e o clique pendente", () => {
    igual(confirmacao.confirmacaoPendente({ email_confirmado_em: null }, true), true, "ligado + pendente");
    igual(confirmacao.confirmacaoPendente({ email_confirmado_em: null }, false), false, "desligado");
    igual(confirmacao.confirmacaoPendente({ email_confirmado_em: new Date() }, true), false, "confirmado");
  });

  await etapa("conta criada fora do cadastro nasce confirmada; o cadastro com e-mail, pendente", async () => {
    const livre = await criarTenant({ nomeEstudio: "Livre", email: `${MARCA}-livre@teste.local`, senha: "x".repeat(12), planoId: PLANO_INICIAL, cpfCnpj: cpfAleatorio() });
    criados.push(livre.id);
    if (!livre.email_confirmado_em) throw new Error("a conta sem pedido de confirmação nasceu pendente");
    igual(livre.cpf_cnpj.length, 11, "documento gravado só com dígitos");
    const pendente = await criarTenant({ nomeEstudio: "Pendente", email: `${MARCA}-pend@teste.local`, senha: "x".repeat(12), planoId: PLANO_INICIAL, cpfCnpj: cpfAleatorio(), emailConfirmado: false });
    criados.push(pendente.id);
    igual(pendente.email_confirmado_em, null, "pendente");
    igual(confirmacao.precisaConfirmarEmail(pendente), true, "com o e-mail ligado, trava");
  });

  const pendente = await contaDeTeste({ status: "ativo", cpf: cpfAleatorio() });
  await db.query("update tenants set email_confirmado_em = null where id = $1", [pendente.id]);

  await etapa("o link sai por e-mail, e o banco guarda só o hash", async () => {
    const antes = recebidos.length;
    const saiu = await confirmacao.enviarConfirmacao(pendente);
    igual(saiu, true, "enviado");
    const email = recebidos[antes];
    igual(email.to[0], pendente.email, "destinatário");
    const token = email.text.match(/confirmar-email\/([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error("o e-mail não traz o link");
    const { rows } = await db.query("select token_hash from confirmacoes_email where tenant_id = $1", [pendente.id]);
    igual(rows.length, 1, "um pedido");
    igual(rows[0].token_hash, hashDoToken(token), "hash");
  });

  await etapa("nome do estúdio vai escapado no HTML do e-mail", async () => {
    const malicioso = await contaDeTeste({ nome: '<img src=x onerror="alert(1)">', status: "ativo" });
    const antes = recebidos.length;
    await confirmacao.enviarConfirmacao(malicioso);
    if (recebidos[antes].html.includes("<img src=x")) throw new Error("HTML do nome foi para o e-mail cru");
  });

  await etapa("link inventado, vencido e superado são recusados", async () => {
    igual((await confirmacao.confirmarEmail("x".repeat(43))).ok, false, "inventado");
    const vencido = await confirmacao.criarConfirmacao(pendente.id);
    await db.query("update confirmacoes_email set expira_em = now() - interval '1 minute' where token_hash = $1", [hashDoToken(vencido)]);
    igual((await confirmacao.confirmarEmail(vencido)).motivo, "expirado", "vencido");
    const velho = await confirmacao.criarConfirmacao(pendente.id);
    await confirmacao.criarConfirmacao(pendente.id);
    igual((await confirmacao.confirmarEmail(velho)).motivo, "usado", "o anterior é queimado pelo novo");
    const { rows } = await db.query("select email_confirmado_em from tenants where id = $1", [pendente.id]);
    igual(rows[0].email_confirmado_em, null, "nenhum deles confirmou");
  });

  await etapa("a página do link confirma, e o segundo clique não assusta", async () => {
    const token = await confirmacao.criarConfirmacao(pendente.id);
    const html = await fetch(`${BASE}/confirmar-email/${token}`).then((r) => r.text());
    if (!html.includes("E-mail confirmado")) throw new Error("a página não confirmou");
    const { rows } = await db.query("select email_confirmado_em from tenants where id = $1", [pendente.id]);
    if (!rows[0].email_confirmado_em) throw new Error("a coluna não foi preenchida");
    const de_novo = await fetch(`${BASE}/confirmar-email/${token}`).then((r) => r.text());
    if (!de_novo.includes("E-mail confirmado")) throw new Error("o segundo clique virou erro");
    const ruim = await fetch(`${BASE}/confirmar-email/${"y".repeat(43)}`).then((r) => r.text());
    if (!ruim.includes("Link inválido")) throw new Error("link inventado não disse que é inválido");
  });

  await etapa("as duas portas de envio conferem o e-mail depois do tenant", () => {
    const rota = readFileSync("src/app/api/galerias/[id]/upload/route.ts", "utf8");
    const api = readFileSync("src/lib/auth-api.ts", "utf8");
    for (const [nome, fonte] of [["rota de envio", rota], ["tenantQuePodeEnviar", api]]) {
      const i = fonte.indexOf("precisaConfirmarEmail(tenant)");
      if (i < 0) throw new Error(`${nome} não confere o e-mail`);
      if (i < fonte.indexOf("buscarTenantPorId(tenantId)")) throw new Error(`${nome} confere antes de ter o tenant`);
    }
  });

  /* ══ 3. Limite por IP ════════════════════════════════════════════════════ */
  console.log("\nlimite de cadastros por IP");

  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  await etapa(`até ${cadastro.LIMITE_CADASTROS_POR_IP} contas por IP em 24 h`, async () => {
    for (let i = 0; i < cadastro.LIMITE_CADASTROS_POR_IP; i++) {
      igual(await cadastro.ipPodeCadastrar(ip), true, `cadastro ${i + 1}`);
      await registrarEvento({ ator: "estudio", acao: ACOES.CONTA_CRIADA, detalhe: { teste: MARCA }, ip });
    }
    igual(await cadastro.ipPodeCadastrar(ip), false, "o seguinte");
  });

  await etapa("o que passou da janela não conta", async () => {
    const outro = `10.251.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 5; i++) {
      await db.query(
        `insert into eventos (ator, acao, detalhe, ip_hash, criado_em)
         values ('estudio', $1, $2, $3, now() - interval '25 hours')`,
        [ACOES.CONTA_CRIADA, JSON.stringify({ teste: MARCA }), hashDeIp(outro)],
      );
    }
    igual(await cadastro.cadastrosRecentesDoIp(outro), 0, "eventos de ontem");
  });

  await etapa("sem IP conhecido não trava ninguém", async () => {
    igual(await cadastro.cadastrosRecentesDoIp(null), 0, "null");
    igual(await cadastro.ipPodeCadastrar(null), true, "null");
  });

  /* ══ 4. O teste abandonado ═══════════════════════════════════════════════ */
  console.log("\nteste abandonado — o calendário (regra pura)");

  const fim = new Date("2026-01-01T12:00:00Z");
  const conta = (extra = {}) => ({
    status: "trial",
    trial_ate: fim,
    asaas_assinatura_id: null,
    aviso_limpeza_em: null,
    aviso_limpeza_final_em: null,
    galerias: 1,
    ...extra,
  });
  const dia = (n, horas = 0) => new Date(fim.getTime() + n * DIA + horas * 3600 * 1000);

  /** Percorre os dias como a madrugada faria, gravando o que ela gravaria. */
  function simular(inicio, fimSim, c = conta()) {
    const diario = [];
    for (let n = inicio; n <= fimSim; n++) {
      const agora = dia(n);
      const p = limpeza.proximoPasso(c, agora);
      if (p.tipo === "primeiro_aviso") c.aviso_limpeza_em = agora;
      if (p.tipo === "aviso_final") c.aviso_limpeza_final_em = agora;
      if (p.tipo !== "nada") diario.push(`${p.tipo}@${n}`);
      if (p.tipo === "apagar") break;
    }
    return diario.join(" ");
  }

  await etapa("aviso aos 30 dias, aviso final aos 53, apaga aos 60", () => {
    igual(simular(0, 90), "primeiro_aviso@30 aviso_final@53 apagar@60", "calendário");
  });

  await etapa("o primeiro aviso promete a data que o apagamento cumpre", () => {
    const p = limpeza.proximoPasso(conta(), dia(30));
    igual(p.apagarEm.getTime(), dia(60).getTime(), "data no e-mail");
  });

  await etapa("e-mail ligado tarde: o calendário anda a partir do aviso, não do vencimento", () => {
    const c = conta();
    igual(simular(100, 200, c), "primeiro_aviso@100 aviso_final@123 apagar@130", "a partir do dia 100");
  });

  await etapa("aviso final atrasado garante 7 dias inteiros", () => {
    const c = conta({ aviso_limpeza_em: dia(30) });
    igual(limpeza.proximoPasso(c, dia(58)).tipo, "aviso_final", "sai no dia 58");
    c.aviso_limpeza_final_em = dia(58);
    igual(limpeza.proximoPasso(c, dia(60)).tipo, "nada", "não apaga no dia prometido");
    igual(limpeza.proximoPasso(c, dia(65)).tipo, "apagar", "apaga 7 dias depois do final");
  });

  await etapa("sem o aviso final gravado, nunca apaga", () => {
    const c = conta({ aviso_limpeza_em: dia(30) });
    igual(limpeza.proximoPasso(c, dia(400)).tipo, "aviso_final", "mesmo um ano depois");
  });

  await etapa("a madrugada seguinte, dois segundos mais cedo, não perde o dia", () => {
    const c = conta({ aviso_limpeza_em: new Date(dia(30).getTime() + 3000), aviso_limpeza_final_em: new Date(dia(53).getTime() + 3000) });
    igual(limpeza.proximoPasso(c, new Date(dia(60).getTime() + 1000)).tipo, "apagar", "folga");
  });

  await etapa("assinatura, outro status, conta vazia e data ilegível: nada", () => {
    const tarde = dia(200);
    igual(limpeza.proximoPasso(conta({ asaas_assinatura_id: "sub_1" }), tarde).tipo, "nada", "assinou");
    for (const status of ["ativo", "cortesia", "cancelado", "inadimplente", "outro"]) {
      igual(limpeza.proximoPasso(conta({ status }), tarde).tipo, "nada", status);
    }
    igual(limpeza.proximoPasso(conta({ galerias: 0 }), tarde).tipo, "nada", "sem galerias");
    igual(limpeza.proximoPasso(conta({ trial_ate: "lixo" }), tarde).tipo, "nada", "data");
    igual(limpeza.proximoPasso(conta({ trial_ate: null }), tarde).tipo, "nada", "sem data");
  });

  await etapa("teste estendido pelo admin: os avisos antigos não valem", () => {
    const c = conta({ aviso_limpeza_em: dia(30), aviso_limpeza_final_em: dia(53), trial_ate: dia(55) });
    igual(limpeza.proximoPasso(c, dia(70)).tipo, "nada", "o teste novo ainda não venceu há 30 dias");
    igual(limpeza.proximoPasso(c, dia(85)).tipo, "primeiro_aviso", "recomeça do primeiro aviso");
  });

  console.log("\nteste abandonado — a rotina, com banco, armazém e e-mail");

  const agora = new Date();
  const abandonada = await contaDeTeste({ email: `${MARCA}-abandonada@teste.local` });
  const galeria = await galeriaCom(abandonada, { reais: true });
  const { rows: chavesReais } = await db.query(
    "select chave, chave_thumb, chave_preview from medias where galeria_id = $1",
    [galeria.id],
  );
  const { rows: capaRow } = await db.query("select capa_chave from galerias where id = $1", [galeria.id]);
  const objetos = [...chavesReais.flatMap((m) => Object.values(m)), capaRow[0].capa_chave];

  const assinou = await contaDeTeste({ assinatura: "sub_teste" });
  await galeriaCom(assinou);
  const pagante = await contaDeTeste({ status: "ativo" });
  await galeriaCom(pagante);
  const semCorreio = await contaDeTeste({ email: `${MARCA}-falha@teste.local` });
  await galeriaCom(semCorreio);
  const alvo = [abandonada.id, assinou.id, pagante.id, semCorreio.id];
  const rodar = (quando, extra = {}) =>
    limpeza.rodarLimpezaDeTestes({ aplicar: true, forcarLigada: true, apenas: alvo, agora: quando, ...extra });

  await etapa("sem e-mail ou sem cobrança, a rotina nem começa", async () => {
    const guardado = { email: process.env.RESEND_API_KEY, asaas: process.env.ASAAS_API_KEY };
    try {
      process.env.ASAAS_API_KEY = "chave-de-mentira";
      delete process.env.RESEND_API_KEY;
      const semEmail = await limpeza.rodarLimpezaDeTestes({ aplicar: true, apenas: alvo, agora });
      igual(semEmail.ligada, false, "sem e-mail");
      process.env.RESEND_API_KEY = guardado.email;
      delete process.env.ASAAS_API_KEY;
      const semCobranca = await limpeza.rodarLimpezaDeTestes({ aplicar: true, apenas: alvo, agora });
      igual(semCobranca.ligada, false, "sem cobrança");
      igual(semEmail.avisos + semCobranca.avisos, 0, "nada feito");
    } finally {
      process.env.RESEND_API_KEY = guardado.email;
      if (guardado.asaas === undefined) delete process.env.ASAAS_API_KEY;
      else process.env.ASAAS_API_KEY = guardado.asaas;
    }
  });

  await etapa("simulação não envia nem grava", async () => {
    const antes = recebidos.length;
    const r = await limpeza.rodarLimpezaDeTestes({ aplicar: false, forcarLigada: true, apenas: alvo, agora });
    igual(r.avisos, 2, "os dois testes sem assinatura apareceriam");
    igual(recebidos.length, antes, "e-mails");
    const { rows } = await db.query("select aviso_limpeza_em from tenants where id = $1", [abandonada.id]);
    igual(rows[0].aviso_limpeza_em, null, "nada gravado");
  });

  await etapa("1º aviso: sai só para o teste abandonado, e fica registrado", async () => {
    const antes = recebidos.length;
    const r = await rodar(agora);
    igual(r.avisos, 1, "avisos");
    igual(r.falhasDeEnvio, 1, "o e-mail que o servidor recusou");
    const novos = recebidos.slice(antes);
    igual(novos.length, 1, "e-mails enviados");
    igual(novos[0].to[0], abandonada.email, "destinatário");
    if (!/serão apagados em/.test(novos[0].subject)) throw new Error(`assunto: ${novos[0].subject}`);
    const { rows } = await db.query(
      "select id, aviso_limpeza_em from tenants where id = any($1)",
      [[abandonada.id, semCorreio.id]],
    );
    const por = Object.fromEntries(rows.map((x) => [x.id, x.aviso_limpeza_em]));
    if (!por[abandonada.id]) throw new Error("o aviso enviado não foi gravado");
    igual(por[semCorreio.id], null, "aviso que não saiu não conta");
    const { rows: ev } = await db.query(
      "select detalhe from eventos where tenant_id = $1 and acao = $2",
      [abandonada.id, ACOES.AVISO_LIMPEZA_ENVIADO],
    );
    igual(ev.length, 1, "evento de auditoria do aviso");
  });

  await etapa("rodar de novo no mesmo dia não repete o aviso", async () => {
    const antes = recebidos.length;
    await rodar(agora);
    igual(recebidos.filter((e, i) => i >= antes && e.to[0] === abandonada.email).length, 0, "repetidos");
  });

  await etapa("aviso final 7 dias antes, e nada apagado até a data", async () => {
    igual((await rodar(new Date(agora.getTime() + 22 * DIA))).avisosFinais, 0, "dia 22");
    const antes = recebidos.length;
    igual((await rodar(new Date(agora.getTime() + 23 * DIA))).avisosFinais, 1, "dia 23");
    if (!/Último aviso/.test(recebidos[antes].subject)) throw new Error("o assunto não diz que é o último");
    igual((await rodar(new Date(agora.getTime() + 29 * DIA))).apagadas, 0, "dia 29");
    for (const c of objetos) if (!(await objetoExiste(c))) throw new Error(`${c} sumiu antes da data`);
  });

  await etapa("no dia prometido, os arquivos saem — e a conta fica", async () => {
    const r = await rodar(new Date(agora.getTime() + 30 * DIA));
    igual(r.apagadas, 1, "contas limpas");
    const { rows: g } = await db.query("select 1 from galerias where tenant_id = $1", [abandonada.id]);
    igual(g.length, 0, "galerias");
    for (const c of objetos) if (await objetoExiste(c)) throw new Error(`${c} continua no armazém`);
    const { rows: t } = await db.query("select arquivos_limpos_em from tenants where id = $1", [abandonada.id]);
    igual(t.length, 1, "a conta continua existindo");
    if (!t[0].arquivos_limpos_em) throw new Error("arquivos_limpos_em não foi gravado");
    const { rows: ev } = await db.query(
      "select acao, detalhe from eventos where tenant_id = $1 and acao in ($2, $3)",
      [abandonada.id, ACOES.GALERIA_DESTRUIDA, ACOES.ARQUIVOS_DO_TESTE_APAGADOS],
    );
    igual(ev.length, 2, "evento da galeria e da conta");
    igual(ev.find((e) => e.acao === ACOES.GALERIA_DESTRUIDA).detalhe.motivo, "teste_abandonado", "motivo");
  });

  await etapa("quem assinou e quem paga não foram tocados", async () => {
    const { rows } = await db.query(
      "select count(*)::int as n from galerias where tenant_id = any($1)",
      [[assinou.id, pagante.id, semCorreio.id]],
    );
    igual(rows[0].n, 3, "galerias intactas");
  });

  await etapa(`mais de ${limpeza.TETO_POR_RODADA} contas numa madrugada: para e chama uma pessoa`, async () => {
    const muitas = [];
    for (let i = 0; i <= limpeza.TETO_POR_RODADA; i++) {
      const t = await contaDeTeste({
        trialAte: new Date(agora.getTime() - 61 * DIA),
        aviso: new Date(agora.getTime() - 31 * DIA),
        avisoFinal: new Date(agora.getTime() - 8 * DIA),
      });
      await db.query(
        "insert into galerias (tenant_id, slug, titulo, publicada, estado) values ($1, $2, 'x', true, 'online')",
        [t.id, `galeria-${MARCA}-teto-${i}`],
      );
      muitas.push(t.id);
    }
    const antes = recebidos.length;
    const r = await limpeza.rodarLimpezaDeTestes({ aplicar: true, forcarLigada: true, apenas: muitas, agora });
    igual(r.apagadas, 0, "nada apagado");
    igual(r.travadasPeloTeto, muitas.length, "travadas");
    const alerta = recebidos.slice(antes).find((e) => e.to[0] === "alerta@teste.local");
    if (!alerta) throw new Error("ninguém foi chamado");
    const { rows } = await db.query("select count(*)::int as n from galerias where tenant_id = any($1)", [muitas]);
    igual(rows[0].n, muitas.length, "galerias intactas");

    const liberada = await limpeza.rodarLimpezaDeTestes({ aplicar: true, forcarLigada: true, apenas: muitas, agora, liberarTeto: true });
    igual(liberada.apagadas, muitas.length, "com a liberação de uma pessoa, todas");
  });

  await etapa("o recado do trial vencido diz o prazo dos arquivos", async () => {
    const { situacaoDoTenant } = await import("../src/lib/assinatura.ts");
    const s = situacaoDoTenant({ status: "trial", trial_ate: new Date(Date.now() - DIA) }, true);
    if (!/60 dias/.test(s.recado) || !/aviso/.test(s.recado)) throw new Error(s.recado);
  });
} finally {
  if (criados.length) await db.query("delete from tenants where id = any($1)", [criados]);
  const l = await limparRodada(db);
  await db.end();
  await globalThis._pgPool?.end();
  correio.close();
  console.log(`\nlimpeza: ${criados.length + l.estudios} estúdio(s) de teste removido(s)`);
}

if (falhou) {
  console.log("\n✗ falhou");
  process.exit(1);
}
console.log("\n✓ as quatro travas do cadastro");
