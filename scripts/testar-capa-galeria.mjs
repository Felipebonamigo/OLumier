#!/usr/bin/env node
/**
 * A capa enviada como arquivo. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-capa-galeria.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (04/09/2026) ──────────────────────────────────────────────────
 *
 * O sócio: "adicionar uma área de selecionar capa: escolher se será de alguma
 * galeria já existente ou se será através da importação de algum arquivo."
 *
 * A primeira metade existia e estava escondida: o botão "capa" mora em cada
 * miniatura da grade, e quem não rolasse a grade não o encontrava. A segunda
 * metade não existia — a capa era obrigatoriamente uma FOTO DA ENTREGA, e o
 * fotógrafo que quisesse uma arte (um convite, um cartão com o nome do casal)
 * teria de subi-la como foto e ela apareceria no meio das outras para o casal.
 *
 * Agora a capa pode ser um arquivo próprio, guardado fora de `medias`: não
 * entra na galeria, não conta na quota do plano como entrega, e não aparece
 * para o cliente a não ser como capa.
 *
 * ── A REGRA QUE ESTE ARQUIVO MAIS PRENDE ───────────────────────────────────
 *
 * A chave do objeto vem do NAVEGADOR na hora de confirmar. Sem conferir que ela
 * pertence a esta galeria e a este estúdio, um pedido forjado apontaria a capa
 * de uma galeria para um objeto de outra conta — ou para qualquer chave do
 * bucket. É o mesmo cuidado que a rota da logo já tinha, e a razão de ele estar
 * repetido aqui é que são duas portas diferentes.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { LIMITE_CAPA } from "../src/lib/capa-galeria.ts";
import { objetoExiste } from "../src/lib/r2.ts";

await exigirBancoDeTeste();

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

const g = await galeriaDaRodada(db, { nome: "capa", medias: 2 });
const cookie = cookieDeSessao(g.tenant_id);
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);

/* PNG de 1×1 — o menor arquivo que é mesmo um PNG. O que importa aqui é o
   caminho, não a imagem. */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const rota = (id = g.id) => `${BASE}/api/galerias/${id}/capa`;
const pedirEnvio = (corpo, extra = {}) =>
  fetch(rota(), {
    method: "POST",
    headers: { "content-type": "application/json", cookie, ...(extra.headers ?? {}) },
    body: JSON.stringify(corpo),
  });

console.log("\nCapa enviada como arquivo\n");

await etapa("sem sessão, ninguém pede envio de capa", async () => {
  const r = await fetch(rota(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mime: "image/png", bytes: png.length }),
  });
  igual(r.status, 401, "status");
});

await etapa("galeria de outro estúdio não aceita capa", async () => {
  const { rows: [vizinha] } = await db.query(
    `insert into galerias (tenant_id, slug, titulo, estado)
          select tenant_id, 'capa-vizinha-' || substr(md5(random()::text),1,8), 'Vizinha', 'online'
            from galerias where id <> $1 and tenant_id <> $2 limit 1
       returning id`,
    [g.id, g.tenant_id],
  );
  if (!vizinha) return "(sem outro estúdio no banco — pulado)";
  const r = await fetch(rota(vizinha.id), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ mime: "image/png", bytes: png.length }),
  });
  await db.query("delete from galerias where id = $1", [vizinha.id]);
  igual(r.status, 404, "status");
});

await etapa("tipo e tamanho são recusados antes de gerar URL", async () => {
  igual((await pedirEnvio({ mime: "image/gif", bytes: 100 })).status, 415, "gif");
  igual((await pedirEnvio({ mime: "image/svg+xml", bytes: 100 })).status, 415, "svg");
  igual((await pedirEnvio({ mime: "image/png", bytes: 0 })).status, 415, "vazio");
  igual((await pedirEnvio({ mime: "image/png", bytes: LIMITE_CAPA + 1 })).status, 415, "grande");
});

let chave = null;

await etapa("o pedido devolve URL assinada, com a chave dentro da pasta DESTA galeria", async () => {
  const r = await pedirEnvio({ mime: "image/png", bytes: png.length });
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  chave = corpo.chave;
  if (!chave.startsWith(`${g.tenant_id}/${g.id}/capa/`)) throw new Error(`chave fora da pasta: ${chave}`);

  const envio = await fetch(corpo.url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  if (!envio.ok) throw new Error(`PUT no bucket: HTTP ${envio.status}`);
  return chave.slice(-24);
});

await etapa("confirmar com chave de FORA da galeria é recusado", async () => {
  const r = await fetch(rota(), {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ chave: `${g.tenant_id}/marca/roubada.png` }),
  });
  igual(r.status, 400, "status");
  const { rows: [antes] } = await db.query("select capa_chave from galerias where id = $1", [g.id]);
  igual(antes.capa_chave, null, "não gravou nada");
});

await etapa("confirmar grava a capa", async () => {
  const r = await fetch(rota(), {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ chave }),
  });
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  const { rows: [depois] } = await db.query("select capa_chave from galerias where id = $1", [g.id]);
  igual(depois.capa_chave, chave, "gravada");
});

await etapa("a galeria do cliente passa a usar a capa enviada", async () => {
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  const limpo = html.replaceAll("\\u0026", "&").replaceAll("&amp;", "&");
  const nome = chave.split("/").pop();
  if (!limpo.includes(nome)) throw new Error("a capa enviada não aparece na página");
  return nome;
});

await etapa("a capa NÃO vira foto da galeria — não entra na grade nem na quota", async () => {
  const { rows: [m] } = await db.query(
    "select count(*)::int as n from medias where galeria_id = $1",
    [g.id],
  );
  igual(m.n, 2, "mídias da galeria");
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  /* Duas miniaturas na grade: as duas fotos de verdade, e não três. */
  const thumbs = new Set(html.match(/[\w-]+_thumb\.webp/g) ?? []);
  igual(thumbs.size, 2, "miniaturas na grade");
});

await etapa("tirar a capa limpa a coluna E apaga o arquivo do bucket", async () => {
  const r = await fetch(rota(), { method: "DELETE", headers: { cookie } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows: [depois] } = await db.query("select capa_chave from galerias where id = $1", [g.id]);
  igual(depois.capa_chave, null, "coluna limpa");
  /* Arquivo pago que ninguém mais consegue relacionar a nada é órfão — o mesmo
     estrago que `varrer-orfaos` sai caçando. */
  igual(await objetoExiste(chave), false, "objeto no bucket");
});

/*
 * ── A CAPA JORNAL PASSA A MOSTRAR A FOTO (08/09/2026) ─────────────────────
 *
 * Felipe: "minha capa não aparece no formato jornal". O aviso que a tela dá
 * está correto — o desenho jornal era só tipografia — mas a resposta certa não
 * é mandá-lo trocar de desenho: um jornal TEM foto. É a manchete em cima e a
 * imagem grande embaixo; era essa a metade que faltava.
 *
 * ── A CONDIÇÃO, E POR QUE ELA NÃO É "TEM FOTO" ────────────────────────────
 *
 * A foto só entra quando o fotógrafo ESCOLHEU uma — arquivo enviado ou foto
 * marcada como capa. Não vale a terceira via, a primeira foto da galeria que a
 * página usa quando ninguém escolheu nada.
 *
 * Sem essa distinção, TODA galeria que hoje usa o preset Revista ganharia uma
 * foto de capa que ninguém pediu, da noite para o dia, incluindo as já
 * entregues. Com ela, quem escolheu recebe o que escolheu e quem não escolheu
 * continua com a capa tipográfica que tem hoje.
 */
console.log("\nA capa jornal:\n");

const comAparencia = async (capa) => {
  await db.query(
    `update galerias set aparencia = jsonb_set(coalesce(aparencia,'{}'::jsonb), '{capa}', $2::jsonb),
            publicada = true, senha_hash = null
      where id = $1`,
    [g.id, JSON.stringify(capa)],
  );
  return (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
};
/* `[^]` e não `[\s\S]`: dentro de um template literal as barras invertidas
   somem antes de o RegExp ver a string, e o recorte casava com nada. */
const capaDoHtml = (html, nome) =>
  html.match(new RegExp(`<header[^>]*data-capa="${nome}"[^]*?</header>`))?.[0] ?? "";

await etapa("sem capa escolhida, a jornal continua só tipografia", async () => {
  await db.query("update galerias set capa_chave = null, capa_media_id = null where id = $1", [g.id]);
  const bloco = capaDoHtml(await comAparencia("jornal"), "jornal");
  if (!bloco) throw new Error("a capa jornal não foi desenhada");
  if (/<img/.test(bloco)) {
    throw new Error("apareceu foto numa galeria que nunca escolheu capa — muda entrega feita");
  }
  return "sem foto, como hoje";
});

await etapa("com capa escolhida, a jornal mostra a foto", async () => {
  await db.query("update galerias set capa_media_id = $2 where id = $1", [g.id, g.midias[0].id]);
  const bloco = capaDoHtml(await comAparencia("jornal"), "jornal");
  if (!/<img/.test(bloco)) throw new Error("escolheu a capa e ela continua sem aparecer");
  if (!/object-position/.test(bloco)) {
    throw new Error("a foto da jornal ignora o ponto focal");
  }
  return "foto + ponto focal";
});

await etapa("a mínima continua sem foto, com capa escolhida ou não", async () => {
  const bloco = capaDoHtml(await comAparencia("minima"), "minima");
  if (/<img/.test(bloco)) throw new Error("a mínima ganhou foto — ela é só tipografia por definição");
  return "só tipografia";
});

await etapa("o aviso da tela não acusa mais a jornal", async () => {
  const { readFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const editor = readFileSync(
    path.join(path.resolve(import.meta.dirname, ".."), "src/components/editor-aparencia.tsx"),
    "utf8",
  );
  /* Do "[" do VALOR até o "]" dele — o `string[]` da anotação de tipo mora
     antes do "=" e engoliria o recorte se a busca começasse no nome. */
  const igual = editor.indexOf("=", editor.indexOf("CAPAS_SEM_FOTO"));
  const abre = editor.indexOf("[", igual);
  const lista = abre < 0 ? "" : editor.slice(abre, editor.indexOf("]", abre) + 1);
  if (/jornal/.test(lista)) {
    throw new Error("a tela ainda diz que a jornal não mostra foto");
  }
  if (!/minima/.test(lista)) throw new Error("a mínima saiu do aviso, e ela continua sem foto");
  return "só a mínima";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ capa da galeria com falha\n" : "\n✓ capa da galeria ok\n");
process.exit(falhou ? 1 : 0);
