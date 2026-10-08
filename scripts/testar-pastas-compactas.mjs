/*
 * ── AS PASTAS PRECISAM CABER NA TELA (07/10/2026) ─────────────────────────
 *
 * Juan, com o vídeo da galeria Flor da Luz no celular:
 *
 *   "Eu queria poder ver as pastas sem ser assim"
 *   "Tipo uma versão 'compacta'"
 *   "Sem ficar tão grande a pasta"
 *
 * Medido naquela galeria, num celular de 812 px de altura: cada pasta ocupa
 * 429 px. Menos de duas por tela, e as 20 pastas dela dão 9.777 px — DOZE
 * telas de rolagem só para ver a LISTA do que existe, antes de abrir nada.
 *
 * Os quatro estilos que existiam desenham uma imagem 4/5 grande por pasta:
 * nenhum deles resolvia isso, então entra um quinto, e não um ajuste nos
 * outros — mexer nos quatro mudaria a cara de galeria já entregue.
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

console.log("As pastas compactas:\n");

/* ── O EIXO ──────────────────────────────────────────────────────────────── */

await etapa("'lista' é um estilo de pasta que o editor aceita", () => {
  const lido = ap.lerAparencia({ formato: "pastas", estiloPastas: "lista" });
  if (lido.estiloPastas !== "lista") {
    throw new Error(`lerAparencia devolveu "${lido.estiloPastas}" — o eixo não conhece 'lista'`);
  }
  return "aceito";
});

await etapa("e ele aparece na lista de opções, senão ninguém o escolhe", () => {
  const ids = ap.OPCOES.estiloPastas.map((o) => o.id);
  if (!ids.includes("lista")) throw new Error(`as opções são ${ids.join(", ")}`);
  const o = ap.OPCOES.estiloPastas.find((x) => x.id === "lista");
  if (!o.nome || !o.desc) throw new Error("sem nome ou sem descrição — o editor mostra os dois");
  return `${o.nome}: ${o.desc}`;
});

await etapa("as galerias já entregues não mudam de estilo", () => {
  /* O padrão continua sendo o de sempre. Um estilo novo que vira padrão
     redesenha, de uma vez, toda entrega que já está no ar. */
  if (ap.APARENCIA_PADRAO.estiloPastas !== "pilha") {
    throw new Error(`o padrão virou "${ap.APARENCIA_PADRAO.estiloPastas}"`);
  }
  /* E os presets também seguem com o que escolheram. */
  const mudados = ap.PRESETS.filter((p) => p.aparencia.estiloPastas === "lista").map((p) => p.nome ?? p.id);
  if (mudados.length) throw new Error(`presets trocados sem pedir: ${mudados.join(", ")}`);
  return "padrão intacto";
});

await etapa("estilo inventado continua caindo no padrão", () => {
  if (ap.lerAparencia({ estiloPastas: "minusculo" }).estiloPastas !== "pilha") {
    throw new Error("aceitou um estilo que não existe");
  }
  return "recusado";
});

/* ── E A TELA ────────────────────────────────────────────────────────────── */

await exigirBancoDeTeste();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const g = await galeriaDaRodada(db, { nome: "compactas", medias: 6 });
  await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);
  await db.query("update tenants set formatos_liberados_em = now() where id = $1", [g.tenant_id]);

  /* Pastas só existem a partir de duas. Três, para a conta de altura falar. */
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

  await etapa("compacta mostra TODAS as pastas — compacto não é esconder", async () => {
    const html = await comEstilo("lista");
    const faltando = nomes.filter((n) => !html.includes(n));
    if (faltando.length) throw new Error(`sumiram: ${faltando.join(", ")}`);
    return `${nomes.length} pastas`;
  });

  await etapa("e cada uma continua levando para dentro dela", async () => {
    const html = await comEstilo("lista");
    const faltando = ["cerimonia", "festa", "ensaio"].filter((s) => !html.includes(s));
    if (faltando.length) throw new Error(`sem link para: ${faltando.join(", ")}`);
    return "3 links";
  });

  await etapa("o que fazia a pasta ter 429 px não é desenhado aqui", async () => {
    /*
     * É o retrato 4/5 por pasta que empurra a altura nos outros quatro
     * estilos. Esta etapa é a diferença entre "fiz um estilo novo" e "fiz um
     * estilo novo que de fato é compacto" — sem ela, bastaria copiar o Índice
     * e trocar o nome para o teste passar.
     */
    const compacta = await comEstilo("lista");
    const indice = await comEstilo("indice");
    const conta = (h) => (h.match(/aspect-\[4\/5\]/g) ?? []).length;
    if (conta(indice) === 0) throw new Error("o Índice deixou de usar o retrato — a comparação perdeu o sentido");
    if (conta(compacta) > 0) {
      throw new Error(`a compacta ainda desenha ${conta(compacta)} retrato(s) 4/5`);
    }
    return `índice ${conta(indice)} · compacta 0`;
  });

  await etapa("a compacta ainda mostra a foto — o cliente precisa reconhecer a pasta", async () => {
    /* Lista de texto puro seria mais curta e diria menos: "Festa · 2 fotos"
       não ajuda ninguém a lembrar qual pasta é qual. */
    const html = await comEstilo("lista");
    if (!/<img[^>]+src="[^"]+"/.test(html)) throw new Error("nenhuma imagem na lista compacta");
    return "com miniatura";
  });

  await etapa("trocar de estilo não mexe em mais nada da galeria", async () => {
    const compacta = await comEstilo("lista");
    if (!compacta.includes(g.titulo)) throw new Error("o título da galeria sumiu");
    return "título no lugar";
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
