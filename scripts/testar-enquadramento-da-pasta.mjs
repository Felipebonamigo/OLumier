/*
 * ── O ENQUADRAMENTO DA CAPA DE CADA PASTA (09/10/2026) ────────────────────
 *
 * Juan, sobre Design → Formato → Pastas:
 *
 *   "A escolha das capas poderia acontecer através de um popup, dando as
 *    opções de escolher foto da galeria ou enviar imagem (ao invés de ter que
 *    rolar a página, tudo aconteceria por um popup)"
 *   "Adicionar opção de escolher o ponto focal da imagem, para poder deixar a
 *    capa da pasta também centralizada da forma que eu quiser."
 *
 * O segundo pedido é o mesmo que ele fez em 08/09 para a capa da GALERIA, e
 * que virou a migração 031. A regra que aquela migração ensinou, e que este
 * arquivo repete para as pastas: trocar a foto TEM de zerar o enquadramento —
 * um foco calibrado para a foto A não quer dizer nada na foto B.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

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
const igual = (a, b, oque) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${oque}: ${JSON.stringify(a)} em vez de ${JSON.stringify(b)}`);
  }
};

console.log("O enquadramento da capa da pasta:\n");

await exigirBancoDeTeste();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const g = await galeriaDaRodada(db, { nome: "foco-da-pasta", medias: 4 });
  await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);
  await db.query("update tenants set formatos_liberados_em = now() where id = $1", [g.tenant_id]);
  const cookie = cookieDeSessao(g.tenant_id);

  const { rows: [secao] } = await db.query(
    "insert into secoes (galeria_id,nome,slug,ordem) values ($1,'Cerimônia','cerimonia',0) returning id",
    [g.id],
  );
  const { rows: [outraSecao] } = await db.query(
    "insert into secoes (galeria_id,nome,slug,ordem) values ($1,'Festa','festa',1) returning id",
    [g.id],
  );
  await db.query("update medias set secao_id=$2 where galeria_id=$1 and ordem < 2", [g.id, secao.id]);
  await db.query("update medias set secao_id=$2 where galeria_id=$1 and ordem >= 2", [g.id, outraSecao.id]);
  const { rows: fotos } = await db.query(
    "select id from medias where galeria_id=$1 and secao_id=$2 order by ordem",
    [g.id, secao.id],
  );

  const foco = async (secaoId) => {
    const { rows } = await db.query("select capa_foco_x, capa_foco_y from secoes where id=$1", [secaoId]);
    return rows[0];
  };
  const rota = (secaoId) => `${BASE}/api/galerias/${g.id}/secoes/${secaoId}/foco`;
  const apontar = (secaoId, corpo, comCookie = true) =>
    fetch(rota(secaoId), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(comCookie ? { cookie } : {}) },
      body: JSON.stringify(corpo),
    });

  /* ── O BANCO ──────────────────────────────────────────────────────────── */

  await etapa("toda pasta nasce com o enquadramento que já tinha — o centro", async () => {
    /* 50/50 é o que o `object-cover` já fazia sozinho. Nenhuma pasta entregue
       muda de cara por causa da migração. */
    igual(await foco(secao.id), { capa_foco_x: 50, capa_foco_y: 50 }, "padrão");
    return "50/50";
  });

  await etapa("o banco recusa um foco fora da faixa — o valor vai para dentro de um style", async () => {
    /* Texto livre ali seria CSS escolhido por quem grava. É a mesma razão da
       migração 031 ter dois smallint com faixa conferida. */
    let motivo = null;
    try {
      await db.query("update secoes set capa_foco_x = 120 where id = $1", [secao.id]);
    } catch (e) {
      motivo = e.message;
    }
    if (motivo === null) {
      await db.query("update secoes set capa_foco_x = 50 where id = $1", [secao.id]);
      throw new Error("aceitou 120% — a faixa não está travada no banco");
    }
    /* Sem esta linha a etapa passava SEM A COLUNA EXISTIR: o update estourava
       com "column does not exist" e o catch dava a trava por provada. */
    if (/does not exist/i.test(motivo)) throw new Error(`barrou pelo motivo errado: ${motivo}`);
    return "0 a 100";
  });

  /* ── A PORTA ──────────────────────────────────────────────────────────── */

  await etapa("sem sessão, ninguém enquadra a pasta de ninguém", async () => {
    const r = await apontar(secao.id, { focoX: 10, focoY: 20 }, false);
    igual(r.status, 401, "status");
    igual(await foco(secao.id), { capa_foco_x: 50, capa_foco_y: 50 }, "não gravou");
    return "401";
  });

  await etapa("capítulo de OUTRO estúdio não existe para esta sessão", async () => {
    const vizinha = await galeriaDaRodada(db, { nome: "foco-vizinha", medias: 1 });
    const { rows: [alheia] } = await db.query(
      "insert into secoes (galeria_id,nome,slug,ordem) values ($1,'Alheia','alheia',0) returning id",
      [vizinha.id],
    );
    const r = await fetch(`${BASE}/api/galerias/${g.id}/secoes/${alheia.id}/foco`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ focoX: 10, focoY: 20 }),
    });
    igual(r.status, 404, "status");
    return "404, e não 403 — não confirma que o id existe";
  });

  await etapa("foco fora da faixa é recusado com 422, antes de chegar ao banco", async () => {
    for (const corpo of [{ focoX: -1, focoY: 50 }, { focoX: 50, focoY: 101 }, { focoX: "meio", focoY: 50 }]) {
      const r = await apontar(secao.id, corpo);
      if (r.status !== 422) throw new Error(`${JSON.stringify(corpo)} veio ${r.status}, esperava 422`);
    }
    igual(await foco(secao.id), { capa_foco_x: 50, capa_foco_y: 50 }, "nada gravado");
    return "422 nos três — pedido bom, valor ruim";
  });

  await etapa("com sessão e valor bom, grava", async () => {
    const r = await apontar(secao.id, { focoX: 25, focoY: 70 });
    igual(r.status, 200, "status");
    igual(await foco(secao.id), { capa_foco_x: 25, capa_foco_y: 70 }, "gravado");
    return "25/70";
  });

  /* ── A REGRA QUE A 031 ENSINOU ────────────────────────────────────────── */

  await etapa("trocar a foto da capa ZERA o enquadramento", async () => {
    /* Um foco calibrado para a foto A não quer dizer nada na foto B. Sem isto,
       trocar a capa deixa a foto nova cortada por uma decisão tomada sobre
       outra imagem — e ninguém entende por que ela saiu torta. */
    /* A etapa suja o foco ELA MESMA: depender da etapa anterior fazia esta
       passar de graça quando aquela falhava — o foco nunca saía de 50/50 e o
       "voltou ao centro" dava verdadeiro sem nada ter voltado. */
    await db.query("update secoes set capa_foco_x = 30, capa_foco_y = 90 where id = $1", [secao.id]);
    const { definirCapaDaPasta } = await import("../src/lib/secoes.ts");
    const r = await definirCapaDaPasta(g.id, g.tenant_id, fotos[1].id);
    if (!r.ok) throw new Error("a troca de capa não aconteceu");
    igual(await foco(secao.id), { capa_foco_x: 50, capa_foco_y: 50 }, "voltou ao centro");
    return "zerado";
  });

  /* ── E A GALERIA DO CLIENTE USA ───────────────────────────────────────── */

  await etapa("a capa da pasta sai cortada no ponto escolhido", async () => {
    await db.query(
      `update galerias set aparencia = coalesce(aparencia,'{}'::jsonb)
         || jsonb_build_object('formato','pastas','estiloPastas','capas') where id = $1`,
      [g.id],
    );
    await db.query("update secoes set capa_foco_x = 20, capa_foco_y = 80 where id = $1", [secao.id]);
    const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
    if (!/20%\s*80%/.test(html)) {
      throw new Error("o enquadramento escolhido não chegou à galeria do cliente");
    }
    return "20% 80% na página";
  });
  /* ── O POP-UP (item 1 do Juan) ──────────────────────────────────────── */

  /*
   * Estas duas etapas leem a FONTE, e isso é escolha, não preguiça: o editor de
   * aparência não é desenhado no servidor. Medido — a tela de Design chega com
   * 78 KB de HTML e sem "Publicar aparência", sem "Estilo das pastas" e sem a
   * área das capas: tudo nasce depois, no navegador. Uma etapa que buscasse o
   * pop-up no HTML estaria medindo uma página que nunca o teve, e a primeira
   * versão destas duas fazia exatamente isso.
   *
   * O que elas guardam é o que o Juan pediu: que a escolha NÃO volte a ser um
   * painel empurrando a página.
   */
  await etapa("a escolha da capa abre num pop-up, e não empurra a página", async () => {
    const fonte = await readFile(new URL("../src/components/entrega-no-design.tsx", import.meta.url), "utf8");
    if (!/<dialog/.test(fonte)) {
      throw new Error("a área das capas não tem pop-up — voltou a ser painel na página");
    }
    /* O escolhedor tem de estar DENTRO do pop-up. Antes ele era irmão da grade
       de pastas, e era isso que empurrava a página para baixo. */
    const i = fonte.indexOf("<dialog");
    const f = fonte.indexOf("</dialog>", i);
    if (f === -1) throw new Error("não achei o pop-up inteiro");
    if (!/<FotosParaCapa/.test(fonte.slice(i, f))) {
      throw new Error("o escolhedor de fotos está fora do pop-up — a página continua sendo empurrada");
    }
    return "escolhedor dentro do pop-up";
  });

  await etapa("e o enquadramento mora dentro dele — é lá que o fotógrafo chega nele", async () => {
    const fonte = await readFile(new URL("../src/components/entrega-no-design.tsx", import.meta.url), "utf8");
    if (!/EnquadrarCapaDaPasta/.test(fonte)) {
      throw new Error("não existe enquadramento na área das capas");
    }
    /* Ele só faz sentido com capa já escolhida: apontar o centro de uma imagem
       que não existe é apontar para o nada. */
    if (!/pasta\.capa && \(\s*<EnquadrarCapaDaPasta/.test(fonte.replace(/\s+/g, " "))) {
      throw new Error("o enquadramento aparece mesmo sem capa escolhida");
    }
    return "enquadramento com capa, dentro do pop-up";
  });

} finally {
  await limparRodada(db);
  await db.end();
}

if (vermelhas) {
  console.log(`\n✗ ${vermelhas} vermelha(s)\n`);
  process.exit(1);
}
console.log("\n✓ o enquadramento da capa da pasta\n");
