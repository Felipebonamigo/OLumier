#!/usr/bin/env node
/**
 * Testa o sistema de aparência. Uso:
 *   node --env-file=.env.local scripts/testar-aparencia.mjs
 *
 * Grava cada preset no banco e confere que a galeria pública SAI DIFERENTE —
 * cor de fundo, marcas da capa e do layout. Sem isso, "trocar de estilo" pode
 * virar um botão que não faz nada visível.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();
import {
  TEMAS,
  OPCOES,
  FONTES_TITULO,
  APARENCIA_PADRAO,
  PRESETS as CARTOES_DE_PRESET,
  presetEquivalente,
} from "../src/config/aparencia.ts";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

/* O que cada id ANTIGO tinha de fonte. Escrito à mão de propósito: se saísse de
 * FONTES_TITULO, concordaria com qualquer mudança e não conferiria nada. */
const FONTES_ANTIGAS = {
  serifada: "--font-serif-app",
  moderna: "--font-sans-app",
  manuscrita: "--font-script-app",
};

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

/* Bancada própria desta execução — antes: a galeria mais antiga do banco.
 * Ver fixture-de-teste.mjs. */
const bancada = await galeriaDaRodada(db);
const galeriaId = bancada.id, gslug = bancada.gslug, tslug = bancada.tslug;
const url = `${BASE}/g/${tslug}/${gslug}`;
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [galeriaId]);

const PRESETS = {
  olumier: { capa: "imersa", tema: "noite", tipografia: "serifada", grade: "editorial", densidade: "normal" },
  revista: { capa: "jornal", tema: "claro", tipografia: "serifada", grade: "colunas", densidade: "normal" },
  atelie: { capa: "dividida", tema: "creme", tipografia: "manuscrita", grade: "linhas", densidade: "arejada" },
  essencial: { capa: "minima", tema: "claro", tipografia: "moderna", grade: "quadrada", densidade: "compacta" },
  /* A capa que a Carol pediu em 31/08/2026: foto ao lado, data e titulo no pe,
     botao de entrada. Entra aqui para passar pelas mesmas conferencias das
     outras — fundo, grade, fonte — e nao so pelas etapas novas. */
  convite: { capa: "convite", tema: "claro", tipografia: "bodoni", grade: "linhas", densidade: "compacta" },
};

// Assinaturas: o que precisa aparecer no HTML de cada combinação.
// Lidos da fonte da verdade: com hex copiado aqui, a troca de paleta de
// 24/08/2026 teria deixado o teste validando as cores antigas para sempre.
const FUNDO = Object.fromEntries(
  Object.entries(TEMAS).map(([nome, vars]) => [nome, vars["--g-fundo"]]),
);
/*
 * `colunas` deixou de ser `column-width` em 04/09/2026.
 *
 * Multi-column do CSS preenche uma coluna inteira antes de começar a próxima:
 * com 30 fotos em 3 colunas, a foto 21 ia para o TOPO da terceira. O sócio
 * descreveu como "fotos do fim aparecerem bem em cima". A grade virou colunas
 * de flex montadas à mão, com a largura medida no navegador — daí a marca ser
 * `flex-direction:column`. Ver `src/lib/grade-mural.ts`.
 *
 * `panorama` é a grade nova do mesmo dia: foto deitada ocupa duas colunas. Ela
 * declara o número exato de colunas, e é isso que a distingue da `quadrada` e
 * da `editorial`, que usam `auto-fill`.
 */
const MARCA_GRADE = {
  colunas: "flex-direction:column",
  linhas: "flex-basis",
  quadrada: "aspect-ratio:1 / 1",
  editorial: "grid-auto-rows",
  panorama: "grid-template-columns:repeat(",
};
const FONTE_ESPERADA = {
  serifada: "--font-serif-app",
  moderna: "--font-sans-app",
  manuscrita: "--font-script-app",
};

let falhou = false;
const vistos = new Map();

for (const [nome, ap] of Object.entries(PRESETS)) {
  await db.query("update galerias set aparencia = $1 where id = $2", [JSON.stringify(ap), galeriaId]);
  const r = await fetch(url, { cache: "no-store" });
  const html = (await r.text()).replaceAll("&quot;", '"').replaceAll("\\", "");
  const normalizado = html.replace(/\s+/g, "");

  const checagens = [
    [`fundo ${ap.tema}`, normalizado.includes(FUNDO[ap.tema].replace("#", "")) || html.includes(FUNDO[ap.tema])],
    [`grade ${ap.grade}`, normalizado.includes(MARCA_GRADE[ap.grade].replace(/\s/g, ""))],
    /* A capa agora se identifica no html (`data-capa`), em vez de ser deduzida
       pela presenca do botao: duas capas ja tem botao de entrada, e deducao por
       pista indireta confunde uma com a outra em silencio. */
    [`capa ${ap.capa} marcada no html`, normalizado.includes(`data-capa="${ap.capa}"`)],
    [
      `botao de entrada em ${ap.capa}`,
      ["jornal", "convite"].includes(ap.capa)
        ? html.includes("Ver galeria")
        : !html.includes("Ver galeria"),
    ],
    // O título tem que apontar para a variável do next/font. Já falhou uma vez:
    // usando o token do Tailwind (--font-serif), a variável não existe em tempo
    // de execução e o título cai silenciosamente na fonte do sistema.
    [`fonte ${ap.tipografia}`, normalizado.includes(FONTE_ESPERADA[ap.tipografia])],
  ];

  const ruins = checagens.filter(([, ok]) => !ok).map(([n]) => n);
  if (ruins.length) {
    console.error(`  ✗ preset "${nome}" — não aplicou: ${ruins.join(", ")}`);
    falhou = true;
  } else {
    console.log(`  ✓ preset "${nome}" — ${ap.tema} · capa ${ap.capa} · grade ${ap.grade}`);
  }

  // Guarda uma impressão digital para provar que os presets diferem entre si.
  vistos.set(nome, normalizado.length + "|" + (normalizado.match(/columnWidth|flexBasis|gridAutoRows|aspectRatio/g) || []).join(","));
}

// Presets diferentes têm que gerar HTML diferente — senão a escolha é decorativa.
const impressoes = new Set(vistos.values());
if (impressoes.size < 3) {
  console.error(`  ✗ os presets estão gerando páginas parecidas demais (${impressoes.size} variações)`);
  falhou = true;
} else {
  console.log(`  ✓ os ${vistos.size} presets geram páginas distintas (${impressoes.size} variações)`);
}

/*
 * ── CADA PASTILHA PRECISA SER UMA ESCOLHA ALCANÇÁVEL ──────────────────────
 *
 * `presetPorId` devolve o PRIMEIRO com aquele id, e `presetEquivalente` marca
 * um só. Dois presets com o mesmo id — ou com o mesmo nome, ou com a mesma
 * combinação de eixos — viram duas pastilhas iguais na tela com resultados
 * diferentes: o fotógrafo clica numa e a outra continua apagada, sem nada na
 * tela que explique por quê. Aconteceu: a segunda leva de presets (27/08/2026)
 * chamou "Convite" um preset que já existia com esse id desde 31/08/2026.
 */
const repetidos = (valores) => [...new Set(valores.filter((v, i) => valores.indexOf(v) !== i))];
const idsRepetidos = repetidos(CARTOES_DE_PRESET.map((p) => p.id));
const nomesRepetidos = repetidos(CARTOES_DE_PRESET.map((p) => p.nome));
if (idsRepetidos.length || nomesRepetidos.length) {
  console.error(
    `  ✗ preset repetido — id: ${idsRepetidos.join(", ") || "nenhum"} · nome: ${nomesRepetidos.join(", ") || "nenhum"}`,
  );
  falhou = true;
} else {
  console.log(`  ✓ os ${CARTOES_DE_PRESET.length} presets têm id e nome únicos`);
}

/* A volta: a aparência de cada preset tem de marcar ELE, não um vizinho de
   eixos idênticos — senão a pastilha existe e nunca acende. */
const naoSeReconhecem = CARTOES_DE_PRESET.filter((p) => presetEquivalente(p.aparencia) !== p.id);
if (naoSeReconhecem.length) {
  console.error(
    `  ✗ preset que não se marca no editor: ${naoSeReconhecem
      .map((p) => `${p.id} → ${presetEquivalente(p.aparencia)}`)
      .join(", ")}`,
  );
  falhou = true;
} else {
  console.log(`  ✓ cada preset se reconhece pelos próprios eixos`);
}

/*
 * ── AS FONTES ─────────────────────────────────────────────────────────────
 *
 * O eixo de tipografia deixou de ser três CATEGORIAS e passou a ser uma lista
 * de fontes com nome. Duas coisas podem quebrar em silêncio nessa expansão, e
 * as duas custam caro:
 *
 *   1. Um id antigo mudar de fonte. `serifada`, `moderna` e `manuscrita` estão
 *      gravados em galerias que já foram ENTREGUES. Se um deles passar a
 *      apontar para outra fonte, a galeria do casal muda de cara sozinha, sem
 *      ninguém ter tocado nela.
 *
 *   2. Uma fonte nova não ter variável. `FONTES_TITULO` pode listar uma fonte
 *      que o layout não carregou — a página não quebra, o título só cai na
 *      fonte do sistema. O fotógrafo escolhe "Playfair", vê Arial, e conclui
 *      que o produto está quebrado.
 */
for (const [id, esperado] of Object.entries(FONTES_ANTIGAS)) {
  const atual = FONTES_TITULO[id];
  if (!atual?.includes(esperado)) {
    console.error(
      `  ✗ o id antigo "${id}" mudou de fonte — galeria já entregue mudaria de cara sozinha`,
    );
    falhou = true;
  }
}
console.log(`  ✓ os ${Object.keys(FONTES_ANTIGAS).length} ids antigos apontam para a mesma fonte`);

const semVariavel = OPCOES.tipografia
  .map((o) => o.id)
  .filter((id) => !/var\(--font-[a-z0-9-]+\)/.test(FONTES_TITULO[id] ?? ""));
if (semVariavel.length) {
  console.error(
    `  ✗ sem variável de fonte: ${semVariavel.join(", ")} — o título cairia na fonte do sistema`,
  );
  falhou = true;
} else {
  console.log(`  ✓ as ${OPCOES.tipografia.length} fontes têm variável declarada`);
}

/*
 * ── O TAMANHO DA LOGO (31/08/2026) ────────────────────────────────────────
 *
 * A logo do estúdio na capa vivia num `max-h-14` escrito à mão dentro do
 * componente — 56 px, e ponto. Quem tem logo horizontal fina ficava com uma
 * marca miúda em cima de uma foto de tela cheia, sem nada na tela para mexer.
 *
 * Virou eixo de aparência, como capa, tema e grade. As etapas abaixo prendem as
 * três pontas: o eixo existe, os tamanhos crescem de verdade, e a capa usa o
 * eixo em vez de um valor fixo. A terceira é a que importa — sem ela o eixo
 * apareceria na tela e não mudaria nada, que é pior que não existir.
 */
const LOGOS = OPCOES.logo ?? [];
if (LOGOS.length < 3) {
  console.error(`  ✗ o eixo de tamanho da logo tem ${LOGOS.length} opções — esperava ao menos 3`);
  falhou = true;
} else {
  console.log(`  ✓ o tamanho da logo é um eixo — ${LOGOS.map((o) => o.nome).join(", ")}`);
}

/* Tamanho é escada: um degrau que não sobe é opção que não faz nada. */
const alturas = LOGOS.map((o) => o.px);
const sobeSempre =
  alturas.length > 0 &&
  alturas.every((v, i) => typeof v === "number" && (i === 0 || v > alturas[i - 1]));
if (!sobeSempre) {
  console.error(`  ✗ os tamanhos de logo não crescem: ${alturas.join(" → ")}`);
  falhou = true;
} else {
  console.log(`  ✓ os tamanhos crescem — ${alturas.join(" → ")} px`);
}

/*
 * O PADRÃO PRECISA SER MAIOR QUE OS 56 px DE ANTES.
 *
 * O pedido do dono foi literalmente "a logo tem que ser maior". Um eixo novo
 * cujo padrão repete o tamanho antigo atenderia à letra e não ao pedido: quem
 * não mexer em nada continuaria vendo a logo do mesmo tamanho.
 */
const padraoLogo = LOGOS.find((o) => o.id === APARENCIA_PADRAO.logo);
if (!padraoLogo || padraoLogo.px <= 56) {
  console.error(
    `  ✗ o tamanho padrão da logo é ${padraoLogo?.px ?? "?"} px — era 56 px antes do eixo existir`,
  );
  falhou = true;
} else {
  console.log(`  ✓ o padrão subiu de 56 px para ${padraoLogo.px} px`);
}

/* A capa tem de LER o eixo. Altura escrita à mão ali é o eixo virando enfeite.
 *
 * Os comentários saem antes da busca: o comentário que EXPLICA a mudança cita o
 * `max-h-14` que foi removido, e sem esta limpeza o teste acusaria a própria
 * documentação de ser o defeito. */
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const capa = semComentarios(
  readFileSync(path.join(RAIZ, "src/components/galeria-capa.tsx"), "utf8"),
);
if (/max-h-\d/.test(capa)) {
  console.error("  ✗ a capa ainda tem altura de logo fixa (`max-h-…`) — o eixo não muda nada");
  falhou = true;
} else if (!capa.includes("aparencia.logo")) {
  console.error("  ✗ a capa não lê `aparencia.logo`");
  falhou = true;
} else {
  console.log("  ✓ a capa desenha a logo pelo eixo, sem altura fixa");
}

/*
 * TODO EIXO PRECISA ESTAR NA TELA.
 *
 * Eixo que existe no config e não aparece no editor é opção que ninguém
 * alcança — e ninguém descobre, porque nada quebra. A tipografia é a exceção
 * conhecida: ela tem seletor próprio (`SeletorDeFonte`), agrupado por família.
 */
const editor = readFileSync(path.join(RAIZ, "src/components/editor-aparencia.tsx"), "utf8");
const forasDaTela = Object.keys(OPCOES).filter(
  (eixo) => eixo !== "tipografia" && !editor.includes(`eixo="${eixo}"`),
);
if (forasDaTela.length) {
  console.error(`  ✗ eixo sem lugar no editor: ${forasDaTela.join(", ")}`);
  falhou = true;
} else {
  console.log(`  ✓ os ${Object.keys(OPCOES).length} eixos aparecem no editor`);
}

/*
 * ── A LOGO NA HORA DE CRIAR A GALERIA ─────────────────────────────────────
 *
 * A logo é do ESTÚDIO, e morava só em Conta. Quem estava criando a primeira
 * galeria tinha de sair da tarefa, achar outra tela e voltar — e a hora em que
 * a pessoa pensa na marca é exatamente esta. O editor de marca passa a aparecer
 * também no formulário de nova galeria, gravando no mesmo lugar de sempre.
 */
const telaNova =
  readFileSync(path.join(RAIZ, "src/app/painel/galerias/nova/page.tsx"), "utf8") +
  readFileSync(path.join(RAIZ, "src/app/painel/galerias/nova/form.tsx"), "utf8");
if (!/LogoEstudio|logo-estudio/.test(telaNova)) {
  console.error("  ✗ criar galeria não oferece a logo — a pessoa precisa sair da tarefa");
  falhou = true;
} else {
  console.log("  ✓ dá para colocar a logo na hora de criar a galeria");
}

/* Cada fonte precisa estar CARREGADA, não só nomeada. A prova é o layout: se a
 * variável não aparece lá, o next/font nunca a baixou. */
const layout = readFileSync(path.join(RAIZ, "src/app/layout.tsx"), "utf8");
const naoCarregadas = OPCOES.tipografia
  .map((o) => ({ id: o.id, v: FONTES_TITULO[o.id]?.match(/--font-[a-z0-9-]+/)?.[0] }))
  .filter(({ v }) => v && !layout.includes(v));
if (naoCarregadas.length) {
  console.error(
    `  ✗ variável sem fonte carregada no layout: ${naoCarregadas.map((x) => x.id).join(", ")}`,
  );
  falhou = true;
} else {
  console.log("  ✓ toda fonte oferecida está carregada no layout");
}

/*
 * A galeria do CLIENTE não pode baixar fonte que ela não usa.
 *
 * É o argumento de velocidade do produto inteiro: miniatura de 13 KB contra os
 * megabytes do concorrente. Doze fontes pré-carregadas jogariam isso fora numa
 * linha. `preload: false` faz o navegador buscar só a que for de fato usada —
 * a escolhida. As três originais podem pré-carregar: a interface as usa.
 */
const declaracoes = layout.split(/(?=const \w+ = \w+\(\{)/);
const preloadIndevido = declaracoes
  .filter((d) => /--font-titulo-/.test(d) && !/preload:\s*false/.test(d))
  .map((d) => d.match(/--font-titulo-[a-z0-9-]+/)?.[0]);
if (preloadIndevido.length) {
  console.error(`  ✗ fonte opcional sem preload:false — ${preloadIndevido.join(", ")}`);
  falhou = true;
} else {
  console.log("  ✓ as fontes opcionais não são pré-carregadas na galeria do cliente");
}

// Valor inválido não pode quebrar a página.
await db.query(`update galerias set aparencia = '{"tema":"roxo","grade":"maluca"}'::jsonb where id = $1`, [galeriaId]);
const rInvalido = await fetch(url, { cache: "no-store" });
if (rInvalido.status === 200) {
  console.log("  ✓ aparência inválida cai no padrão sem quebrar");
} else {
  console.error(`  ✗ aparência inválida derrubou a página (HTTP ${rInvalido.status})`);
  falhou = true;
}

// Deixa no preset Revista — o mais parecido com a referência do Sirius.
await db.query("update galerias set aparencia = $1 where id = $2", [
  JSON.stringify(PRESETS.revista),
  galeriaId,
]);
// A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
await limparRodada(db);
await db.end();

if (falhou) {
  console.error("\n✗ o sistema de aparência tem problema");
  process.exit(1);
}
console.log(`\n✓ aparência funcionando — deixei no preset "Revista" em ${url}`);
