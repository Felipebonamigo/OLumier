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
  /* Sem limite nem prazo, favorita é favorita: nada para encerrar
     (28/09/2026 — ver `EstadoSelecao.combinada`). */
  if (/Terminei minha escolha/.test(b)) {
    throw new Error("oferece encerrar a escolha numa galeria sem escolha combinada");
  }
  return "filtro, sem encerrar";
});

await etapa("com um número combinado, o menu oferece encerrar a escolha", async () => {
  await db.query("update galerias set selecao_limite = 30 where id = $1", [g.id]);
  try {
    const b = await barra();
    if (!/Terminei minha escolha/.test(b)) throw new Error("o menu não traz o encerrar a escolha");
  } finally {
    await db.query("update galerias set selecao_limite = null where id = $1", [g.id]);
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
     enfeite — e some para não anunciar um comando que não responde. Com um
     número combinado: sem limite nem prazo não existe escolha para encerrar
     (28/09/2026 — ver `EstadoSelecao.combinada`). */
  await db.query("update galerias set selecao_limite = 30, selecao_fechada_em = now() where id = $1", [g.id]);
  try {
    const b = await barra();
    if (/<summary[^>]*>[^]*?Favoritas[^]*?<\/summary>/.test(b)) {
      throw new Error("o menu Favoritas ficou, sem ter o que oferecer");
    }
    return "some";
  } finally {
    await db.query("update galerias set selecao_limite = null, selecao_fechada_em = null where id = $1", [g.id]);
  }
});

await etapa("um 'terminei' antigo sem número combinado não esconde as favoritas", async () => {
  /* A galeria da Carol: encerrada por um clique, sem limite nem prazo. Os
     corações e o menu têm de continuar lá. */
  await db.query("update galerias set selecao_fechada_em = now() where id = $1", [g.id]);
  try {
    const b = await barra();
    if (!/<summary[^>]*>[^]*?Favoritas[^]*?<\/summary>/.test(b)) throw new Error("o menu Favoritas sumiu");
    if (/Escolha encerrada/.test(await pegar())) throw new Error("a galeria diz 'Escolha encerrada'");
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

/*
 * ── A PASTILHA ACESA É A DO CAPÍTULO QUE OCUPA A TELA (21/09/2026) ────────
 *
 * Felipe, com o print da barra: "lá em cima tá marcado making of e ali aparece
 * decoração. A pessoa já tá vendo o capítulo da decoração".
 *
 * A regra antiga era uma FAIXA (10% a 55% da tela) e, entre os capítulos que a
 * cruzavam, o PRIMEIRO da galeria — bastava sobrar uma fileira do anterior lá
 * em cima para ele vencer. Medido no navegador: 10 de 24 pontos ao longo de
 * quatro capítulos acendiam a pastilha errada; com a regra por ÁREA VISÍVEL,
 * 0 de 24.
 *
 * Esta etapa não abre navegador — ela prende o MECANISMO, porque o defeito era
 * o mecanismo: quem decide não pode ser "o primeiro que cruza uma faixa".
 */
await etapa("o capítulo aceso é decidido por área visível, não por faixa", async () => {
  const fonte = await import("node:fs/promises").then((fs) =>
    fs.readFile("src/components/menus-da-galeria.tsx", "utf8"),
  );
  if (/rootMargin/.test(fonte)) {
    throw new Error("voltou a decidir por faixa — a barra fica um capítulo atrás do que se lê");
  }
  if (!/Math\.min\(r\.bottom, base\) - Math\.max\(r\.top, topo\)/.test(fonte)) {
    throw new Error("não achei a conta da área visível abaixo da barra");
  }
  /* Só limiares de visibilidade deixavam a barra parada quando a rolagem não
     cruzava nenhum deles — medido, numa emenda em cada cinco. */
  if (!/addEventListener\("scroll"/.test(fonte)) {
    throw new Error("sem ouvir a rolagem, a pastilha trava entre um limiar e outro");
  }
  return "área visível + rolagem + observador";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ os menus da galeria têm problema" : "\n✓ menus da galeria ok");
process.exit(falhou ? 1 : 0);
