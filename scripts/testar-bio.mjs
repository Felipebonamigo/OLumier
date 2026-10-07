#!/usr/bin/env node
/**
 * O LINK DA BIO: A PÁGINA-PONTE, A MEDIÇÃO E A ORIGEM DA CONTA. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-bio.mjs
 *
 * ── DE ONDE VEIO (07/10/2026) ─────────────────────────────────────────────
 *
 * Juan: o perfil do Instagram passa a falar de dois produtos, Atomatiza e
 * Galeria Átomo, e o link da bio precisa ser uma página que deixa a pessoa
 * escolher — medindo o que chegou, para onde foi e de onde veio quem criou
 * conta. Ver `docs/bio.md`, `config/bio.ts` e a migração 063.
 *
 * ── O QUE ESTE TESTE PRENDE ───────────────────────────────────────────────
 *
 * 1. AS REGRAS: o que é um rótulo de origem, de onde veio a visita, o cookie
 *    (e o cookie forjado), o que é robô, o que é só o navegador adiantando.
 * 2. A PÁGINA: os produtos na ordem da configuração, TODO botão passando pelo
 *    redirecionador (um link direto para fora driblaria a contagem), `noindex`,
 *    fora do sitemap, redirecionadores fechados no robots.
 * 3. A CONTAGEM: clique conta e redireciona; robô, `HEAD` e adiantamento
 *    redirecionam sem contar; o destino nunca vem do pedido (redirecionador
 *    aberto); a visita só aceita o evento certo, de dentro do site.
 * 4. A ORIGEM: o cookie nasce só nos botões de produto, o cadastro o lê e a
 *    conta guarda de onde veio — e o cadastro nunca confia no cookie.
 * 5. A LEITURA: o admin soma o que foi gravado, e não existe para quem não é admin.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import {
  CAMPANHA_PADRAO,
  NOME_DO_COOKIE_DA_BIO,
  ehAdiantamento,
  ehRobo,
  fonteDoEndereco,
  lerCookieDaBio,
  montarCookieDaBio,
  origemDaConsulta,
  origemDaVisita,
  origemDoCadastro,
  consultaDaOrigem,
  rotulo,
  urlComOrigem,
} from "../src/lib/bio-regras.ts";
import { ALVOS_DA_BIO, EVENTOS_DA_BIO, PRODUTOS_DA_BIO, alvoDaBio, destaqueVigente } from "../src/config/bio.ts";
import { criarTenant } from "../src/lib/tenants.ts";
import { PLANO_INICIAL } from "../src/config/planos.ts";
import { resumoDaBio, quemPede } from "../src/lib/bio.ts";

await exigirBancoDeTeste();

const RAIZ = path.resolve(import.meta.dirname, "..");
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
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
  }
};

/* Gente de verdade, com IP próprio por execução: o hash do dia e o limite por visitante
   não podem misturar esta execução com outra no mesmo servidor. */
const IP = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
const CELULAR =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0";
const comoGente = (extra = {}) => ({ "user-agent": CELULAR, "x-forwarded-for": IP, ...extra });
const contar = async (evento) =>
  (await db.query("select count(*)::int n from bio_eventos where evento = $1", [evento])).rows[0].n;

await db.query("delete from bio_eventos");

try {
  console.log("\nAs regras\n");

  await etapa("rótulo: minúsculas, números, ponto, hífen e sublinhado — o resto é descartado", () => {
    igual(rotulo("Instagram"), "instagram", "maiúscula");
    igual(rotulo("  lançamento  galeria "), null, "acento");
    igual(rotulo("a b"), "a-b", "espaço vira hífen");
    igual(rotulo("<script>"), null, "marcação");
    igual(rotulo("x".repeat(41)), null, "longo demais");
    igual(rotulo("x".repeat(40)), "x".repeat(40), "no limite");
    igual(rotulo(["instagram"]), null, "não é texto");
    igual(rotulo(""), null, "vazio");
  });

  await etapa("o endereço de origem: o Instagram abre o link por l.instagram.com, e golpe parecido não vale", () => {
    igual(fonteDoEndereco("l.instagram.com"), "instagram", "l.instagram.com");
    igual(fonteDoEndereco("instagram.com"), "instagram", "instagram.com");
    igual(fonteDoEndereco("instagram.com.golpe.net"), null, "sufixo falso");
    igual(fonteDoEndereco("notinstagram.com"), null, "outro domínio que termina igual");
    igual(fonteDoEndereco("www.google.com.br"), "google", "google");
    igual(fonteDoEndereco("wa.me"), "whatsapp", "wa.me");
  });

  await etapa("a origem da visita: o UTM do link manda; sem ele, o endereço de onde veio; senão, direto", () => {
    igual(
      origemDaVisita({ utm_source: "Instagram", utm_medium: "bio", utm_campaign: "lancamento", referrer: "https://google.com/" }),
      { fonte: "instagram", meio: "bio", campanha: "lancamento" },
      "UTM vence o endereço",
    );
    igual(
      origemDaVisita({ referrer: "https://l.instagram.com/?u=abc" }),
      { fonte: "instagram", meio: "referral", campanha: null },
      "só o endereço",
    );
    igual(origemDaVisita({}), { fonte: "direto", meio: "nenhum", campanha: null }, "nada");
    igual(
      origemDaVisita({ referrer: "https://blog.exemplo.com/post" }),
      { fonte: "outro", meio: "referral", campanha: null },
      "site qualquer",
    );
    igual(
      origemDaVisita({ referrer: "https://galeriaatomo.com.br/bio" }).fonte,
      "direto",
      "nosso próprio endereço não é origem",
    );
    igual(origemDaVisita({ utm_source: "<b>x</b>" }).fonte, "direto", "UTM sujo é descartado");
  });

  await etapa("o cookie vai e volta, e o forjado é recusado", () => {
    const o = { fonte: "instagram", meio: "bio", campanha: "lancamento", produto: "galeria" };
    igual(lerCookieDaBio(montarCookieDaBio(o)), o, "ida e volta");
    igual(lerCookieDaBio(montarCookieDaBio({ ...o, campanha: null })).campanha, null, "sem campanha");
    for (const ruim of [null, "", "a~b~c", "a~b~c~d~e", "~bio~x~galeria", "instagram~bio~~", "<x>~bio~~galeria", "a~b~Ç~d"]) {
      igual(lerCookieDaBio(ruim), null, `recusa ${JSON.stringify(ruim)}`);
    }
    igual(origemDoCadastro(o), { origem: "instagram/bio/galeria", campanha: "lancamento" }, "o que o cadastro grava");
  });

  await etapa("robô é robô — e o navegador de dentro do Instagram é gente", () => {
    for (const r of ["WhatsApp/2.23.20.0 A", "facebookexternalhit/1.1", "Slackbot-LinkExpanding 1.0", "curl/8.0", "Googlebot/2.1", "", null]) {
      igual(ehRobo(r), true, `robô ${JSON.stringify(r)}`);
    }
    igual(ehRobo(CELULAR), false, "Instagram no iPhone");
    igual(ehRobo("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"), false, "Chrome Android");
  });

  await etapa("adiantar a página não é clicar", () => {
    igual(ehAdiantamento(new Headers({ "sec-purpose": "prefetch" })), true, "Sec-Purpose");
    igual(ehAdiantamento(new Headers({ "sec-purpose": "prefetch;anonymous-client-ip" })), true, "Chrome");
    igual(ehAdiantamento(new Headers({ purpose: "prefetch" })), true, "Purpose");
    igual(ehAdiantamento(new Headers({ "x-moz": "prefetch" })), true, "Firefox");
    igual(ehAdiantamento(new Headers({ "next-router-prefetch": "1" })), true, "Next");
    igual(ehAdiantamento(new Headers({ accept: "text/html" })), false, "navegação comum");
  });

  await etapa("a origem sai na URL do produto de OUTRO domínio, no vocabulário do UTM", () => {
    const u = new URL(urlComOrigem("https://atomatiza.com.br/", { fonte: "instagram", meio: "bio", campanha: null }));
    igual(
      Object.fromEntries(u.searchParams),
      { utm_source: "instagram", utm_medium: "bio", utm_campaign: CAMPANHA_PADRAO, utm_content: "ponte" },
      "UTM",
    );
    igual(u.origin + u.pathname, "https://atomatiza.com.br/", "o endereço não muda");
  });

  await etapa("a origem viaja pelos links da página e volta limpa", () => {
    const o = { fonte: "instagram", meio: "bio", campanha: "teste-1" };
    igual(origemDaConsulta(new URLSearchParams(consultaDaOrigem(o))), o, "ida e volta");
    igual(origemDaConsulta(new URLSearchParams("fonte=%3Cx%3E&meio=bio")).fonte, "direto", "sujeira vira direto");
    igual(origemDaConsulta(new URLSearchParams("")), { fonte: "direto", meio: "nenhum", campanha: null }, "sem nada");
  });

  console.log("\nA configuração dos produtos\n");

  await etapa("a Galeria vem primeiro e leva o selo de lançamento; a Atomatiza vem depois", () => {
    igual(PRODUTOS_DA_BIO.map((p) => p.id), ["galeria", "atomatiza"], "ordem");
    igual(destaqueVigente(PRODUTOS_DA_BIO[0], "2026-10-07"), "Lançamento", "selo hoje");
    igual(destaqueVigente(PRODUTOS_DA_BIO[0], "2027-01-01"), null, "o selo some sozinho depois da data");
    igual(destaqueVigente(PRODUTOS_DA_BIO[1], "2026-10-07"), null, "a Atomatiza não tem selo");
  });

  await etapa("cada produto tem um clique e um 'entrar', com nomes de evento distintos", () => {
    igual(ALVOS_DA_BIO.map((a) => a.caminho), ["galeria", "entrar-galeria", "atomatiza", "entrar-atomatiza"], "caminhos");
    igual(new Set(EVENTOS_DA_BIO).size, EVENTOS_DA_BIO.length, "eventos repetidos");
    igual(
      EVENTOS_DA_BIO,
      ["click_galeria_atomo", "click_login_galeria", "click_atomatiza", "click_login_atomatiza"],
      "os nomes do pedido",
    );
    igual(alvoDaBio("golpe"), null, "caminho que não existe");
    const atomatiza = PRODUTOS_DA_BIO.find((p) => p.id === "atomatiza");
    if (!atomatiza.origemNaUrl) throw new Error("a Atomatiza mora em outro domínio: a origem tem de ir na URL");
    if (PRODUTOS_DA_BIO[0].origemNaUrl) throw new Error("a Galeria é do nosso site: URL limpa, origem no cookie");
  });

  await etapa("o login leva a URL limpa e não grava cookie: quem já é cliente não está sendo conquistado", () => {
    for (const a of ALVOS_DA_BIO.filter((x) => x.tipo === "entrar")) {
      igual(a.origemNaUrl, false, a.caminho);
    }
  });

  let servidor = false;
  try {
    servidor = (await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    servidor = false;
  }

  if (!servidor) {
    console.log("\n⚠ servidor fora do ar — a parte da página e das rotas foi pulada");
  } else {
    const pegar = (caminho, opcoes = {}) => fetch(`${BASE}${caminho}`, { redirect: "manual", ...opcoes });
    const esperarGravar = () => new Promise((r) => setTimeout(r, 400));

    console.log("\nA página\n");

    const pagina = await (await pegar("/bio?utm_source=instagram&utm_medium=bio&utm_campaign=teste-bio", { headers: comoGente() })).text();

    await etapa("pergunta o que a pessoa procura e mostra os dois produtos na ordem da configuração", () => {
      if (!pagina.includes("O que você procura?")) throw new Error("sem a pergunta");
      const posicoes = PRODUTOS_DA_BIO.map((p) => pagina.indexOf(`>${p.nome}</h2>`));
      if (posicoes.some((i) => i < 0)) throw new Error(`faltou um produto: ${posicoes}`);
      if (posicoes[0] > posicoes[1]) throw new Error("a ordem da página não é a da configuração");
      if (!pagina.includes("Lançamento")) throw new Error("sem o selo de lançamento");
      if (!pagina.includes("Já sou cliente")) throw new Error("sem o 'já sou cliente'");
    });

    await etapa("TODO botão passa pelo redirecionador — nenhum aponta direto para fora", () => {
      /* Só os `<a>`: o `<link rel="canonical">` do <head> é um endereço, não um botão. */
      const hrefs = [...pagina.matchAll(/<a\b[^>]*?\shref="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
      const doSite = hrefs.filter((h) => h.startsWith("/bio/ir/"));
      igual(doSite.length, ALVOS_DA_BIO.length, "quatro caminhos da ponte");
      const fora = hrefs.filter((h) => /^https?:\/\//.test(h) && !h.includes("fonts.g"));
      if (fora.length) throw new Error(`link direto para fora: ${fora.join(", ")} — o clique não seria contado`);
      if (!doSite.every((h) => h.includes("fonte=instagram") && h.includes("campanha=teste-bio"))) {
        throw new Error("a origem não vai nos links");
      }
    });

    await etapa("o botão é <a> comum, e não <Link>: o Link pré-carregaria o redirecionador", () => {
      const fonte = readFileSync(path.join(RAIZ, "src/app/bio/page.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/from "next\/link"|<Link\b/.test(fonte)) throw new Error("a página usa <Link>");
    });

    await etapa("não vai para o Google: noindex, canônico em /bio, fora do sitemap", async () => {
      if (!/name="robots" content="noindex/.test(pagina)) throw new Error("sem noindex");
      if (!pagina.includes(`href="https://`) || !/rel="canonical" href="[^"]*\/bio"/.test(pagina)) {
        throw new Error("sem o canônico em /bio");
      }
      const mapa = await (await pegar("/sitemap.xml")).text();
      if (mapa.includes("/bio")) throw new Error("está no sitemap");
    });

    await etapa("o robots.txt fecha os redirecionadores, e deixa a /bio aberta", async () => {
      const r = await (await pegar("/robots.txt")).text();
      if (!/Disallow: \/bio\/ir/.test(r)) throw new Error("os redirecionadores estão abertos para robô");
      if (/Disallow: \/bio\s/.test(r) || /Disallow: \/bio$/m.test(r)) throw new Error("a /bio inteira está fechada: o noindex não seria lido");
    });

    await etapa("sem JavaScript pesado: a página só carrega o aviso de visita", () => {
      const fonte = readFileSync(path.join(RAIZ, "src/app/bio/medir.tsx"), "utf8");
      if (!/"use client"/.test(fonte)) throw new Error("o aviso de visita deveria ser o ilhote de cliente");
      const pag = readFileSync(path.join(RAIZ, "src/app/bio/page.tsx"), "utf8");
      if (/"use client"/.test(pag)) throw new Error("a página inteira virou cliente");
    });

    console.log("\nA contagem dos cliques\n");

    await etapa("clique no produto: redireciona, grava o evento e deixa o cookie de origem", async () => {
      const r = await pegar("/bio/ir/galeria?fonte=instagram&meio=bio&campanha=teste-bio", { headers: comoGente() });
      igual(r.status, 302, "status");
      igual(new URL(r.headers.get("location")).pathname, "/", "para a home, com a URL limpa");
      if (new URL(r.headers.get("location")).search) throw new Error("a URL do nosso site não deveria levar UTM");
      igual(r.headers.get("cache-control"), "no-store", "cache");
      const cookie = r.headers.get("set-cookie") ?? "";
      if (!cookie.includes(`${NOME_DO_COOKIE_DA_BIO}=instagram~bio~teste-bio~galeria`)) throw new Error(`cookie: ${cookie}`);
      if (!/HttpOnly/i.test(cookie)) throw new Error("o cookie de origem não é HttpOnly");
      if (!/Max-Age=2592000/.test(cookie)) throw new Error("não vale 30 dias");
      await esperarGravar();
      igual(await contar("click_galeria_atomo"), 1, "uma linha");
    });

    await etapa("produto de outro domínio: a origem vai na URL (UTM), e o cookie também fica", async () => {
      const r = await pegar("/bio/ir/atomatiza?fonte=instagram&meio=bio&campanha=teste-bio", { headers: comoGente({ "x-forwarded-for": `${IP.slice(0, -1)}1` }) });
      igual(r.status, 302, "status");
      const para = new URL(r.headers.get("location"));
      igual(
        [para.host, para.searchParams.get("utm_source"), para.searchParams.get("utm_medium"), para.searchParams.get("utm_campaign"), para.searchParams.get("utm_content")],
        ["atomatiza.com.br", "instagram", "bio", "teste-bio", "ponte"],
        "destino",
      );
      if (!(r.headers.get("set-cookie") ?? "").includes("~atomatiza")) throw new Error("sem o cookie do produto clicado");
      await esperarGravar();
      igual(await contar("click_atomatiza"), 1, "uma linha");
    });

    await etapa("'entrar': redireciona para o login do produto, conta, e NÃO grava cookie", async () => {
      const r = await pegar("/bio/ir/entrar-galeria?fonte=instagram&meio=bio", { headers: comoGente({ "x-forwarded-for": `${IP.slice(0, -1)}2` }) });
      igual(r.status, 302, "status");
      igual(new URL(r.headers.get("location")).pathname, "/entrar", "login da Galeria");
      if (r.headers.get("set-cookie")) throw new Error("cliente que já tem conta não recebe cookie de origem");
      const a = await pegar("/bio/ir/entrar-atomatiza", { headers: comoGente({ "x-forwarded-for": `${IP.slice(0, -1)}3` }) });
      igual(new URL(a.headers.get("location")).pathname, "/login", "login da Atomatiza");
      if (new URL(a.headers.get("location")).search) throw new Error("login não leva UTM");
      await esperarGravar();
      igual([await contar("click_login_galeria"), await contar("click_login_atomatiza")], [1, 1], "linhas");
    });

    await etapa("duplo toque conta uma vez só", async () => {
      const h = comoGente({ "x-forwarded-for": `${IP.slice(0, -1)}4` });
      await pegar("/bio/ir/atomatiza", { headers: h });
      await pegar("/bio/ir/atomatiza", { headers: h });
      await esperarGravar();
      igual(await contar("click_atomatiza"), 2, "1 do teste anterior + 1 deste, e não 3");
    });

    await etapa("robô, HEAD e adiantamento recebem o redirecionamento, mas não viram número", async () => {
      const antes = (await db.query("select count(*)::int n from bio_eventos")).rows[0].n;
      const robo = await pegar("/bio/ir/galeria", { headers: { "user-agent": "WhatsApp/2.23.20.0 A", "x-forwarded-for": "198.51.100.5" } });
      const head = await pegar("/bio/ir/galeria", { method: "HEAD", headers: comoGente({ "x-forwarded-for": "198.51.100.6" }) });
      const adiantado = await pegar("/bio/ir/galeria", { headers: comoGente({ "x-forwarded-for": "198.51.100.7", "sec-purpose": "prefetch" }) });
      igual([robo.status, head.status, adiantado.status], [302, 302, 302], "todos redirecionam");
      if (robo.headers.get("set-cookie") || adiantado.headers.get("set-cookie")) throw new Error("não-gente ganhou cookie");
      await esperarGravar();
      igual((await db.query("select count(*)::int n from bio_eventos")).rows[0].n, antes, "nada gravado");
    });

    await etapa("o destino nunca vem do pedido: nem caminho inventado, nem ?para=", async () => {
      for (const c of ["/bio/ir/golpe?para=https://evil.example", "/bio/ir/..%2F..%2Fpainel", "/bio/ir/galeria?url=https://evil.example"]) {
        const r = await pegar(c, { headers: comoGente({ "x-forwarded-for": "198.51.100.8" }) });
        const para = r.headers.get("location") ?? "";
        if (para.includes("evil.example")) throw new Error(`${c} → ${para}`);
        if (!["/bio", "/"].includes(new URL(para).pathname) && !para.includes("atomatiza.com.br")) throw new Error(`${c} → ${para}`);
      }
    });

    console.log("\nA visita\n");

    const visita = (corpo, cab = comoGente()) =>
      pegar("/api/bio/evento", { method: "POST", headers: { "content-type": "application/json", ...cab }, body: JSON.stringify(corpo) });

    await etapa("a visita grava page_view com a origem", async () => {
      const r = await visita({ evento: "page_view", fonte: "instagram", meio: "bio", campanha: "teste-bio" });
      igual(r.status, 204, "status");
      await esperarGravar();
      const l = (await db.query("select fonte, meio, campanha, visitante from bio_eventos where evento = 'page_view'")).rows;
      igual(l.length, 1, "uma linha");
      igual([l[0].fonte, l[0].meio, l[0].campanha], ["instagram", "bio", "teste-bio"], "origem");
      if (!l[0].visitante || l[0].visitante.includes(IP)) throw new Error("o visitante não é um hash");
    });

    await etapa("só o evento page_view, e só JSON — o resto é 400", async () => {
      igual((await visita({ evento: "click_atomatiza" })).status, 400, "evento de clique pela rota de visita");
      igual((await visita({ evento: "qualquer-coisa" })).status, 400, "evento inventado");
      const torto = await pegar("/api/bio/evento", { method: "POST", headers: comoGente({ "content-type": "application/json" }), body: "{nao é json" });
      igual(torto.status, 400, "corpo torto");
    });

    await etapa("robô e pedido de outro site respondem 204 e não gravam", async () => {
      const antes = await contar("page_view");
      const robo = await visita({ evento: "page_view" }, { "user-agent": "Googlebot/2.1", "x-forwarded-for": "198.51.100.9" });
      const fora = await visita({ evento: "page_view" }, comoGente({ "x-forwarded-for": "198.51.100.10", "sec-fetch-site": "cross-site" }));
      igual([robo.status, fora.status], [204, 204], "respostas");
      await esperarGravar();
      igual(await contar("page_view"), antes, "nada gravado");
    });

    await etapa("sujeira no corpo vira 'direto' em vez de entrar na tabela", async () => {
      await visita({ evento: "page_view", fonte: "<script>alert(1)</script>", meio: "x".repeat(200), campanha: "ok-1" }, comoGente({ "x-forwarded-for": "198.51.100.11" }));
      await esperarGravar();
      const l = (await db.query("select fonte, meio, campanha from bio_eventos where campanha = 'ok-1'")).rows[0];
      igual([l.fonte, l.meio], ["direto", "nenhum"], "limpo");
    });

    await etapa("quem insiste é freado: um script não infla o número", async () => {
      const h = comoGente({ "x-forwarded-for": "198.51.100.12" });
      for (let i = 0; i < 40; i++) await visita({ evento: "page_view", campanha: "insistente" }, h);
      await esperarGravar();
      const n = (await db.query("select count(*)::int n from bio_eventos where campanha = 'insistente'")).rows[0].n;
      if (n > 30) throw new Error(`gravou ${n} de 40`);
      return `${n} de 40`;
    });
  }

  console.log("\nA origem da conta\n");

  await etapa("a conta guarda de onde veio, e a que não passou pela ponte fica sem origem", async () => {
    const marca = `bio${Date.now()}`;
    const comOrigem = await criarTenant({
      nomeEstudio: `Ponte ${marca}`, email: `${marca}-a@teste.local`, senha: "x".repeat(12), planoId: PLANO_INICIAL,
      origem: "instagram/bio/galeria", origemCampanha: "teste-bio",
    });
    const semOrigem = await criarTenant({
      nomeEstudio: `Direta ${marca}`, email: `${marca}-b@teste.local`, senha: "x".repeat(12), planoId: PLANO_INICIAL,
    });
    try {
      igual([comOrigem.origem, comOrigem.origem_campanha], ["instagram/bio/galeria", "teste-bio"], "com origem");
      igual([semOrigem.origem, semOrigem.origem_campanha], [null, null], "sem origem");
    } finally {
      await db.query("delete from tenants where id = any($1)", [[comOrigem.id, semOrigem.id]]);
    }
  });

  await etapa("o cadastro lê o cookie pela função que o confere, e o apaga depois de usar", () => {
    const fonte = readFileSync(path.join(RAIZ, "src/app/(auth)/actions.ts"), "utf8");
    const bloco = fonte.slice(fonte.indexOf("export async function cadastrarAction"), fonte.indexOf("RECADO_DOCUMENTO_EM_USO ="));
    if (!/lerCookieDaBio\(/.test(bloco)) throw new Error("o cadastro não confere o cookie com `lerCookieDaBio`");
    if (/jar\.get\(NOME_DO_COOKIE_DA_BIO\)\?\.value\s*[,)]\s*[^;]*criarTenant/.test(bloco)) throw new Error("grava o cookie cru");
    if (!/origem: origem\?\.origem/.test(bloco)) throw new Error("não passa a origem a `criarTenant`");
    if (!/jar\.delete\(NOME_DO_COOKIE_DA_BIO\)/.test(bloco)) throw new Error("o cookie fica depois de usado");
  });

  console.log("\nA leitura do admin\n");

  const estudio = await estudioDaRodada(db);
  const cookie = cookieDeSessao(estudio.id);
  await db.query("delete from bio_eventos");
  await db.query(
    `insert into bio_eventos (evento, fonte, meio, campanha, visitante) values
       ('page_view','instagram','bio','a','v1'), ('page_view','instagram','bio','a','v2'),
       ('page_view','instagram','bio','a','v2'), ('page_view','direto','nenhum',null,'v3'),
       ('click_galeria_atomo','instagram','bio','a','v1'), ('click_galeria_atomo','instagram','bio','a','v2'),
       ('click_atomatiza','instagram','bio','a','v3'), ('click_login_galeria','instagram','bio','a','v4'),
       ('click_login_atomatiza','instagram','bio','a','v5')`,
  );
  await db.query("update tenants set origem = 'instagram/bio/galeria', origem_campanha = 'a' where id = $1", [estudio.id]);

  await etapa("o resumo soma visitas, pessoas, cliques por produto e 'entrar'", async () => {
    const r = await resumoDaBio(30);
    igual([r.visitas, r.pessoas], [4, 3], "visitas e pessoas (v2 duas vezes conta uma)");
    igual(Object.entries(r.cliques).sort(), [["click_atomatiza", 1], ["click_galeria_atomo", 2]], "cliques por produto");
    igual(r.entrar, 2, "entrar");
    igual(r.dias.length, 1, "um dia");
    igual([r.dias[0].visitas, r.dias[0].entrar], [4, 2], "o dia");
    const a = r.origens.find((o) => o.fonte === "instagram" && o.campanha === "a");
    igual([a.visitas, a.cliques], [3, 3], "origem instagram/a");
    igual(r.origens.find((o) => o.fonte === "direto").campanha, "—", "sem campanha");
    const conta = r.contas.find((c) => c.origem === "instagram/bio/galeria");
    if (!conta || conta.contas < 1) throw new Error("a conta com origem não apareceu");
  });

  await etapa("fora do período, não entra", async () => {
    await db.query("update bio_eventos set criado_em = now() - interval '40 days' where evento = 'click_atomatiza'");
    const r = await resumoDaBio(30);
    igual(r.cliques.click_atomatiza ?? 0, 0, "os 40 dias ficam de fora de 30");
    igual((await resumoDaBio(0)).cliques.click_atomatiza, 1, "'desde o começo' traz de volta");
  });

  if (servidor) {
    await etapa("a tela do admin não existe para estúdio comum, nem sem sessão", async () => {
      const comum = await fetch(`${BASE}/painel/admin/bio`, { headers: { cookie }, redirect: "manual" });
      igual(comum.status, 404, "estúdio comum");
      if (/Link da bio/.test(await comum.text())) throw new Error("vazou o título da tela");
      const sem = await fetch(`${BASE}/painel/admin/bio`, { redirect: "manual" });
      if (sem.status === 200) throw new Error("respondeu 200 sem sessão");
    });
  }

  await etapa("quemPede separa gente de robô, e sem IP ainda é gente", () => {
    igual(quemPede("198.51.100.1", "Googlebot/2.1"), { gente: false, visitante: null }, "robô");
    const g = quemPede("198.51.100.1", CELULAR);
    igual(g.gente, true, "gente");
    if (!/^[0-9a-f]{24}$/.test(g.visitante)) throw new Error(`visitante: ${g.visitante}`);
    igual(quemPede(null, CELULAR), { gente: true, visitante: null }, "sem IP");
    if (quemPede("198.51.100.2", CELULAR).visitante === g.visitante) throw new Error("IPs diferentes deram o mesmo hash");
  });
} finally {
  await db.query("delete from bio_eventos");
  await limparRodada(db);
  await db.end();
  await globalThis._pgPool?.end();
}

console.log(falhou ? "\n✗ o link da bio tem problema\n" : "\n✓ o link da bio funciona\n");
process.exit(falhou ? 1 : 0);
