/*
 * ── AS PASTAS PRECISAM CABER NA TELA (07–08/10/2026) ──────────────────────
 *
 * Juan, com o vídeo da galeria Flor da Luz no celular:
 *
 *   "Eu queria poder ver as pastas sem ser assim"
 *   "Tipo uma versão 'compacta'. Sem ficar tão grande a pasta"
 *
 * Medido naquela galeria, num celular de 812 px de altura: cada pasta ocupava
 * 429 px. Menos de duas por tela, e as 20 pastas dela davam DOZE telas de
 * rolagem só para ver a LISTA do que existe, antes de abrir nada.
 *
 * ── A PRIMEIRA RESPOSTA ESTAVA ERRADA, E ELE DISSE ────────────────────────
 *
 * Saiu uma "Lista": uma linha por pasta, 81 px. Compacta, e não era o que ele
 * imaginava:
 *
 *   "O formato lista tá muito parecido com o índice. Entre eles o índice tá
 *    mais bonito."
 *   "A distribuição visual do capas poderia ser mais compacta... no celular
 *    fica apenas uma por tela, poderia ser 2 ou 3. Semelhante à distribuição
 *    visual do feed do instagram."
 *
 * Então a Lista saiu — ela nasceu de uma recomendação, não de um pedido, e o
 * próprio Índice já fazia aquilo melhor — e entrou o FEED: grade de dois no
 * celular, três no computador. Este arquivo guarda as duas coisas: que a
 * compacta é compacta DE VERDADE, e que a Lista não voltou pela porta dos
 * fundos.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import * as ap from "../src/config/aparencia.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let vermelhas = 0;
async function etapa(nome, fn) {
  try {
    const nota = await fn();
    console.log(`  ✓ ${nome}${nota ? ` — ${nota}` : ""}`);
  } catch (e) {
    vermelhas++;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

console.log("As pastas em Feed:\n");

/* ── O EIXO ──────────────────────────────────────────────────────────────── */

await etapa("'feed' é um estilo de pasta que o editor aceita", () => {
  const lido = ap.lerAparencia({ formato: "pastas", estiloPastas: "feed" });
  if (lido.estiloPastas !== "feed") {
    throw new Error(`lerAparencia devolveu "${lido.estiloPastas}" — o eixo não conhece 'feed'`);
  }
  return "aceito";
});

await etapa("e ele aparece na lista de opções, senão ninguém o escolhe", () => {
  const ids = ap.OPCOES.estiloPastas.map((o) => o.id);
  if (!ids.includes("feed")) throw new Error(`as opções são ${ids.join(", ")}`);
  const o = ap.OPCOES.estiloPastas.find((x) => x.id === "feed");
  if (!o.nome || !o.desc) throw new Error("sem nome ou sem descrição — o editor mostra os dois");
  return `${o.nome}: ${o.desc}`;
});

await etapa("a Lista não existe mais — era parecida demais com o Índice", () => {
  /* Juan: "entre eles o índice tá mais bonito". Quando ela saiu, nenhuma
     galeria a usava — conferido em produção antes de tirar. */
  const ids = ap.OPCOES.estiloPastas.map((o) => o.id);
  if (ids.includes("lista")) throw new Error("a Lista voltou para as opções");
  if (ap.lerAparencia({ estiloPastas: "lista" }).estiloPastas !== "pilha") {
    throw new Error("o eixo ainda aceita 'lista'");
  }
  return `restam: ${ids.join(", ")}`;
});

await etapa("as galerias já entregues não mudam de estilo", () => {
  if (ap.APARENCIA_PADRAO.estiloPastas !== "pilha") {
    throw new Error(`o padrão virou "${ap.APARENCIA_PADRAO.estiloPastas}"`);
  }
  const mudados = ap.PRESETS.filter((p) => p.aparencia.estiloPastas === "feed").map((p) => p.nome ?? p.id);
  if (mudados.length) throw new Error(`presets trocados sem pedir: ${mudados.join(", ")}`);
  return "padrão intacto";
});

/* ── E A TELA ────────────────────────────────────────────────────────────── */

await exigirBancoDeTeste();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const g = await galeriaDaRodada(db, { nome: "compactas", medias: 6 });
  await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);
  await db.query("update tenants set formatos_liberados_em = now() where id = $1", [g.tenant_id]);

  const nomes = ["Cerimônia", "Festa", "Ensaio"];
  const secoes = [];
  for (const [i, nome] of nomes.entries()) {
    const { rows: [s] } = await db.query(
      "insert into secoes (galeria_id,nome,slug,ordem) values ($1,$2,$3,$4) returning id",
      [g.id, nome, ["cerimonia", "festa", "ensaio"][i], i],
    );
    secoes.push(s.id);
  }
  for (const [i, id] of secoes.entries()) {
    await db.query("update medias set secao_id=$2 where galeria_id=$1 and ordem >= $3 and ordem < $4", [
      g.id, id, i * 2, i * 2 + 2,
    ]);
  }

  const comEstilo = async (estilo) => {
    await db.query(
      `update galerias set aparencia = coalesce(aparencia,'{}'::jsonb)
         || jsonb_build_object('formato','pastas','estiloPastas',$2::text) where id = $1`,
      [g.id, estilo],
    );
    const r = await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status} na galeria`);
    return r.text();
  };

  await etapa("o feed mostra TODAS as pastas — compacto não é esconder", async () => {
    const html = await comEstilo("feed");
    const faltando = nomes.filter((n) => !html.includes(n));
    if (faltando.length) throw new Error(`sumiram: ${faltando.join(", ")}`);
    return `${nomes.length} pastas`;
  });

  await etapa("e cada uma continua levando para dentro dela", async () => {
    const html = await comEstilo("feed");
    const faltando = ["cerimonia", "festa", "ensaio"].filter((s) => !html.includes(s));
    if (faltando.length) throw new Error(`sem link para: ${faltando.join(", ")}`);
    return "3 links";
  });

  await etapa("no CELULAR são duas por fileira — é o pedido, e é onde dói", async () => {
    /*
     * A queixa do Juan é do celular: "no computador fica lindo, no celular
     * não... fica apenas uma por tela". O Capas usa `sm:grid-cols-2`, que só
     * vale a partir de 640 px — abaixo disso, uma coluna. O Feed tem de
     * começar em duas, sem prefixo de tamanho.
     */
    const html = await comEstilo("feed");
    /* A classe tem de estar NA LISTA das pastas. `grid-cols-2` solto existe
       em outros cantos da página — a primeira versão desta etapa passou com o
       Feed ainda nem existindo, lendo a classe de outro elemento. */
    const ondeAbre = html.indexOf("cerimonia");
    if (ondeAbre === -1) throw new Error("não achei a lista de pastas no HTML");
    const abreLista = Math.max(html.lastIndexOf("<ul", ondeAbre), html.lastIndexOf("<ol", ondeAbre));
    if (abreLista === -1) throw new Error("a lista de pastas não é uma ul/ol");
    const classe = /class="([^"]*)"/.exec(html.slice(abreLista, ondeAbre))?.[1] ?? "";
    if (!/(^| )grid-cols-2( |$)/.test(classe)) {
      throw new Error(`a lista das pastas tem a classe "${classe}" — sem duas colunas no celular`);
    }
    return "duas colunas desde o celular";
  });

  await etapa("o que fazia a pasta ter 429 px não é desenhado aqui", async () => {
    /* É o retrato 4/5 por pasta que empurra a altura. Sem esta etapa bastaria
       copiar o Capas e trocar o nome para o teste passar. */
    const feed = await comEstilo("feed");
    const capas = await comEstilo("capas");
    const conta = (h) => (h.match(/aspect-\[4\/5\]/g) ?? []).length;
    if (conta(capas) === 0) throw new Error("o Capas deixou de usar o retrato — a comparação perdeu o sentido");
    if (conta(feed) > 0) throw new Error(`o feed ainda desenha ${conta(feed)} retrato(s) 4/5`);
    return `capas ${conta(capas)} · feed 0`;
  });

  await etapa("a foto continua lá — é ela que diz qual pasta é qual", async () => {
    const html = await comEstilo("feed");
    if (!/<img[^>]+src="[^"]+"/.test(html)) throw new Error("nenhuma imagem no feed");
    return "com foto";
  });

  await etapa("e o nome da pasta aparece junto da foto", async () => {
    /* Feed do Instagram não tem legenda na grade; aqui tem, e é de propósito:
       pasta sem nome obriga a abrir para descobrir o que é. */
    const html = await comEstilo("feed");
    const faltando = nomes.filter((n) => !html.includes(n));
    if (faltando.length) throw new Error(`pasta sem nome: ${faltando.join(", ")}`);
    return "nome em cada uma";
  });
} finally {
  await limparRodada(db);
  await db.end();
}

if (vermelhas) {
  console.log(`\n✗ ${vermelhas} vermelha(s)\n`);
  process.exit(1);
}
console.log("\n✓ as pastas cabem na tela\n");
