#!/usr/bin/env node
/**
 * Testa capítulos. Uso:
 *   node --env-file=.env.local scripts/testar-secoes.mjs
 *
 * O comportamento mais importante aqui é o de APAGAR: o fotógrafo precisa poder
 * apagar um capítulo sem medo de levar as fotos junto.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { readFileSync } from "node:fs";
import { criarSecao, garantirSecoes } from "../src/lib/secoes.ts";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

/* Bancada propria desta execucao — antes: a galeria mais antiga do banco.
 * Ver fixture-de-teste.mjs. */
const bancada = await galeriaDaRodada(db);
const galeriaId = bancada.id, tenantId = bancada.estudio.id, gslug = bancada.gslug, tslug = bancada.tslug;
const url = `${BASE}/g/${tslug}/${gslug}`;

await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [galeriaId]);
await db.query("delete from secoes where galeria_id = $1", [galeriaId]);

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
const texto = async (r) =>
  (await r.text()).replace(/<[^>]+>/g, " ").replaceAll("&amp;", "&").replace(/\s+/g, " ");

const { rows: fotos } = await db.query(
  "select id from medias where galeria_id = $1 and pronto order by criado_em",
  [galeriaId],
);
if (fotos.length < 2) {
  console.error("✗ preciso de ao menos 2 fotos na galeria para testar");
  process.exit(1);
}

let capA, capB;

await etapa("cria capítulos em ordem", async () => {
  const r = await db.query(
    `insert into secoes (galeria_id, nome, ordem, slug)
     values ($1,'Cerimônia',0,'cerimonia'), ($1,'Festa',1,'festa') returning id, nome, slug`,
    [galeriaId],
  );
  [capA, capB] = r.rows;
  return `${r.rows.map((s) => s.nome).join(" · ")}`;
});

await etapa("capítulo repetido é recusado, mesmo trocando maiúscula", async () => {
  /* "Making Of" e "Making of" são o mesmo capítulo para qualquer humano, e o
   * banco os aceitava como dois. O estrago não é no painel — é no menu que o
   * casal vê, com duas entradas de mesmo nome e as fotos partidas entre elas.
   *
   * A comparação ignora caixa E espaço nas pontas: quem digita rápido erra
   * nesses dois, e são justamente os que não mudam o nome aos olhos de ninguém. */
  const primeiro = await criarSecao(galeriaId, tenantId, "Making Of");
  if (!primeiro) throw new Error("não criou nem o primeiro capítulo");

  const repetido = await criarSecao(galeriaId, tenantId, "  making of  ");
  if (repetido) {
    await db.query("delete from secoes where id = any($1)", [[primeiro.id, repetido.id]]);
    throw new Error(`criou "${repetido.nome}" com "Making Of" já existindo`);
  }

  await db.query("delete from secoes where id = $1", [primeiro.id]);
  return "recusou a repetição";
});

await etapa("capítulo vazio não vira seção em branco na página", async () => {
  const t = await texto(await fetch(url, { cache: "no-store" }));
  if (t.includes("Cerimônia")) throw new Error("mostrou capítulo sem fotos");
  return "escondido";
});

await etapa("fotos movidas aparecem sob o capítulo", async () => {
  await db.query("update medias set secao_id = $1 where id = $2", [capA.id, fotos[0].id]);
  await db.query("update medias set secao_id = $1 where id = $2", [capB.id, fotos[1].id]);
  const t = await texto(await fetch(url, { cache: "no-store" }));
  if (!t.includes("Cerimônia") || !t.includes("Festa")) throw new Error("capítulos não apareceram");
  return "Cerimônia e Festa na página";
});

/*
 * OS CAPÍTULOS MUDARAM DE CASA EM 10/09/2026. Eram uma barra própria, grudada
 * no topo; hoje são a segunda linha da BARRA DE MENUS que o Juan pediu — duas
 * faixas grudadas no mesmo lugar brigariam pelo topo da tela.
 *
 * ── E DEIXARAM DE SER ÂNCORA EM 21/09/2026 ────────────────────────────────
 *
 * Juan: "quando chega no fim do capítulo ele está trocando sozinho". Felipe:
 * "poderia encerrar o capítulo 'making of' e ter um botão 'próximo capítulo'".
 *
 * A pastilha era `#cap-<id>`: rolava até a seção e o visitante entrava no
 * capítulo seguinte sem escolher. Agora ela é o ENDEREÇO do capítulo, que abre
 * só ele — em qualquer tamanho de galeria, e não só acima do teto de 600.
 */
const barraDeMenus = (html) =>
  html.match(/<nav[^>]*aria-label="Menu da galeria"[^]*?<\/nav>/)?.[0] ?? "";

await etapa("menu de navegação aparece com 2+ capítulos", async () => {
  const html = await (await fetch(url, { cache: "no-store" })).text();
  if (html.includes(`#cap-${capA.id}"`)) throw new Error("a pastilha voltou a ser âncora");
  const link = `/g/${tslug}/${gslug}/${capA.slug}`;
  if (!html.includes(link)) throw new Error(`sem o endereço do capítulo (${link})`);
  const barra = barraDeMenus(html);
  if (!barra) throw new Error("sem a barra de menus");
  if (!barra.includes(link)) throw new Error("o endereço do capítulo ficou fora da barra");
  return `${link} na barra`;
});

await etapa("ordem do fotógrafo é respeitada na página", async () => {
  const t = await texto(await fetch(url, { cache: "no-store" }));
  /* Basta a primeira ocorrência de cada nome: as duas primeiras são as pastilhas
     da barra, na ordem em que a barra as desenha. */
  const posCerimonia = t.indexOf("Cerimônia");
  const posFesta = t.indexOf("Festa");
  if (posCerimonia === -1 || posFesta === -1) throw new Error("capítulos não localizados");
  if (posCerimonia > posFesta) throw new Error("ordem invertida");

  // inverte a ordem e confere que a página acompanha
  await db.query("update secoes set ordem = 1 where id = $1", [capA.id]);
  await db.query("update secoes set ordem = 0 where id = $1", [capB.id]);
  const t2 = await texto(await fetch(url, { cache: "no-store" }));
  if (t2.indexOf("Festa") > t2.indexOf("Cerimônia")) {
    throw new Error("não acompanhou a reordenação");
  }
  await db.query("update secoes set ordem = 0 where id = $1", [capA.id]);
  await db.query("update secoes set ordem = 1 where id = $1", [capB.id]);
  return "reordenar muda a página";
});

/*
 * `garantirSecoes` é o que o envio de pasta usa: ele lê "01 Making Of",
 * "02 Cerimônia" do disco e precisa dos ids para carimbar cada foto. Chamar
 * `criarSecao` direto não serve — ela devolve null tanto para "nome vazio"
 * quanto para "já existe", e o envio precisa do id da que já existe, não de um
 * erro. Sem isto, a segunda leva de fotos da mesma pasta perderia o capítulo.
 */
/*
 * ── FOTO SOLTA NÃO PODE VIRAR PASTILHA SEM NOME (04/09/2026) ──────────────
 *
 * O sócio: "as fotos subidas sem capítulo devem ir obrigatoriamente para um
 * capítulo. Ou organizar isso."
 *
 * O defeito concreto era o menu: as fotos sem capítulo entravam na lista de
 * capítulos com `nome: ""`, e o menu do cliente — que só aparece com dois ou
 * mais — desenhava uma pastilha VAZIA no meio das outras. Um botão sem texto
 * que leva a algum lugar.
 *
 * A saída não é obrigar o fotógrafo a escolher no envio (atrito no pior
 * momento), nem mover as fotos sozinho (mexer no trabalho dele sem pedir). É
 * dar nome ao grupo quando ele convive com capítulos, e dar um botão de um
 * clique no painel para quem quiser arrumar.
 */
await etapa("com capítulos, as fotos soltas ganham nome em vez de pastilha vazia", async () => {
  /* Uma foto fora de qualquer capítulo, e pelo menos um capítulo existindo. */
  await db.query("update medias set secao_id = null where id = $1", [fotos[0].id]);
  const html = await (await fetch(url, { cache: "no-store" })).text();
  const nav = barraDeMenus(html);
  if (!nav) throw new Error("o menu de capítulos sumiu");
  /* `>​<` entre a abertura e o fechamento do link é a pastilha sem texto. */
  if (/>\s*<\/a>/.test(nav)) throw new Error("ainda há uma pastilha sem nome no menu");
  if (!nav.includes("Outras fotos")) throw new Error("o grupo das soltas não recebeu nome");
  return "as soltas viram “Outras fotos”";
});

await etapa("SEM capítulo nenhum, a galeria segue sem título — nada de “Outras fotos”", async () => {
  const { rows: guardadas } = await db.query(
    "select id, secao_id from medias where galeria_id = $1 and secao_id is not null",
    [galeriaId],
  );
  await db.query("update medias set secao_id = null where galeria_id = $1", [galeriaId]);
  const { rows: secoesAntes } = await db.query(
    "select id, nome, ordem from secoes where galeria_id = $1 order by ordem",
    [galeriaId],
  );
  await db.query("delete from secoes where galeria_id = $1", [galeriaId]);

  const html = await (await fetch(url, { cache: "no-store" })).text();
  if (html.includes("Outras fotos")) {
    throw new Error("galeria de fluxo único ganhou um título que não pediu");
  }

  /* Devolve a bancada ao estado anterior — as etapas seguintes contam com ela. */
  for (const s of secoesAntes) {
    await db.query("insert into secoes (id, galeria_id, nome, ordem) values ($1,$2,$3,$4)", [
      s.id,
      galeriaId,
      s.nome,
      s.ordem,
    ]);
  }
  for (const m of guardadas) {
    await db.query("update medias set secao_id = $1 where id = $2", [m.secao_id, m.id]);
  }
});

await etapa("mover as soltas de uma vez leva TODAS, e só as desta galeria", async () => {
  const { moverSoltasParaSecao } = await import("../src/lib/secoes.ts");
  const { rows: [destino] } = await db.query(
    "select id from secoes where galeria_id = $1 order by ordem limit 1",
    [galeriaId],
  );
  /* Guarda a lotação atual: as etapas seguintes contam com ela — a de apagar
     capítulo, por exemplo, precisa que uma foto específica esteja no capítulo
     que ela vai apagar. Bancada devolvida no fim desta etapa. */
  const { rows: antes } = await db.query(
    "select id, secao_id from medias where galeria_id = $1",
    [galeriaId],
  );
  await db.query("update medias set secao_id = null where galeria_id = $1", [galeriaId]);

  /* Uma galeria vizinha, com foto solta também: o UPDATE não pode alcançá-la. */
  const vizinha = await galeriaDaRodada(db, { nome: "soltas-vizinha", medias: 2 });
  await db.query("update medias set secao_id = null where galeria_id = $1", [vizinha.id]);

  const movidas = await moverSoltasParaSecao(galeriaId, destino.id, tenantId);
  const { rows: [restam] } = await db.query(
    "select count(*)::int as n from medias where galeria_id = $1 and secao_id is null",
    [galeriaId],
  );
  const { rows: [naVizinha] } = await db.query(
    "select count(*)::int as n from medias where galeria_id = $1 and secao_id is null",
    [vizinha.id],
  );
  if (restam.n !== 0) throw new Error(`sobraram ${restam.n} soltas`);
  if (naVizinha.n !== 2) throw new Error(`mexeu na galeria vizinha: ${naVizinha.n} soltas`);

  for (const m of antes) {
    await db.query("update medias set secao_id = $1 where id = $2", [m.secao_id, m.id]);
  }
  return `${movidas} movidas, vizinha intacta`;
});

await etapa("mover as soltas de OUTRO estúdio não move nada", async () => {
  const { moverSoltasParaSecao } = await import("../src/lib/secoes.ts");
  const { rows: [destino] } = await db.query(
    "select id from secoes where galeria_id = $1 order by ordem limit 1",
    [galeriaId],
  );
  const movidas = await moverSoltasParaSecao(galeriaId, destino.id, crypto.randomUUID());
  if (movidas !== 0) throw new Error(`moveu ${movidas} com o tenant errado`);
});

/*
 * ── O CAMINHO DE VOLTA (28/09/2026) ───────────────────────────────────────
 *
 * Pedido do Felipe: "adicionar a opção de mover as fotos de um capítulo para
 * 'sem capítulo'".
 *
 * A ida existia desde 04/09 — "Outras fotos" tinha "mover todas para…" — e a
 * volta não. Quem criou um capítulo errado, ou mandou a pasta inteira para o
 * lugar errado no envio, só podia desfazer foto a foto, ou APAGANDO o capítulo:
 * um botão vermelho, com aviso de que não dá para desfazer, para uma operação
 * que só queria desarrumar as fotos de novo.
 */
/**
 * Guarda em que capítulo cada foto está, para devolver a bancada no fim.
 *
 * As etapas seguintes contam com a lotação — a de apagar capítulo precisa de
 * uma foto DENTRO do capítulo que ela apaga. Esvaziar sem devolver faz a etapa
 * vizinha falhar por um motivo que não é dela, que é o jeito mais rápido de
 * transformar uma suíte em fonte de susto.
 */
const lotacaoAtual = async () =>
  (await db.query("select id, secao_id from medias where galeria_id = $1", [galeriaId])).rows;
const devolverLotacao = async (antes) => {
  for (const m of antes) {
    await db.query("update medias set secao_id = $2 where id = $1", [m.id, m.secao_id]);
  }
};

await etapa("esvaziar um capítulo devolve as fotos para “sem capítulo”", async () => {
  const { esvaziarSecao } = await import("../src/lib/secoes.ts");
  const lotacao = await lotacaoAtual();
  const { rows: [alvo] } = await db.query(
    "select id from secoes where galeria_id = $1 order by ordem limit 1",
    [galeriaId],
  );
  await db.query("update medias set secao_id = $2 where galeria_id = $1", [galeriaId, alvo.id]);
  const { rows: [antes] } = await db.query(
    "select count(*)::int as n from medias where galeria_id = $1 and secao_id = $2",
    [galeriaId, alvo.id],
  );
  if (antes.n === 0) throw new Error("a bancada não tem foto no capítulo — não provaria nada");

  const soltas = await esvaziarSecao(galeriaId, alvo.id, tenantId);
  if (soltas !== antes.n) throw new Error(`soltou ${soltas} de ${antes.n}`);

  const { rows: [depois] } = await db.query(
    `select count(*) filter (where secao_id = $2)::int as no_capitulo,
            count(*) filter (where secao_id is null)::int as soltas
       from medias where galeria_id = $1`,
    [galeriaId, alvo.id],
  );
  if (depois.no_capitulo !== 0) throw new Error(`${depois.no_capitulo} ficaram no capítulo`);
  if (depois.soltas !== antes.n) throw new Error(`${depois.soltas} soltas, esperava ${antes.n}`);

  /* E o capítulo CONTINUA existindo: esvaziar não é apagar. Quem quer o
     capítulo vazio para reorganizar não pode perdê-lo no caminho. */
  const { rows: [vive] } = await db.query("select id from secoes where id = $1", [alvo.id]);
  if (!vive) throw new Error("esvaziar apagou o capítulo junto");

  await devolverLotacao(lotacao);
  return `${soltas} fotos soltas, capítulo intacto`;
});

await etapa("esvaziar capítulo de OUTRO estúdio não move nada", async () => {
  const { esvaziarSecao } = await import("../src/lib/secoes.ts");
  const lotacao = await lotacaoAtual();
  const { rows: [alvo] } = await db.query(
    "select id from secoes where galeria_id = $1 order by ordem limit 1",
    [galeriaId],
  );
  await db.query("update medias set secao_id = $2 where galeria_id = $1", [galeriaId, alvo.id]);
  const soltas = await esvaziarSecao(galeriaId, alvo.id, crypto.randomUUID());
  if (soltas !== 0) throw new Error(`soltou ${soltas} com o tenant errado`);
  const { rows: [ainda] } = await db.query(
    "select count(*)::int as n from medias where galeria_id = $1 and secao_id = $2",
    [galeriaId, alvo.id],
  );
  if (ainda.n === 0) throw new Error("as fotos saíram do capítulo mesmo assim");

  await devolverLotacao(lotacao);
  return "intocado";
});

await etapa("a tela do capítulo oferece a volta", async () => {
  const fonte = readFileSync(
    new URL("../src/components/editor-secoes.tsx", import.meta.url),
    "utf8",
  );
  if (!/esvaziarSecaoAction/.test(fonte)) {
    throw new Error("a linha do capítulo não chama a ação de esvaziar");
  }
  return "editor-secoes chama a ação";
});

await etapa("garantir capítulos: cria o que falta e devolve o id do que já existe", async () => {
  const r = await garantirSecoes(galeriaId, tenantId, ["Cerimônia", "Making Of"]);
  if (r.length !== 2) throw new Error(`esperava 2, veio ${r.length}`);
  const cerimonia = r.find((s) => s.nome === "Cerimônia");
  if (cerimonia.id !== capA.id) throw new Error("não reusou a Cerimônia que já existia");
  const making = r.find((s) => s.nome === "Making Of");
  if (!making?.id) throw new Error("não criou o Making Of que faltava");
  return `1 reusado, 1 criado`;
});

await etapa("garantir é idempotente: a segunda leva não duplica capítulo", async () => {
  const antes = await db.query("select count(*)::int n from secoes where galeria_id = $1", [
    galeriaId,
  ]);
  await garantirSecoes(galeriaId, tenantId, ["Cerimônia", "Making Of"]);
  const depois = await db.query("select count(*)::int n from secoes where galeria_id = $1", [
    galeriaId,
  ]);
  if (antes.rows[0].n !== depois.rows[0].n) {
    throw new Error(`duplicou: ${antes.rows[0].n} → ${depois.rows[0].n}`);
  }
  return `${depois.rows[0].n} capítulos, sem repetir`;
});

await etapa("garantir casa por nome comparável — pasta 'making of' acha 'Making Of'", async () => {
  const r = await garantirSecoes(galeriaId, tenantId, ["making of"]);
  const esperado = await db.query(
    "select id from secoes where galeria_id = $1 and nome = 'Making Of'",
    [galeriaId],
  );
  if (r[0].id !== esperado.rows[0].id) throw new Error("criou um segundo em vez de casar");
});

await etapa("garantir ignora nome vazio em vez de estourar", async () => {
  const r = await garantirSecoes(galeriaId, tenantId, ["   ", "Festa"]);
  if (r.length !== 1) throw new Error(`esperava só a Festa, veio ${r.length}`);
});

await etapa("garantir recusa galeria de outro estúdio", async () => {
  const r = await garantirSecoes(galeriaId, "00000000-0000-0000-0000-000000000000", ["Invasão"]);
  if (r.length !== 0) throw new Error("deixou criar capítulo em galeria alheia");
  const vazou = await db.query(
    "select id from secoes where galeria_id = $1 and nome = 'Invasão'",
    [galeriaId],
  );
  if (vazou.rows.length) throw new Error("criou mesmo assim");
});

await etapa("APAGAR capítulo não apaga as fotos", async () => {
  const antes = await db.query("select count(*)::int n from medias where galeria_id = $1 and pronto", [galeriaId]);
  await db.query("delete from secoes where id = $1", [capB.id]);
  const depois = await db.query("select count(*)::int n from medias where galeria_id = $1 and pronto", [galeriaId]);
  if (depois.rows[0].n !== antes.rows[0].n) {
    throw new Error(`perdeu fotos: ${antes.rows[0].n} → ${depois.rows[0].n}`);
  }
  const orfa = await db.query("select secao_id from medias where id = $1", [fotos[1].id]);
  if (orfa.rows[0].secao_id !== null) throw new Error("a foto ficou apontando para capítulo apagado");
  return `${depois.rows[0].n} fotos intactas, a órfã voltou para "sem capítulo"`;
});

await etapa("galeria segue abrindo com capítulo apagado", async () => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await texto(r);
  if (t.includes("Festa")) throw new Error("capítulo apagado ainda aparece");
  return "HTTP 200, sem resquício";
});

await etapa("apagar a galeria leva os capítulos junto", async () => {
  const { rows: g } = await db.query(
    "insert into galerias (tenant_id, slug, titulo) select tenant_id, 'teste-cascata', 'Teste' from galerias where id = $1 returning id",
    [galeriaId],
  );
  await db.query("insert into secoes (galeria_id, nome) values ($1, 'X')", [g[0].id]);
  await db.query("delete from galerias where id = $1", [g[0].id]);
  const sobrou = await db.query("select count(*)::int n from secoes where galeria_id = $1", [g[0].id]);
  if (sobrou.rows[0].n !== 0) throw new Error("sobraram capítulos órfãos");
  return "sem órfãos";
});

// Deixa uma estrutura bonita para o Felipe ver.
await db.query("delete from secoes where galeria_id = $1", [galeriaId]);
const { rows: novas } = await db.query(
  `insert into secoes (galeria_id, nome, ordem)
   values ($1,'Cerimônia',0), ($1,'Festa',1) returning id`,
  [galeriaId],
);
for (const [i, f] of fotos.entries()) {
  await db.query("update medias set secao_id = $1 where id = $2", [
    novas[i % novas.length].id,
    f.id,
  ]);
}
// A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
await limparRodada(db);
await db.end();

if (falhou) {
  console.error("\n✗ capítulos com problema");
  process.exit(1);
}
console.log(`\n✓ capítulos funcionando — veja em ${url}`);
