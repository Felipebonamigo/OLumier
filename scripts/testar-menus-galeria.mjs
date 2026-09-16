#!/usr/bin/env node
/**
 * A BARRA DE MENUS NO INÍCIO DA GALERIA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-menus-galeria.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (10/09/2026) ─────────────────────────────────────────────────
 *
 * Juan: "Criar um sistema de MENUS no início da galeria. MENU das fotos
 * favoritas. MENU do download das fotos. Pra poder escolher se será feito
 * todas de uma única vez ou se será separado em pastas. (estou pensando para o
 * PC)".
 *
 * ── O QUE ISSO ARRUMA ─────────────────────────────────────────────────────
 *
 * Antes da barra, o começo da galeria era uma PILHA: o botão de baixar tudo, o
 * aviso do limite, a busca por rosto, a linha das favoritas, o menu de
 * capítulos. Cinco blocos empilhados que empurravam as fotos para baixo, cada
 * um aparecendo e sumindo por conta própria — e a primeira coisa que o cliente
 * via depois da capa era um amontoado de controle em vez das fotos.
 *
 * Uma barra, com os comandos guardados atrás de dois nomes, devolve a tela às
 * fotos e ainda deixa tudo a um clique de distância enquanto se rola a página.
 *
 * ── POR QUE `<details>`, E NÃO UM MENU DE JAVASCRIPT ──────────────────────
 *
 * Porque o navegador já tem um: abre no clique, abre no Enter, anda com Tab,
 * e o conteúdo existe no HTML mesmo fechado — que é o que permite a este
 * arquivo conferir os itens sem abrir navegador nenhum. Um menu escrito à mão
 * custaria estado, foco, tecla Esc e clique fora, para chegar no mesmo lugar.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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

const g = await galeriaDaRodada(db, { nome: "menus", medias: 4, publicada: true });
await db.query("update galerias set senha_hash = null, permite_download = true where id = $1", [
  g.id,
]);

const pegar = async () => {
  const r = await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`a galeria respondeu ${r.status}`);
  return r.text();
};

/** A barra inteira. Nada de `<nav>` aninhado dentro dela, ou isto para no meio. */
const barra = async () => {
  const html = await pegar();
  const b = html.match(/<nav[^>]*aria-label="Menu da galeria"[^]*?<\/nav>/)?.[0];
  if (!b) throw new Error('não achei <nav aria-label="Menu da galeria">');
  return b;
};

console.log("A barra de menus:\n");

await etapa("a galeria abre com a barra", async () => {
  const b = await barra();
  return `${b.length} caracteres`;
});

await etapa("a barra gruda no topo enquanto se rola", async () => {
  const b = await barra();
  if (!/\bsticky\b/.test(b)) throw new Error("a barra não é sticky — some ao rolar");
});

await etapa("o menu das FAVORITAS está lá", async () => {
  const b = await barra();
  if (!/<summary[^>]*>[^]*?Favoritas[^]*?<\/summary>/.test(b)) {
    throw new Error("não achei o menu Favoritas");
  }
  /* O conteúdo tem de vir no HTML mesmo fechado — é o que `<details>` dá de
     graça, e é o que faz este arquivo poder conferir os itens. */
  if (!/Ver só as favoritas/.test(b)) throw new Error("o menu não traz o filtro das favoritas");
  if (!/Terminei minha escolha/.test(b)) {
    throw new Error("o menu não traz o encerrar a escolha");
  }
  return "filtro + encerrar";
});

await etapa("o menu do DOWNLOAD está lá, com o baixar tudo dentro", async () => {
  const b = await barra();
  if (!/<summary[^>]*>[^]*?Baixar[^]*?<\/summary>/.test(b)) {
    throw new Error("não achei o menu Baixar");
  }
  if (!/Todas as fotos num zip \(4\)/.test(b)) {
    throw new Error("o menu não traz o baixar tudo com a contagem");
  }
  return "Todas as fotos num zip (4)";
});

await etapa("sem download liberado, o menu Baixar não existe", async () => {
  await db.query("update galerias set permite_download = false where id = $1", [g.id]);
  try {
    const b = await barra();
    if (/<summary[^>]*>[^]*?Baixar[^]*?<\/summary>/.test(b)) {
      throw new Error("o menu Baixar apareceu numa galeria sem download");
    }
    /* E o outro continua: a barra não pode sumir junto. */
    if (!/Favoritas/.test(b)) throw new Error("a barra perdeu o menu Favoritas junto");
    return "só Favoritas";
  } finally {
    await db.query("update galerias set permite_download = true where id = $1", [g.id]);
  }
});

await etapa("escolha encerrada e nenhuma favorita: sem menu Favoritas", async () => {
  /* Um menu que só teria a frase "escolha encerrada" dentro não é menu, é
     enfeite — e some para não anunciar um comando que não responde. */
  await db.query("update galerias set selecao_fechada_em = now() where id = $1", [g.id]);
  try {
    const b = await barra();
    if (/<summary[^>]*>[^]*?Favoritas[^]*?<\/summary>/.test(b)) {
      throw new Error("o menu Favoritas ficou, sem ter o que oferecer");
    }
    return "some";
  } finally {
    await db.query("update galerias set selecao_fechada_em = null where id = $1", [g.id]);
  }
});

console.log("\nOs capítulos:\n");

await etapa("com mais de um capítulo, eles moram NA MESMA barra", async () => {
  /* Duas barras grudadas no topo brigariam pelo mesmo lugar — e o cliente
     ganharia duas faixas de controle sobre as fotos em vez de uma. */
  const { rows } = await db.query(
    `insert into secoes (galeria_id, nome, ordem)
          values ($1, 'Cerimônia', 1), ($1, 'Festa', 2) returning id`,
    [g.id],
  );
  await db.query("update medias set secao_id = $2 where id = $1", [g.midias[0].id, rows[0].id]);
  await db.query("update medias set secao_id = $2 where id = $1", [g.midias[1].id, rows[1].id]);
  try {
    const b = await barra();
    for (const nome of ["Cerimônia", "Festa"]) {
      if (!b.includes(nome)) throw new Error(`o capítulo "${nome}" ficou fora da barra`);
    }
    return "Cerimônia, Festa";
  } finally {
    await db.query("update medias set secao_id = null where galeria_id = $1", [g.id]);
    await db.query("delete from secoes where galeria_id = $1", [g.id]);
  }
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ os menus da galeria têm problema" : "\n✓ menus da galeria ok");
process.exit(falhou ? 1 : 0);
