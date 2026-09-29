#!/usr/bin/env node
/**
 * O que um mecanismo de busca (e o WhatsApp) encontra no site.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-seo.mjs
 *
 * Nasceu da auditoria de 27/08/2026 (skill seo-audit), que achou quatro furos
 * num site tecnicamente rápido: sem sitemap, sem robots, sem Open Graph e sem
 * dados estruturados. Nenhum teste acusava, porque nenhum teste perguntava.
 *
 * O furo que mais dói no nosso mercado é o terceiro: fotógrafo compartilha
 * link por WHATSAPP, e link sem Open Graph aparece pelado — sem imagem, sem
 * título formatado. A página de venda perde exatamente onde ela circula.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3040";
import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { marca } from "../src/config/marca.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    falhou = true;
    console.error(`  ✗ ${nome} — ${e.message}`);
  }
};

const pegar = async (caminho) => {
  const r = await fetch(BASE + caminho, { headers: { connection: "close" } });
  return { status: r.status, corpo: await r.text() };
};

/*
 * O mesmo pedido, mas CHEGANDO POR UM ENDEREÇO: `www`, subdomínio de estúdio,
 * domínio antigo. `http.request` e não `fetch` porque o `fetch` do Node trata
 * `Host` como cabeçalho proibido e o descarta em silêncio — o servidor
 * receberia "localhost" e a etapa mediria o site errado (a mesma armadilha
 * registrada em `testar-subdominio.mjs`). Não segue redirecionamento, de
 * propósito: o 308 é parte do que se mede.
 */
const pegarComo = (caminho, host) =>
  new Promise((resolve, reject) => {
    const url = new URL(BASE + caminho);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { Host: host } },
      (res) => {
        const partes = [];
        res.on("data", (c) => partes.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            tipo: res.headers["content-type"] ?? "",
            destino: res.headers.location ?? null,
            corpo: Buffer.concat(partes).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });

/** O conteúdo de uma `<meta>` ou o `href` de um `<link>`, como o robô lê. */
const meta = (html, nome) =>
  html.match(new RegExp(`<meta (?:property|name)="${nome}" content="([^"]*)"`))?.[1] ?? null;
const canonico = (html) => html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null;
const titulo = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null;
/* O Next escreve a raiz sem a barra final; as duas formas são o mesmo endereço. */
const semBarra = (u) => (u ?? "").replace(/\/$/, "");

console.log("SEO: o que o robô encontra\n");

await etapa("robots.txt existe e aponta o sitemap", async () => {
  const r = await pegar("/robots.txt");
  if (r.status !== 200) throw new Error(`HTTP ${r.status} — robô nenhum sabe o que pode`);
  if (!/sitemap:/i.test(r.corpo)) throw new Error("sem a linha Sitemap: — o robô não descobre o mapa");
  return "com Sitemap:";
});

await etapa("robots.txt fecha o painel e a API", async () => {
  /* Página de ferramenta logada não tem o que fazer no índice do Google. */
  const r = await pegar("/robots.txt");
  if (!r.corpo.includes("/painel")) throw new Error("o /painel ficou aberto para indexação");
  if (!r.corpo.includes("/api")) throw new Error("a /api ficou aberta para indexação");
});

await etapa("sitemap.xml lista as páginas públicas no domínio canônico", async () => {
  const r = await pegar("/sitemap.xml");
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (!r.corpo.includes("<urlset")) throw new Error("não é um sitemap XML");
  for (const precisa of [`https://${marca.dominio}`, "/seguranca", "/termos", "/privacidade"]) {
    if (!r.corpo.includes(precisa)) throw new Error(`não lista ${precisa}`);
  }
  /* Página de login não é conteúdo: sitemap só carrega o que merece ranquear. */
  if (r.corpo.includes("/entrar")) throw new Error("lista /entrar — sitemap não é menu");
  return `domínio ${marca.dominio}`;
});

await etapa("a home tem Open Graph completo", async () => {
  const r = await pegar("/");
  for (const p of ["og:title", "og:description", "og:image", "og:url"]) {
    if (!r.corpo.includes(`property="${p}"`)) throw new Error(`sem ${p} — link pelado no WhatsApp`);
  }
  if (!r.corpo.includes('name="twitter:card"')) throw new Error("sem twitter:card");
});

await etapa("a imagem do Open Graph é absoluta e responde", async () => {
  /* WhatsApp e afins não resolvem caminho relativo: sem metadataBase a tag até
   * existe e a prévia continua sem imagem — o pior estado, porque parece feito. */
  const r = await pegar("/");
  const m = r.corpo.match(/property="og:image"[^>]*content="([^"]+)"/);
  if (!m) throw new Error("og:image sumiu");
  if (!m[1].startsWith("http")) throw new Error(`og:image relativa: ${m[1]}`);
  const url = new URL(m[1]);
  const img = await fetch(BASE + url.pathname, { headers: { connection: "close" } });
  if (img.status !== 200) throw new Error(`a imagem devolve HTTP ${img.status}`);
  const tipo = img.headers.get("content-type") ?? "";
  if (!tipo.startsWith("image/")) throw new Error(`content-type ${tipo} — não é imagem`);
  return `${url.pathname} (${tipo})`;
});

await etapa("a FAQ da home existe como dado estruturado, e diz a verdade", async () => {
  /*
   * FAQPage em JSON-LD é o que candidata a home a resultado expandido no
   * Google. A regra (skill fixing-metadata) é uma só: JSON-LD descreve o que a
   * página REALMENTE mostra — por isso a etapa confere que cada pergunta do
   * bloco estruturado também está no HTML visível. Schema que promete o que a
   * página não tem é a receita da penalidade manual.
   */
  const r = await pegar("/");
  const m = r.corpo.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("sem bloco ld+json — a FAQ não vira resultado expandido");
  const dados = JSON.parse(m[1]);
  if (dados["@type"] !== "FAQPage") throw new Error(`@type é ${dados["@type"]}, não FAQPage`);
  const perguntas = dados.mainEntity ?? [];
  if (perguntas.length < 4) throw new Error(`só ${perguntas.length} perguntas no bloco`);
  for (const p of perguntas) {
    if (!r.corpo.includes(p.name)) {
      throw new Error(`o bloco estruturado promete "${p.name}" e a página visível não mostra`);
    }
  }
  return `FAQPage com ${perguntas.length} perguntas, todas visíveis na página`;
});

/*
 * ── CADA PÁGINA COM O SEU ENDEREÇO E O SEU CARTÃO (26/09/2026) ───────────
 *
 * A auditoria de 26/09/2026 achou o Open Graph só no layout, com `url: "/"`:
 * `/termos`, `/seguranca` e `/cadastrar` herdavam o título, a descrição e o
 * ENDEREÇO da home, e nenhuma página tinha `<link rel="canonical">`. As etapas
 * de cima passavam — elas só olham a home.
 */
console.log("\ncada página da casa");

const PAGINAS_DA_CASA = ["/", "/seguranca", "/termos", "/privacidade", "/entrar", "/cadastrar"];
const home = (await pegar("/")).corpo;

for (const caminho of PAGINAS_DA_CASA) {
  await etapa(`${caminho} tem canônico, og:url e cartão próprios`, async () => {
    const html = caminho === "/" ? home : (await pegar(caminho)).corpo;
    const esperado = semBarra(`https://${marca.dominio}${caminho}`);
    if (semBarra(canonico(html)) !== esperado) {
      throw new Error(`canônico é ${canonico(html)}, esperava ${esperado}`);
    }
    if (semBarra(meta(html, "og:url")) !== esperado) {
      throw new Error(`og:url é ${meta(html, "og:url")} — o cartão aponta para outra página`);
    }
    /* Página que define `openGraph` próprio perde a imagem herdada: é a
       regressão que o conserto deste bloco mais facilmente causaria. */
    if (!meta(html, "og:image")?.startsWith("https://")) throw new Error("sem og:image absoluta");
    if (caminho !== "/" && meta(html, "og:title") === meta(home, "og:title")) {
      throw new Error("og:title igual ao da home — o cartão desta página é o da home");
    }
  });
}

await etapa("a home tem descrição que cabe inteira no resultado de busca", () => {
  /*
   * A descrição antiga tinha 44 caracteres: o Google, diante de uma descrição
   * curta demais, costuma trocá-la por um trecho qualquer da página. O
   * intervalo é o que ele mostra sem cortar e sem inventar. O TEXTO é do
   * briefing da home (docs/briefing-home.md); aqui só se mede o tamanho.
   */
  const descricao = meta(home, "description") ?? "";
  if (descricao.length < 110 || descricao.length > 160) {
    throw new Error(`descrição com ${descricao.length} caracteres — fora de 110 a 160`);
  }
  return `${descricao.length} caracteres`;
});

await etapa("o www manda para o domínio canônico, e a API fica onde está", async () => {
  const r = await pegarComo("/termos?origem=teste", `www.${marca.dominio}`);
  if (r.status !== 308) throw new Error(`www devolveu HTTP ${r.status}, esperava 308`);
  if (r.destino !== `https://${marca.dominio}/termos?origem=teste`) {
    throw new Error(`redirecionou para ${r.destino} — perdeu o caminho ou a consulta`);
  }
  /* Webhook e porteiro do certificado não seguem redirecionamento. */
  const api = await pegarComo("/api/healthz", `www.${marca.dominio}`);
  if (api.status >= 300 && api.status < 400) throw new Error("a /api do www também redirecionou");
  return "308 com caminho e consulta";
});

await etapa("toda <img> da home diz quando carregar", () => {
  /*
   * O React 19 pendura `<link rel="preload">` no <head> para toda <img> sem
   * `loading="lazy"`. Na home de 26/09/2026 isso fazia duas fotos do fim da
   * página (600 KB) disputarem a banda com a do topo. A regra é que cada <img>
   * DECLARE a escolha — `lazy`, `eager` ou uma expressão —, para ninguém
   * herdar o pré-carregamento sem saber.
   *
   * Conferido no FONTE, e não no HTML: o portão de publicação sobe `next dev`,
   * que não emite esses preloads, e a etapa passaria verde sem medir nada.
   */
  const arquivos = [
    "src/app/page.tsx",
    ...readdirSync(path.join(RAIZ, "src/components/home"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => `src/components/home/${f}`),
  ];
  let total = 0;
  for (const arquivo of arquivos) {
    const fonte = readFileSync(path.join(RAIZ, arquivo), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [img] of fonte.matchAll(/<img\b[\s\S]*?\/>/g)) {
      total++;
      if (!/\bloading=/.test(img) && !/fetchPriority=/.test(img)) {
        const src = img.match(/src=\{?"?([^"\s}]+)/)?.[1] ?? "?";
        throw new Error(`${arquivo}: <img src=${src}> sem loading — vira preload e disputa com o topo`);
      }
    }
  }
  return `${total} <img> em ${arquivos.length} arquivos`;
});

/*
 * ── O CARTÃO DA GALERIA (31/08/2026) ──────────────────────────────────────
 *
 * O furo era o mesmo do Open Graph da home, um degrau abaixo: a galeria TINHA
 * cartão, mas era o da plataforma. O fotógrafo mandava a entrega do casamento
 * no WhatsApp e o quadro que abria dizia "Galeria Átomo", com a marca do
 * fornecedor dele no lugar da foto do casal.
 *
 * Duas coisas se prendem aqui, e a segunda é a que ninguém lembraria de olhar:
 * que a foto aparece, e que ela NÃO aparece quando a galeria tem senha — o
 * cartão é público, e mostrar a capa de uma galeria trancada entregaria
 * justamente o que a tranca segura.
 */
console.log("\no cartão de cada galeria");

const pg = (await import("pg")).default;
const { exigirBancoDeTeste } = await import("./guarda-producao.mjs");
const { galeriaDaRodada, limparRodada } = await import("./fixture-de-teste.mjs");
exigirBancoDeTeste();

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const g = await galeriaDaRodada(db, { nome: "cartao", medias: 3, publicada: true });
const rotaCartao = `/g/${g.tslug}/${g.gslug}/opengraph-image`;

/* Duas tentativas porque a PRIMEIRA visita a esta rota compila a página no
   servidor de desenvolvimento e busca a foto no bucket — passa do tempo que o
   fetch espera, e a conexão cai antes de o PNG existir. Em produção a rota já
   está compilada; aqui a segunda tentativa pega o trabalho pronto. */
const baixarCartao = async () => {
  let ultima;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(BASE + rotaCartao, { cache: "no-store" });
      const buf = Buffer.from(await r.arrayBuffer());
      return { status: r.status, tipo: r.headers.get("content-type"), bytes: buf.length, buf };
    } catch (e) {
      ultima = e;
    }
  }
  throw new Error(`a rota do cartão não respondeu: ${ultima?.message ?? "sem motivo"}`);
};

await db.query("update galerias set senha_hash = null where id = $1", [g.id]);
const semSenha = await baixarCartao();

await etapa("a galeria tem cartão próprio, em PNG", () => {
  if (semSenha.status !== 200) throw new Error(`HTTP ${semSenha.status}`);
  if (!semSenha.tipo?.includes("image/png")) throw new Error(`veio ${semSenha.tipo}`);
  /* Assinatura do PNG: 89 50 4E 47. Conferir o cabeçalho, e não só o
     content-type, porque o content-type é promessa e o cabeçalho é o arquivo. */
  if (semSenha.buf.subarray(0, 4).toString("hex") !== "89504e47") {
    throw new Error("o content-type diz PNG mas os bytes não são de PNG");
  }
  return `${Math.round(semSenha.bytes / 1024)} KB`;
});

await etapa("o cartão da página aponta para esta rota", async () => {
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  if (!html.includes("opengraph-image")) {
    throw new Error("a galeria não declara og:image — o WhatsApp cai no cartão da plataforma");
  }
  return "og:image presente";
});

await etapa("galeria com senha continua devolvendo cartão, sem quebrar", async () => {
  await db.query("update galerias set senha_hash = $1 where id = $2", ["$2b$10$naoimporta", g.id]);
  const comSenha = await baixarCartao();
  await db.query("update galerias set senha_hash = null where id = $1", [g.id]);

  if (comSenha.status !== 200) throw new Error(`HTTP ${comSenha.status}`);
  if (comSenha.buf.subarray(0, 4).toString("hex") !== "89504e47") {
    throw new Error("não veio PNG — o robô desiste e mostra o link pelado");
  }
  return `${Math.round(comSenha.bytes / 1024)} KB`;
});

/*
 * ── O LIMITE DESTA SUÍTE, DITO EM VOZ ALTA ────────────────────────────────
 *
 * A etapa acima prova que a galeria trancada devolve um cartão válido, e NÃO
 * que a capa some dele. Provar isso de verdade exigiria comparar os dois PNGs,
 * e para isso a bancada precisaria de uma foto DE VERDADE no balde — as chaves
 * do fixture apontam para objetos que nunca foram enviados, então os dois
 * cartões saem iguais (o quadro neutro) e a comparação passaria verde sem
 * medir nada.
 *
 * Escrever um objeto no balde a partir do teste foi descartado: o R2 de
 * desenvolvimento é o MESMO de produção. Um teste que escreve lá é um teste que
 * um dia apaga lá.
 *
 * Sobra prender a regra no código, que é honesto sobre o que está sendo
 * medido: o módulo tem de consultar `senha_hash` ANTES de decidir mostrar a
 * capa. Some essa linha e esta etapa cai.
 */
/*
 * ── O VÉU PRECISA TER TAMANHO ─────────────────────────────────────────────
 *
 * O véu escurece a faixa onde o texto do cartão mora. Ele foi escrito com
 * `position: absolute; inset: 0` — que em navegador resolve o tamanho sozinho —
 * e no satori, que é quem desenha aqui, ficou com tamanho ZERO. Resultado: o
 * véu nunca foi pintado, o cartão saiu com o texto direto sobre a foto, e
 * ninguém percebeu por duas publicações porque a capa do banco de
 * desenvolvimento é escura e o texto lia de qualquer jeito.
 *
 * Só apareceu na primeira galeria real, e mesmo ali só depois de MEDIR a
 * luminância — a olho o texto parecia aceitável. A <img> ao lado sempre
 * funcionou porque já trazia `width` e `height`, e foi o que escondeu o defeito.
 *
 * A etapa é estática porque a alternativa (decodificar o PNG e medir a faixa)
 * exigiria uma dependência de imagem só para isto. O que ela prende é
 * exatamente o erro cometido: absoluto sem medida.
 */
/* Os DOIS cartões com foto: o da galeria e, desde 26/09/2026, o da vitrine do
   estúdio, que nasceu do mesmo molde e herdaria o mesmo esquecimento. */
for (const [arquivo, qual] of [
  ["src/app/g/[estudio]/[galeria]/opengraph-image.tsx", "galeria"],
  ["src/app/e/[estudio]/opengraph-image.tsx", "vitrine"],
]) {
  await etapa(`o véu do cartão da ${qual} tem largura e altura declaradas`, async () => {
    const fonte = readFileSync(path.join(RAIZ, arquivo), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

    /* Todo bloco de estilo com `position: "absolute"` precisa trazer as duas
       medidas. Vale para o véu e para a foto — os dois são absolutos, e o mesmo
       esquecimento em qualquer um deles apaga a peça em silêncio. */
    const absolutos = [...fonte.matchAll(/style=\{\{([^}]*position:\s*"absolute"[^}]*)\}\}/g)];
    if (absolutos.length < 2) {
      throw new Error(`achei ${absolutos.length} elementos absolutos, esperava ao menos 2 (foto e véu)`);
    }
    for (const [, corpo] of absolutos) {
      if (!/width:/.test(corpo) || !/height:/.test(corpo)) {
        throw new Error(
          "elemento absoluto sem width/height — no satori isso vira tamanho zero e a peça " +
            "some do cartão sem erro nenhum",
        );
      }
    }
    return `${absolutos.length} elementos absolutos, todos com medida`;
  });
}

await etapa("a regra da senha está escrita no gerador do cartão", async () => {
  const fonte = readFileSync(
    path.join(RAIZ, "src/app/g/[estudio]/[galeria]/opengraph-image.tsx"),
    "utf8",
  );
  const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  if (!/senha_hash/.test(semComentarios)) {
    throw new Error(
      "o gerador do cartão não consulta `senha_hash` — a capa de galeria trancada iria " +
        "para o cartão público, que o robô do WhatsApp guarda e qualquer um encaminha",
    );
  }
  return "consulta senha_hash antes de mostrar a capa";
});

/*
 * ── O ENDEREÇO DO ESTÚDIO (26/09/2026) ────────────────────────────────────
 *
 * A vitrine é a única página do estúdio que DEVE aparecer no Google, e a
 * auditoria de 26/09/2026 achou quatro furos nela, todos invisíveis de dentro
 * do painel:
 *
 *   · o cartão de link era o da plataforma (título, imagem e og:url nossos);
 *   · a aba e o resultado de busca terminavam em "· Galeria Átomo";
 *   · nenhum canônico, com a mesma vitrine abrindo por até quatro endereços;
 *   · `/robots.txt`, `/sitemap.xml` e `/icon.svg` do subdomínio caíam na rota
 *     de galeria e devolviam 404 — depois de consultar o banco.
 */
console.log("\no endereço do estúdio");

const nomeEstudio = g.estudio.nome_estudio;
const hostEstudio = `${g.tslug}.${marca.dominio}`;
const enderecoEstudio = `https://${hostEstudio}`;

await etapa("o robots.txt do estúdio é dele, e aponta o mapa dele", async () => {
  const r = await pegarComo("/robots.txt", hostEstudio);
  if (r.status !== 200) throw new Error(`HTTP ${r.status} — caiu na rota de galeria?`);
  if (!r.tipo.startsWith("text/plain")) throw new Error(`content-type ${r.tipo}`);
  if (!r.corpo.includes(`Sitemap: ${enderecoEstudio}/sitemap.xml`)) {
    throw new Error("a linha Sitemap: não aponta o mapa do estúdio");
  }
  /* Bloquear as galerias esconderia do robô o `noindex` que as tira do índice. */
  if (/Disallow:\s*\/(g|painel)\b/.test(r.corpo)) throw new Error("bloqueia rota que não devia");
  return hostEstudio;
});

await etapa("o sitemap.xml do estúdio lista a vitrine, e só ela", async () => {
  const r = await pegarComo("/sitemap.xml", hostEstudio);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (!r.corpo.includes(`<loc>${enderecoEstudio}/</loc>`)) throw new Error("não lista a vitrine");
  if (r.corpo.includes(g.gslug)) throw new Error("lista uma galeria — entrega pessoal, com noindex");
});

await etapa("o /icon.svg do endereço do estúdio não passa pela rota de galeria", async () => {
  const r = await pegarComo("/icon.svg", hostEstudio);
  if (r.status !== 200 || !r.tipo.startsWith("image/svg+xml")) {
    throw new Error(`HTTP ${r.status} ${r.tipo} — virou a galeria "icon.svg" de novo`);
  }
});

const vitrine = (await pegarComo("/", hostEstudio)).corpo;

await etapa("a aba da vitrine é do estúdio: o nome dele, e nunca o nosso ícone", () => {
  if (titulo(vitrine) !== nomeEstudio) {
    throw new Error(`<title> é "${titulo(vitrine)}", esperava "${nomeEstudio}"`);
  }
  /* O estúdio da bancada não tem logo: a aba fica sem ícone, e não com o
     átomo do layout raiz (ver `lib/icone-do-estudio.ts`). */
  if (/<link rel="icon"[^>]*icon\.svg/.test(vitrine)) {
    throw new Error("a vitrine pendura o icon.svg da plataforma na aba do estúdio");
  }
});

await etapa("o cartão da vitrine é do estúdio", async () => {
  if (meta(vitrine, "og:title") !== nomeEstudio) throw new Error(`og:title é ${meta(vitrine, "og:title")}`);
  if (meta(vitrine, "og:site_name") !== nomeEstudio) throw new Error("og:site_name é o da plataforma");
  if (semBarra(meta(vitrine, "og:url")) !== enderecoEstudio) {
    throw new Error(`og:url é ${meta(vitrine, "og:url")} — o cartão leva para outro lugar`);
  }
  const imagem = meta(vitrine, "og:image") ?? "";
  if (!imagem.includes(`/e/${g.tslug}/opengraph-image`)) {
    throw new Error(`og:image é "${imagem}" — o quadro da plataforma no site do estúdio`);
  }
  const png = await fetch(`${BASE}/e/${g.tslug}/opengraph-image`, { cache: "no-store" });
  const bytes = Buffer.from(await png.arrayBuffer());
  if (png.status !== 200 || bytes.subarray(0, 4).toString("hex") !== "89504e47") {
    throw new Error(`o cartão da vitrine não veio PNG (HTTP ${png.status})`);
  }
  return `${Math.round(bytes.length / 1024)} KB`;
});

await etapa("a vitrine aponta um endereço canônico, venha por onde vier", async () => {
  /* O domínio antigo continua servindo (link entregue não quebra); o
     canônico é o que diz ao buscador qual dos endereços vale. */
  for (const host of [hostEstudio, `${g.tslug}.olumier.com.br`]) {
    const html = (await pegarComo("/", host)).corpo;
    if (semBarra(canonico(html)) !== enderecoEstudio) {
      throw new Error(`por ${host}, o canônico é ${canonico(html)}`);
    }
  }
  return enderecoEstudio;
});

await etapa("a aba da galeria não termina no nome da plataforma", async () => {
  const html = (await pegarComo(`/${g.gslug}`, hostEstudio)).corpo;
  const t = titulo(html) ?? "";
  if (!t.includes(nomeEstudio)) throw new Error(`<title> "${t}" não traz o estúdio`);
  if (t.includes(marca.nome)) throw new Error(`<title> "${t}" anuncia a plataforma`);
});

await etapa("o link de um capítulo desdobra com o cartão da galeria", async () => {
  /* O cartão mora no segmento da galeria; o do capítulo substituía o
     `openGraph` e perdia a imagem — link com título e sem foto. */
  const html = (await pegarComo(`/${g.gslug}/um-capitulo`, hostEstudio)).corpo;
  const imagem = meta(html, "og:image") ?? "";
  if (!imagem.includes(`/g/${g.tslug}/${g.gslug}/opengraph-image`)) {
    throw new Error(`og:image do capítulo é "${imagem}"`);
  }
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o robô encontra menos do que devia" : "\n✓ seo ok");
process.exitCode = falhou ? 1 : 0;
