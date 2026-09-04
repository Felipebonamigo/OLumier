#!/usr/bin/env node
/**
 * Testa a AMOSTRA da prévia de aparência. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-previa.mjs
 *
 * ── O PROBLEMA (31/08/2026, reclamação da Carol) ──────────────────────────
 *
 * A prévia do editor de aparência é a galeria pública de verdade dentro de um
 * iframe de 460 px — e isso é uma qualidade do produto, não um atalho: o que se
 * vê ali é o que o cliente vê, sem imitação para sair do lugar. O custo é que
 * ela carregava a galeria INTEIRA a cada mudança de eixo: 192 fotos assinadas
 * três vezes cada (miniatura, preview e original), e 192 miniaturas baixadas
 * numa caixa onde cabem seis. Trocar de fonte levava segundos.
 *
 * A correção é uma AMOSTRA: `?amostra=1` desenha as primeiras fotos e nada mais.
 *
 * ── A ARMADILHA QUE ESTA SUÍTE EXISTE PARA PEGAR ──────────────────────────
 *
 * O botão "Visualizar galeria ↗" abre o MESMO endereço da prévia, e a promessa
 * dele é o contrário da amostra: mostrar a galeria inteira, do jeito que o
 * cliente vê. Se a amostra pegasse no `?previa=1` — que é o parâmetro que os
 * dois compartilhavam — o botão passaria a mentir, mostrando doze fotos e
 * chamando aquilo de "como o seu cliente vê".
 *
 * Por isso são dois parâmetros: `previa` continua sendo "sou o dono, deixa eu
 * ver o rascunho", e `amostra` é "estou na caixinha, manda pouco". A etapa que
 * confere o botão é a mais importante daqui.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

exigirBancoDeTeste();
import { AMOSTRA_PREVIA, VIEWPORTS_PREVIA } from "../src/config/aparencia.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const QUANTAS = 30; // bem acima da amostra, para a diferença ser inequívoca

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

const noAr = await galeriaDaRodada(db, { nome: "previa-no-ar", medias: QUANTAS, publicada: true });
const rascunho = await galeriaDaRodada(db, {
  nome: "previa-rascunho",
  medias: QUANTAS,
  publicada: false,
});

const cookie = cookieDeSessao(noAr.estudio.id);

/**
 * Busca a página e conta ARQUIVOS DISTINTOS, não ocorrências.
 *
 * A mesma URL aparece várias vezes no HTML — no atributo da imagem e de novo na
 * carga do React que hidrata a página. Contar ocorrência dava 68 para 30 fotos e
 * fazia o teto parecer estourado quando não estava. O que custa dinheiro e tempo
 * é o arquivo distinto: uma assinatura no servidor, um download no navegador.
 *
 * As chaves do fixture terminam em `-N_thumb.webp` e `-N_prev.webp`, então o
 * sufixo identifica a foto sem depender da URL assinada, que muda a cada
 * requisição.
 */
async function medir(caminho, comCookie = false) {
  const r = await fetch(`${BASE}${caminho}`, {
    cache: "no-store",
    headers: comCookie ? { cookie } : {},
  });
  const html = r.ok ? await r.text() : "";
  const distintos = (padrao) => new Set(html.match(padrao) ?? []).size;
  return {
    status: r.status,
    thumbs: distintos(/[\w-]+-\d+_thumb\.webp/g),
    previews: distintos(/[\w-]+-\d+_prev\.webp/g),
    bytes: html.length,
  };
}

console.log("a galeria inteira");

const cheia = await medir(`/g/${noAr.tslug}/${noAr.gslug}`);

await etapa("sem parâmetro nenhum, vêm todas as fotos", () => {
  if (cheia.status !== 200) throw new Error(`HTTP ${cheia.status}`);
  if (cheia.thumbs < QUANTAS) {
    throw new Error(`${cheia.thumbs} miniaturas para ${QUANTAS} fotos — a galeria veio cortada`);
  }
  return `${cheia.thumbs} miniaturas · ${cheia.previews} previews`;
});

/*
 * A PROMESSA DO BOTÃO "VISUALIZAR GALERIA".
 *
 * Ele abre `?previa=1` e diz, embaixo, "do jeito que o seu cliente vê". Uma
 * amostra colada no parâmetro errado transforma essa frase em mentira, e é o
 * tipo de mentira que ninguém descobre até um cliente reclamar de foto sumida.
 */
await etapa('"Visualizar galeria" continua mostrando a galeria inteira', async () => {
  const m = await medir(`/g/${noAr.tslug}/${noAr.gslug}?previa=1`, true);
  if (m.status !== 200) throw new Error(`HTTP ${m.status}`);
  if (m.thumbs < QUANTAS) {
    throw new Error(
      `${m.thumbs} miniaturas para ${QUANTAS} fotos — a amostra vazou para o botão, ` +
        `que promete mostrar a galeria como o cliente vê`,
    );
  }
  return `${m.thumbs} miniaturas`;
});

console.log("\na amostra da caixinha");

const amostra = await medir(`/g/${noAr.tslug}/${noAr.gslug}?previa=1&amostra=1`, true);

await etapa("a amostra manda poucas fotos", () => {
  if (amostra.status !== 200) throw new Error(`HTTP ${amostra.status}`);
  if (amostra.thumbs > AMOSTRA_PREVIA) {
    throw new Error(`${amostra.thumbs} miniaturas, o teto é ${AMOSTRA_PREVIA}`);
  }
  if (amostra.thumbs >= cheia.thumbs) {
    throw new Error(`${amostra.thumbs} contra ${cheia.thumbs} da inteira — não encolheu nada`);
  }
  return `${amostra.thumbs} de ${cheia.thumbs}`;
});

/*
 * O preview de 2048 px serve ao lightbox, e não existe lightbox numa caixa de
 * 460 px — ninguém clica para ampliar dentro da prévia. Cada um deles é uma
 * assinatura a mais no servidor por foto, gasta para nada.
 *
 * Sobra o da CAPA, que é a única imagem grande que a prévia realmente mostra.
 */
await etapa("a amostra não assina os previews de 2048 px", () => {
  if (amostra.previews > 1) {
    throw new Error(
      `${amostra.previews} previews assinados — só o da capa deveria sobrar ` +
        `(a inteira assina ${cheia.previews})`,
    );
  }
  return `${amostra.previews} contra ${cheia.previews} da inteira`;
});

await etapa("a página da amostra é bem menor", () => {
  if (amostra.bytes >= cheia.bytes) {
    throw new Error(`${amostra.bytes} bytes contra ${cheia.bytes} da inteira`);
  }
  const queda = Math.round((1 - amostra.bytes / cheia.bytes) * 100);
  if (queda < 20) throw new Error(`só ${queda}% menor — a amostra não está economizando`);
  return `${queda}% menor`;
});

/*
 * ── A PRÉVIA DO QUE AINDA NÃO FOI PUBLICADO (31/08/2026) ──────────────────
 *
 * O editor de aparência gravava a cada clique, e o motivo era a prévia: o
 * iframe desenha a galeria a partir do BANCO, então mostrar a escolha exigia
 * gravá-la antes. O efeito colateral era que experimentar já mudava a galeria
 * do cliente — quem estava no meio de "clica, vê, clica de novo" tinha, a cada
 * passo, um estado publicado que ninguém escolheu de fato.
 *
 * O dono pediu um botão. Para o botão existir sem a prévia parar de funcionar,
 * a aparência PENDENTE viaja na URL da prévia: `?ap=<json>` desenha aquilo sem
 * gravar nada. Publicar continua sendo a única coisa que escreve no banco.
 *
 * As duas etapas abaixo são as duas metades disso: que o parâmetro pinta, e que
 * ele só pinta para o dono — senão qualquer pessoa com o link poderia forçar
 * outra aparência na galeria alheia e mandar o print para o casal.
 */
console.log("\na aparência pendente na prévia");

const FUNDO_CREME = "#f7f1e6";
const apPendente = encodeURIComponent(
  JSON.stringify({
    capa: "minima",
    tema: "creme",
    tipografia: "serifada",
    grade: "quadrada",
    densidade: "normal",
    logo: "media",
  }),
);

await etapa("o dono vê a aparência pendente sem nada ser gravado", async () => {
  const r = await fetch(
    `${BASE}/g/${noAr.tslug}/${noAr.gslug}?previa=1&amostra=1&ap=${apPendente}`,
    { cache: "no-store", headers: { cookie } },
  );
  const html = await r.text();
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (!html.includes(FUNDO_CREME)) {
    throw new Error(`a página não pintou o fundo creme (${FUNDO_CREME}) que o parâmetro pediu`);
  }

  const { rows } = await db.query("select aparencia from galerias where id = $1", [noAr.id]);
  if (rows[0].aparencia?.tema === "creme") {
    throw new Error("a aparência pendente foi GRAVADA — o botão de publicar deixou de ter função");
  }
  return "pintou creme, banco intacto";
});

await etapa("visitante não consegue forçar aparência pela URL", async () => {
  const r = await fetch(
    `${BASE}/g/${noAr.tslug}/${noAr.gslug}?previa=1&amostra=1&ap=${apPendente}`,
    { cache: "no-store" },
  );
  const html = await r.text();
  if (html.includes(FUNDO_CREME)) {
    throw new Error("quem não é dono conseguiu trocar a aparência da galeria pela URL");
  }
  return "parâmetro ignorado";
});

/*
 * ── O RASCUNHO NÃO PODE SE PERDER (01/09/2026) ────────────────────────────
 *
 * O botão "Publicar aparência" trouxe, junto, um jeito de perder trabalho que
 * não existia com o salvamento automático: escolher e sair sem apertar. Custou
 * exatamente isso, no mesmo dia, com a primeira usuária de verdade — a Carol
 * escolheu o tema claro, viu a prévia ficar branca, saiu, e a galeria seguiu
 * preta com `aparencia` em `{}`.
 *
 * O conserto separa as duas coisas que estavam grudadas: o que o CLIENTE vê
 * (`aparencia`, que só muda ao publicar) e o que o FOTÓGRAFO está
 * experimentando (`aparencia_rascunho`, que grava sozinho). As três etapas
 * abaixo são as três metades disso — e a terceira é a que não pode falhar
 * nunca: o rascunho não pode vazar para o cliente.
 */
console.log("\no rascunho da aparência");

/* A REGRA mora na lib, e não na action, justamente para poder ser exercitada
   aqui: server action puxa o runtime do cliente do Next e estoura fora de uma
   requisição. Assim o teste escreve no banco de verdade, em vez de conferir a
   tela e torcer. */
const { gravarRascunho, publicarAparencia } = await import("../src/lib/aparencia-galeria.ts");

const CREME = {
  capa: "minima",
  tema: "creme",
  tipografia: "serifada",
  grade: "quadrada",
  densidade: "normal",
  logo: "media",
};

await etapa("o rascunho grava sem tocar no que o cliente vê", async () => {
  await db.query("update galerias set aparencia = $1, aparencia_rascunho = null where id = $2", [
    JSON.stringify({ tema: "noite" }),
    noAr.id,
  ]);
  const r = await gravarRascunho(noAr.id, noAr.estudio.id, CREME);
  if (!r.ok) throw new Error("a gravação não achou a galeria");

  const { rows } = await db.query(
    "select aparencia, aparencia_rascunho from galerias where id = $1",
    [noAr.id],
  );
  if (rows[0].aparencia_rascunho?.tema !== "creme") {
    throw new Error("o rascunho não foi gravado — é o trabalho que se perdia");
  }
  if (rows[0].aparencia?.tema !== "noite") {
    throw new Error("publicou sem ninguém mandar: a galeria do cliente mudou sozinha");
  }
  return "rascunho creme, publicado noite";
});

await etapa("a galeria do cliente ignora o rascunho", async () => {
  const html = await (await fetch(`${BASE}/g/${noAr.tslug}/${noAr.gslug}`, { cache: "no-store" })).text();
  if (html.includes("#f7f1e6")) {
    throw new Error("o creme do RASCUNHO apareceu para o cliente antes de alguém publicar");
  }
  return "cliente segue vendo o publicado";
});

await etapa("publicar promove o rascunho e o apaga", async () => {
  const r = await publicarAparencia(noAr.id, noAr.estudio.id, CREME);
  if (!r.ok) throw new Error("a publicação não achou a galeria");

  const { rows } = await db.query(
    "select aparencia, aparencia_rascunho from galerias where id = $1",
    [noAr.id],
  );
  if (rows[0].aparencia?.tema !== "creme") throw new Error("não publicou");
  if (rows[0].aparencia_rascunho !== null) {
    throw new Error("o rascunho ficou para trás — a barra continuaria pedindo para publicar");
  }
  return "publicado e rascunho limpo";
});

console.log("\na permissão não afrouxou");

/*
 * `amostra` é conveniência de desenho, e nunca uma porta. A regra continua a de
 * sempre: rascunho só abre para quem está logado como dono. Um parâmetro novo é
 * exatamente o lugar onde uma checagem esquecida vira vazamento silencioso.
 */
await etapa("rascunho com ?amostra=1 e sem sessão continua fechado", async () => {
  const m = await medir(`/g/${rascunho.tslug}/${rascunho.gslug}?previa=1&amostra=1`);
  if (m.status === 200) throw new Error("abriu o rascunho para quem não está logado");
  return `HTTP ${m.status}`;
});

await etapa("o dono continua vendo o próprio rascunho", async () => {
  const m = await medir(
    `/g/${rascunho.tslug}/${rascunho.gslug}?previa=1&amostra=1`,
    true,
  );
  if (m.status !== 200) throw new Error(`HTTP ${m.status} — o dono perdeu o acesso ao rascunho`);
  return `${m.thumbs} miniaturas`;
});

/*
 * ── A PRÉVIA TEM A PROPORÇÃO DE UMA TELA (05/09/2026) ─────────────────────
 *
 * "A prévia não está fiel ao resultado final" — o dono, e ele estava certo. O
 * iframe tinha 460 px de altura e a largura do painel; a galeria é desenhada
 * para tela cheia, com capa de `78vh` e colunas a partir de 768 px. A caixa
 * achatava a capa e, num notebook, mostrava o layout de celular enquanto o
 * cliente via o de computador.
 *
 * Agora o iframe é renderizado no tamanho de uma tela de verdade e reduzido em
 * escala. Estas etapas prendem o tamanho: se alguém devolver a caixa de 460 px,
 * a prévia volta a mentir sem que nada mais avise.
 */
console.log("\na prévia tem a proporção de uma tela");

const editor = await fetch(`${BASE}/painel/galerias/${noAr.id}`, {
  cache: "no-store",
  headers: { cookie },
});
const htmlEditor = editor.ok ? await editor.text() : "";
const [computador, celular] = VIEWPORTS_PREVIA;

await etapa("o iframe da prévia nasce do tamanho de um computador", () => {
  if (editor.status !== 200) throw new Error(`HTTP ${editor.status} no editor`);
  const iframe = /<iframe[^>]*title="Prévia da galeria"[^>]*>/.exec(htmlEditor)?.[0];
  if (!iframe) throw new Error("não achei o iframe da prévia no editor");
  if (!iframe.includes(`width="${computador.largura}"`) || !iframe.includes(`height="${computador.altura}"`)) {
    throw new Error(
      `o iframe não tem ${computador.largura}×${computador.altura} — ` +
        `a prévia não está no tamanho de uma tela: ${iframe.slice(0, 160)}…`,
    );
  }
  if (/h-\[460px\]/.test(iframe)) throw new Error("a caixa de 460 px voltou");
  return `${computador.largura}×${computador.altura}`;
});

await etapa("dá para ver como fica no celular também", () => {
  for (const vp of [computador, celular]) {
    const botao = new RegExp(`<button[^>]*>[^<]*${vp.nome}[^<]*</button>`);
    if (!botao.test(htmlEditor)) throw new Error(`não achei o botão "${vp.nome}"`);
  }
  return `${computador.nome} e ${celular.nome}`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a prévia tem problema" : "\n✓ prévia ok");
process.exitCode = falhou ? 1 : 0;
