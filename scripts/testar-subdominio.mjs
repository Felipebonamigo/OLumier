#!/usr/bin/env node
/**
 * Testa o subdomínio por estúdio. Uso:
 *   node --env-file=.env.local scripts/testar-subdominio.mjs
 *
 * Não precisa do DNS pronto: o roteamento é decidido pelo cabeçalho Host, então
 * dá para simular `siriusfotografia.olumier.com.br` batendo no servidor local.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import http from "node:http";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { rows } = await db.query(
  `select t.slug tslug, g.slug gslug, g.titulo, t.nome_estudio
     from galerias g join tenants t on t.id = g.tenant_id
    order by g.criado_em limit 1`,
);
const { tslug, gslug, titulo, nome_estudio } = rows[0];
await db.query(
  "update galerias set publicada = true, senha_hash = null, estado = 'online' where slug = $1",
  [gslug],
);

const HOST = `${tslug}.olumier.com.br`;
console.log(`estúdio: ${nome_estudio}\nsubdomínio simulado: ${HOST}\n`);

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
/*
 * Usa o módulo http em vez de fetch: o fetch do Node trata "Host" como cabeçalho
 * proibido e o descarta em silêncio — o servidor receberia "localhost" e o teste
 * falharia sem que o app tivesse problema algum. Já me enganou uma vez.
 */
const pedir = (caminho, host = HOST) =>
  new Promise((resolve, reject) => {
    const url = new URL(BASE + caminho);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: { Host: host },
      },
      (res) => {
        // Sem isto, um acento pode ser partido entre dois pedaços e chegar corrompido.
        res.setEncoding("utf8");
        let corpo = "";
        res.on("data", (c) => (corpo += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            headers: { get: (h) => res.headers[h.toLowerCase()] },
            corpo,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
const texto = async (r) =>
  r.corpo.replace(/<[^>]+>/g, " ").replaceAll("&amp;", "&").replace(/\s+/g, " ");

console.log("Roteamento pelo endereço:\n");

await etapa("a raiz do subdomínio lista as galerias do estúdio", async () => {
  const r = await pedir("/");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await texto(r);
  if (!t.includes(nome_estudio)) throw new Error("não mostrou o nome do estúdio");
  return "página do estúdio";
});

await etapa("o caminho curto abre a galeria", async () => {
  const r = await pedir(`/${gslug}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await texto(r);
  if (!t.includes(titulo)) throw new Error("não abriu a galeria certa");
  return `/${gslug} → ${titulo}`;
});

await etapa("o endereço bonito é mantido (reescrita, não redirecionamento)", async () => {
  const r = await pedir(`/${gslug}`);
  if (r.status >= 300 && r.status < 400) {
    throw new Error(`redirecionou para ${r.headers.get("location")} — o visitante veria a URL feia`);
  }
  return "sem redirecionamento";
});

await etapa("o domínio principal continua funcionando como antes", async () => {
  const r = await pedir(`/g/${tslug}/${gslug}`, "olumier.com.br");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await texto(r);
  if (!t.includes(titulo)) throw new Error("a rota antiga quebrou");
  return "/g/estudio/galeria intacto";
});

/*
 * A casa de um estúdio só responde pelo que é dele.
 *
 * `/g/` é a forma interna das páginas públicas e estava na lista de rotas que o
 * subdomínio deixava passar intactas — então `sirius.olumier.com.br/g/carol/x`
 * servia a entrega da Carol dentro do endereço do Sirius. Não vazava galeria com
 * senha, mas quebrava exatamente a marca própria que o produto vende.
 */
await etapa("galeria de OUTRO estúdio não abre neste endereço", async () => {
  const marca = `vizinho-${Date.now()}`;
  const {
    rows: [v],
  } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash)
          values ($1, 'Estúdio Vizinho', $2, 'x') returning id, slug`,
    [marca, `${marca}@teste`],
  );
  await db.query(
    `insert into galerias (tenant_id, slug, titulo, publicada, estado)
          values ($1, 'entrega-alheia', 'Entrega Alheia', true, 'online')`,
    [v.id],
  );

  try {
    const r = await pedir(`/g/${v.slug}/entrega-alheia`);
    if (r.status === 200) throw new Error("serviu a entrega do vizinho dentro deste endereço");
    if (r.status < 300 || r.status >= 400) {
      throw new Error(`esperava redirecionamento, veio ${r.status}`);
    }
    const destino = r.headers.get("location") ?? "";
    if (destino.includes(`${tslug}.`)) throw new Error(`continuou neste domínio: ${destino}`);
    if (!destino.includes("olumier.com.br")) throw new Error(`mandou para ${destino}`);
    return "vai para o domínio principal";
  } finally {
    await db.query("delete from tenants where id = $1", [v.id]);
  }
});

await etapa("o caminho interno da própria galeria vira o endereço curto", async () => {
  const r = await pedir(`/g/${tslug}/${gslug}`);
  if (r.status < 300 || r.status >= 400) {
    throw new Error(`esperava redirecionamento, veio ${r.status}`);
  }
  const destino = r.headers.get("location") ?? "";
  if (!destino.includes(`${tslug}.`) || !destino.endsWith(`/${gslug}`)) {
    throw new Error(`mandou para ${destino}`);
  }
  return `um endereço só — ${destino}`;
});

await etapa("a vitrine de outro estúdio também não abre aqui", async () => {
  const r = await pedir("/e/estudio-alheio");
  if (r.status < 300 || r.status >= 400) {
    throw new Error(`esperava redirecionamento, veio ${r.status}`);
  }
  if ((r.headers.get("location") ?? "").includes(`${tslug}.`)) {
    throw new Error("a vitrine alheia ficou neste domínio");
  }
  return "/e/ alheio sai daqui";
});

await etapa("o painel não abre por subdomínio de estúdio", async () => {
  const r = await pedir("/painel");
  if (r.status < 300 || r.status >= 400) throw new Error(`esperava redirecionamento, veio ${r.status}`);
  const destino = r.headers.get("location") ?? "";
  if (!destino.includes("olumier.com.br") || destino.includes(`${tslug}.`)) {
    throw new Error(`mandou para ${destino}`);
  }
  return "manda para o domínio principal";
});

await etapa("subdomínio reservado não vira estúdio", async () => {
  const r = await pedir("/", "www.olumier.com.br");
  const t = await texto(r);
  if (t.includes("Nenhuma galeria pública")) throw new Error("www foi tratado como estúdio");
  return "www segue sendo o site";
});

await etapa("estúdio inexistente devolve 404", async () => {
  const r = await pedir("/", "estudio-que-nao-existe.olumier.com.br");
  if (r.status !== 404) throw new Error(`esperava 404, veio ${r.status}`);
  return "HTTP 404";
});

console.log("\nPorteiro do certificado:\n");

await etapa("libera certificado para estúdio que existe", async () => {
  const r = await fetch(`${BASE}/api/tls/permitir?domain=${HOST}`);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return "HTTP 200";
});

await etapa("recusa estúdio inexistente", async () => {
  const r = await fetch(`${BASE}/api/tls/permitir?domain=inventado.olumier.com.br`);
  if (r.status !== 403) throw new Error(`esperava 403, veio ${r.status}`);
  return "HTTP 403";
});

await etapa("recusa domínio de fora (evita virar emissor de certificado alheio)", async () => {
  const r = await fetch(`${BASE}/api/tls/permitir?domain=site-do-golpista.com`);
  if (r.status !== 403) throw new Error(`esperava 403, veio ${r.status}`);
  return "HTTP 403";
});

await etapa("libera o domínio principal e o www", async () => {
  for (const d of ["olumier.com.br", "www.olumier.com.br"]) {
    const r = await fetch(`${BASE}/api/tls/permitir?domain=${d}`);
    if (r.status !== 200) throw new Error(`${d} veio ${r.status}`);
  }
  return "os dois liberados";
});

await db.end();

if (falhou) {
  console.error("\n✗ o subdomínio tem problema");
  process.exit(1);
}
console.log(`\n✓ subdomínio pronto — falta só o DNS apontar *.olumier.com.br`);
