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
/** Todos os blocos `application/ld+json` da página, já lidos. */
const blocosEstruturados = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1]),
  );
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
  /* Pelo endereço inteiro: desde 10/10/2026 o sitemap lista vitrines, e um
     estúdio chamado "entrar-…" casaria com um "/entrar" solto. */
  if (r.corpo.includes(`<loc>https://${marca.dominio}/entrar`)) throw new Error("lista /entrar — sitemap não é menu");
  return `domínio ${marca.dominio}`;
});

await etapa("a página-ponte do Instagram é a exceção: fora do sitemap e fora do índice", async () => {
  /*
   * Toda página pública da casa entra no sitemap (`metadadosDaCasa`) — menos a
   * `/bio` (07/10/2026), de propósito. É página de campanha, um seletor entre
   * dois produtos: no índice ela brigaria na busca com a home, que é a que
   * precisa ser achada por "Galeria Átomo". O cartão do link (WhatsApp,
   * Instagram) continua funcionando, e `noindex` + canônico próprio dizem ao
   * robô o que ela é. Os redirecionadores `/bio/ir/*` saem do robots: cada
   * visita é um clique contado.
   */
  const mapa = await pegar("/sitemap.xml");
  if (mapa.corpo.includes(`<loc>https://${marca.dominio}/bio`)) throw new Error("a /bio entrou no sitemap");
  const p = await pegar("/bio");
  if (p.status !== 200) throw new Error(`HTTP ${p.status}`);
  if (!/noindex/.test(meta(p.corpo, "robots") ?? "")) throw new Error("a /bio não é noindex");
  if (!(canonico(p.corpo) ?? "").endsWith("/bio")) throw new Error(`canônico: ${canonico(p.corpo)}`);
  if (!(meta(p.corpo, "og:title") ?? "").includes(marca.nome)) throw new Error("o cartão do link perdeu o título");
  const r = await pegar("/robots.txt");
  if (!/Disallow: \/bio\/ir/.test(r.corpo)) throw new Error("os redirecionadores estão abertos para robô");
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
  /* A home tem MAIS de um bloco desde 29/09/2026 (a FAQ e o de quem é a
     casa): procura-se o FAQPage entre eles, não o primeiro que aparecer. */
  const dados = blocosEstruturados(r.corpo).find((b) => b["@type"] === "FAQPage");
  if (!dados) throw new Error("sem bloco FAQPage — a FAQ não vira resultado expandido");
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

await etapa("a home tem um <h1> só — o dela", () => {
  /*
   * Medido no ar em 29/09/2026: doze. As galerias de exemplo usam a capa de
   * verdade, e a capa marca o nome do casal como `<h1>` — na galeria, é o
   * título da página; na home, eram doze nomes fictícios competindo com o
   * título real. Ver a prop `ilustracao` de `GaleriaCapa`.
   */
  const h1s = [...home.matchAll(/<h1[\s>]/g)].length;
  if (h1s !== 1) throw new Error(`${h1s} <h1> na home`);
});

await etapa("a home diz quem é: site, organização e produto com o preço que mostra", async () => {
  /*
   * `WebSite` dá o nome que o Google escreve acima do resultado; `Organization`
   * diz quem responde; `SoftwareApplication` diz o que se compra. O preço é o
   * PISO da grade (`ESPACOS[0]`) — e a etapa confere que a home mostra esse
   * mesmo número, porque dado estruturado que promete o que a página não diz
   * é o que o Google pune.
   */
  const { ESPACOS, formatarReais } = await import("../src/config/planos.ts");
  const grafo = blocosEstruturados(home).find((b) => Array.isArray(b["@graph"]))?.["@graph"] ?? [];
  const tipo = (t) => grafo.find((n) => n["@type"] === t);
  for (const t of ["WebSite", "Organization", "SoftwareApplication"]) {
    if (!tipo(t)) throw new Error(`sem ${t} no bloco da casa`);
  }
  if (tipo("WebSite").name !== marca.nome) throw new Error(`WebSite.name é ${tipo("WebSite").name}`);
  /* Quem busca digita "galeria atomo", sem acento: o bloco tem de dizer ao
     Google que as duas grafias são o mesmo site (02/10/2026). */
  const semAcento = marca.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (semAcento !== marca.nome && !tipo("WebSite").alternateName?.includes(semAcento)) {
    throw new Error(`WebSite sem a grafia "${semAcento}" em alternateName`);
  }
  const oferta = tipo("SoftwareApplication").offers ?? {};
  const piso = (ESPACOS[0].precoCentavos / 100).toFixed(2);
  if (oferta.lowPrice !== piso || oferta.priceCurrency !== "BRL") {
    throw new Error(`oferta ${oferta.lowPrice} ${oferta.priceCurrency}, esperava ${piso} BRL`);
  }
  /* O mesmo número tem de estar na página que as pessoas leem. */
  const visivel = formatarReais(ESPACOS[0].precoCentavos).replace(/\s/g, " ");
  if (!home.replace(/&nbsp;|\u00a0/g, " ").includes(visivel)) {
    throw new Error(`a home não mostra ${visivel} — o bloco promete um preço que a página não diz`);
  }
  /* Sem nota inventada: não há avaliação real para mostrar. */
  if (/aggregateRating|"review"/.test(JSON.stringify(grafo))) throw new Error("avaliação no bloco");
  return `a partir de ${visivel}`;
});

await etapa("o /llms.txt resume a casa com o que ela já publica", async () => {
  /*
   * Buscador de resposta (ChatGPT, Claude, Perplexity) lê este arquivo para
   * saber o que o site é. Ele sai de `marca.ts` e `planos.ts` — e não pode
   * prometer vídeo enquanto `VIDEO_LIBERADO` estiver desligado: é a mesma
   * trava da home, num lugar que ninguém lembraria de reler.
   */
  const r = await pegar("/llms.txt");
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (!r.corpo.startsWith(`# ${marca.nome}`)) throw new Error("não abre com o nome da marca");
  const { ESPACOS, formatarReais } = await import("../src/config/planos.ts");
  if (!r.corpo.includes(formatarReais(ESPACOS[0].precoCentavos))) throw new Error("sem o piso de preço");
  const { VIDEO_LIBERADO } = await import("../src/config/lancamentos.ts");
  if (!VIDEO_LIBERADO && /v[íi]deo|filme|4K|filmmaker/i.test(r.corpo)) {
    throw new Error("fala de vídeo com VIDEO_LIBERADO desligado");
  }
  return `${r.corpo.split("\n").length} linhas`;
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

await etapa("arquivo pedido no endereço do estúdio não vira galeria", async () => {
  /*
   * `/llms.txt`, `/apple-touch-icon.png`, `/wp-login.php`: robô pede isso o
   * tempo todo, e cada pedido era lido como uma galeria — renderização inteira
   * e consulta ao banco para devolver 404. O 404 agora sai do proxy, em texto;
   * a página de 404 em HTML é a prova de que ele passou pela rota de galeria.
   */
  for (const caminho of ["/llms.txt", "/apple-touch-icon.png", "/wp-login.php"]) {
    const r = await pegarComo(caminho, hostEstudio);
    if (r.status !== 404) throw new Error(`${caminho} veio HTTP ${r.status}`);
    if (r.tipo.includes("text/html")) throw new Error(`${caminho} passou pela rota de galeria`);
  }
  /* E o endereço curto de uma galeria de verdade continua abrindo. */
  const galeria = await pegarComo(`/${g.gslug}`, hostEstudio);
  if (galeria.status !== 200) throw new Error(`a galeria veio HTTP ${galeria.status}`);
});

const vitrine = (await pegarComo("/", hostEstudio)).corpo;

await etapa("a aba da vitrine tem o nome do estúdio, sem o nosso", () => {
  /* O ícone da aba é conferido na etapa da logo, mais abaixo: sem logo vale o
     favicon do layout, que `testar-app-instalado.mjs` exige que não suma. */
  if (titulo(vitrine) !== nomeEstudio) {
    throw new Error(`<title> é "${titulo(vitrine)}", esperava "${nomeEstudio}"`);
  }
});

await etapa("com logo, o <h1> da vitrine diz o nome em texto e a aba mostra a logo", async () => {
  /* Medido no ar em 29/09/2026: a vitrine com logo tinha um <h1> só com a
     imagem dentro — "h1 vazio" para todo robô que não lê imagem. A chave não
     precisa existir no armazém: a página só assina o link. */
  await db.query("update tenants set logo_chave = $1 where id = $2", ["logos/teste-seo.png", g.estudio.id]);
  try {
    const html = (await pegarComo("/", hostEstudio)).corpo;
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    if (!h1.includes("<img")) throw new Error("a logo não está no <h1>");
    const texto = h1.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (texto !== nomeEstudio) throw new Error(`o texto do <h1> é "${texto}"`);
    /* A aba é a marca do estúdio também (`lib/icone-do-estudio.ts`) — e o
       átomo do layout não fica pendurado ao lado dela. */
    const icones = [...html.matchAll(/<link rel="icon"[^>]*>/g)].map((m) => m[0]);
    if (!icones.some((i) => i.includes("logos/teste-seo.png"))) throw new Error("a aba não mostra a logo");
    if (icones.some((i) => i.includes("icon.svg"))) throw new Error("o átomo continua na aba ao lado da logo");
  } finally {
    await db.query("update tenants set logo_chave = null where id = $1", [g.estudio.id]);
  }
});

await etapa("sem frase, a descrição da vitrine vem do 'sobre' — e só com o site ligado", async () => {
  const sobre = "Fotografia de casamento no litoral gaúcho, com calma e sem pose.";
  const desc = async (site) => {
    await db.query("update tenants set site = $1 where id = $2", [JSON.stringify(site), g.estudio.id]);
    return meta((await pegarComo("/", hostEstudio)).corpo, "description");
  };
  try {
    const ligado = await desc({ ligado: true, sobre });
    if (ligado !== sobre) throw new Error(`site ligado: descrição "${ligado}"`);
    /* Desligado, o "sobre" não aparece na página — e o resumo não pode prometer
       o que a página não mostra. */
    const desligado = await desc({ ligado: false, sobre });
    if (desligado?.includes("litoral")) throw new Error("usou o 'sobre' com o site desligado");
  } finally {
    await db.query("update tenants set site = '{}'::jsonb where id = $1", [g.estudio.id]);
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

await etapa("a vitrine diz quem é o estúdio — e o contato só quando a página mostra", async () => {
  const org = blocosEstruturados(vitrine).find((b) => b["@type"] === "Organization");
  if (!org) throw new Error("sem bloco Organization na vitrine");
  if (org.name !== nomeEstudio) throw new Error(`name é ${org.name}`);
  if (semBarra(org.url) !== enderecoEstudio) throw new Error(`url é ${org.url}, e não o canônico`);
  /* A bancada nasce com o site desligado: a seção de contato não aparece, e o
     bloco não pode anunciar um canal que a página esconde. */
  if (org.contactPoint || org.sameAs || org.email) throw new Error("contato no bloco com o site desligado");

  await db.query("update tenants set site = $1 where id = $2", [
    JSON.stringify({ ligado: true, instagram: "estudio.teste", whatsapp: "5551999998888" }),
    g.estudio.id,
  ]);
  try {
    const ligado = blocosEstruturados((await pegarComo("/", hostEstudio)).corpo).find(
      (b) => b["@type"] === "Organization",
    );
    if (!ligado?.sameAs?.includes("https://instagram.com/estudio.teste")) {
      throw new Error("com o contato no ar, o Instagram não entrou em sameAs");
    }
    if (!ligado.contactPoint?.url?.includes("wa.me/5551999998888")) {
      throw new Error("com o contato no ar, o WhatsApp não entrou");
    }
  } finally {
    await db.query("update tenants set site = '{}'::jsonb where id = $1", [g.estudio.id]);
  }
});

await etapa("filme sem pôster escolhido como capa não vira imagem na vitrine", async () => {
  /*
   * O filme pode ser capa desde 02/10/2026 (`lib/capa-publica.ts`), mas só com
   * pôster. A consulta da vitrine é outra — mora em `lib/vitrine.ts` — e sem a
   * mesma regra ela mandaria o .mp4 inteiro para um <img> e para o cartão do
   * link. A chave não precisa existir no armazém: o que se mede é se ela
   * aparece na página.
   */
  const chave = `${g.estudio.id}/${g.id}/filme-sem-poster.mp4`;
  const { rows: [filme] } = await db.query(
    `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime, bytes, ordem, pronto)
     values ($1, $2, $3, 'filme.mp4', 'video', 'video/mp4', 1000, 99, true) returning id`,
    [g.id, g.estudio.id, chave],
  );
  await db.query("update galerias set capa_media_id = $1 where id = $2", [filme.id, g.id]);
  try {
    const html = (await pegarComo("/", hostEstudio)).corpo;
    if (html.includes("filme-sem-poster.mp4")) throw new Error("a vitrine pediu o .mp4 como imagem");
  } finally {
    await db.query("update galerias set capa_media_id = null where id = $1", [g.id]);
    await db.query("delete from medias where id = $1", [filme.id]);
  }
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

/*
 * ── O QUE O PRÓPRIO SISTEMA FAZ PARA SER ACHADO (10/10/2026) ──────────────
 *
 * Felipe: "estou falando do sistema, tudo que o sistema pode fazer". Quatro
 * peças, cada uma com a sua etapa: o selo que vira link medido, o botão de
 * compartilhar do cliente, as vitrines no sitemap da casa e o nome do estúdio
 * na caixa de entrada.
 */
console.log("\no que leva gente até a casa");

const NAVEGADOR =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const { lerCookieDaBio, origemDoCadastro } = await import("../src/lib/bio-regras.ts");

await etapa("o selo do fim da galeria e da vitrine é um link medido para a casa", async () => {
  const seloEm = (html, lugar) =>
    html.match(new RegExp(`<a [^>]*data-selo="${lugar}"[^>]*>`))?.[0] ?? null;
  const naGaleria = seloEm((await pegarComo(`/${g.gslug}`, hostEstudio)).corpo, "galeria");
  const naVitrine = seloEm((await pegarComo("/", hostEstudio)).corpo, "vitrine");
  for (const [lugar, a] of [["galeria", naGaleria], ["vitrine", naVitrine]]) {
    if (!a) throw new Error(`o selo da ${lugar} não é link`);
    /* Absoluto no domínio da casa: relativo, cairia na rota de galeria do estúdio. */
    if (!a.includes(`href="https://${marca.dominio}/selo/${g.tslug}?no=${lugar}"`)) {
      throw new Error(`href do selo da ${lugar}: ${a}`);
    }
    /* Nova aba (a pessoa está no meio das fotos) e sem levar o endereço da galeria junto. */
    if (!a.includes('target="_blank"') || !/rel="[^"]*noreferrer/.test(a)) {
      throw new Error(`o selo da ${lugar} não abre à parte, ou leva o endereço da galeria`);
    }
  }
});

await etapa("o clique no selo leva à home, conta, e deixa a origem para o cadastro", async () => {
  const contar = async () =>
    Number(
      (
        await db.query("select count(*) from bio_eventos where evento = 'click_selo' and campanha = $1", [
          g.tslug,
        ])
      ).rows[0].count,
    );
  const antes = await contar();
  const r = await fetch(`${BASE}/selo/${g.tslug}?no=vitrine`, {
    redirect: "manual",
    headers: { "user-agent": NAVEGADOR, connection: "close" },
  });
  if (r.status !== 302) throw new Error(`HTTP ${r.status}`);
  if (new URL(r.headers.get("location") ?? "", BASE).pathname !== "/") {
    throw new Error(`foi para ${r.headers.get("location")}, e não para a home`);
  }
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith("origem_bio="));
  if (!cookie) throw new Error("não deixou o cookie de origem");
  const lido = lerCookieDaBio(decodeURIComponent(cookie.split(";")[0].slice("origem_bio=".length)));
  if (!lido) throw new Error(`o cadastro não leria o cookie: ${cookie}`);
  const conta = origemDoCadastro(lido);
  if (conta.origem !== "selo/vitrine/galeria" || conta.campanha !== g.tslug) {
    throw new Error(`a conta nasceria com ${JSON.stringify(conta)}`);
  }
  /* O clique é gravado DEPOIS da resposta (`after`). */
  for (let i = 0; i < 30 && (await contar()) === antes; i++) await new Promise((ok) => setTimeout(ok, 100));
  if ((await contar()) !== antes + 1) throw new Error("o clique não foi contado");

  /* A prévia do link no WhatsApp é robô: redireciona igual, sem cookie e sem número. */
  const robo = await fetch(`${BASE}/selo/${g.tslug}?no=galeria`, {
    redirect: "manual",
    headers: { "user-agent": "WhatsApp/2.23.20.0", connection: "close" },
  });
  if (robo.status !== 302) throw new Error(`robô: HTTP ${robo.status}`);
  if (robo.headers.getSetCookie().some((c) => c.startsWith("origem_bio="))) {
    throw new Error("a prévia do WhatsApp ganhou cookie de origem");
  }
  await new Promise((ok) => setTimeout(ok, 500));
  if ((await contar()) !== antes + 1) throw new Error("a prévia do WhatsApp virou clique");
  await db.query("delete from bio_eventos where campanha = $1", [g.tslug]);
});

await etapa("o cliente tem um botão para compartilhar a galeria", async () => {
  const html = (await pegarComo(`/${g.gslug}`, hostEstudio)).corpo;
  if (!html.includes("↗ Compartilhar")) throw new Error("a barra da galeria não oferece compartilhar");
});

await etapa("o sitemap da casa lista as vitrines que têm o que mostrar", async () => {
  const doEstudio = `<loc>https://${hostEstudio}/</loc>`;
  const mapa = async () => (await pegar("/sitemap.xml")).corpo;
  if (!(await mapa()).includes(doEstudio)) throw new Error("a vitrine do estúdio não está no sitemap da casa");
  /* Com a única galeria atrás de senha, a vitrine não mostra nada — e página
     vazia no índice é o "conteúdo raso" que o buscador cobra do domínio. */
  await db.query("update galerias set senha_hash = 'x' where id = $1", [g.id]);
  try {
    const sem = await mapa();
    if (sem.includes(doEstudio)) throw new Error("listou vitrine sem nenhuma galeria à mostra");
    if (sem.includes(g.gslug)) throw new Error("listou uma galeria");
  } finally {
    await db.query("update galerias set senha_hash = null where id = $1", [g.id]);
  }
});

await etapa("o e-mail da entrega chega com o nome do estúdio na frente", async () => {
  const { remetenteDoEstudio } = await import("../src/lib/email.ts");
  const base = `${marca.nome} <entregas@${marca.dominio}>`;
  const certo = remetenteDoEstudio(base, "Sirius Fotografia");
  if (certo !== `"Sirius Fotografia via ${marca.nome}" <entregas@${marca.dominio}>`) {
    throw new Error(`saiu ${certo}`);
  }
  /* Nome do estúdio é texto do fotógrafo indo para um cabeçalho. */
  const torto = remetenteDoEstudio(base, 'Estúdio "X" <a@b.c>\r\nBcc: todos@golpe.net');
  if (/[\r\n]/.test(torto) || (torto.match(/"/g) ?? []).length !== 2 || (torto.match(/</g) ?? []).length !== 1) {
    throw new Error(`cabeçalho injetável: ${JSON.stringify(torto)}`);
  }
  if (remetenteDoEstudio(base, ' "" ') !== base) throw new Error("nome vazio não voltou ao remetente de sempre");
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o robô encontra menos do que devia" : "\n✓ seo ok");
process.exitCode = falhou ? 1 : 0;
