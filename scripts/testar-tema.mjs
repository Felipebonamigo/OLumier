#!/usr/bin/env node
/**
 * Testa a paleta dos dois temas: claro e escuro.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-tema.mjs
 *
 * Por que existe. A partir de agora cada cor é escrita uma vez, com os dois
 * lados juntos (`light-dark(claro, escuro)`), e um bloco de compatibilidade
 * repete a metade escura para o navegador que não conhece a função. São duas
 * cópias da mesma verdade, e duas cópias envelhecem separadas: alguém ajusta o
 * tom escuro numa e esquece a outra, e quem estiver num navegador antigo passa
 * a ver uma cor que ninguém escolheu. Este teste prende as duas.
 *
 * A segunda metade é mais importante que a primeira: cor que some é o defeito
 * mais fácil de introduzir num tema novo, porque no tema em que trabalhamos
 * tudo parecia certo. Prata sobre preto tem contraste de sobra; a mesma prata
 * sobre branco desaparece. Aqui o piso da WCAG é conferido nos DOIS temas, e um
 * token novo sem lado claro é falha, não omissão silenciosa.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { contraste, normalizarCor } from "../src/lib/marca-estudio.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");
const CSS = readFileSync(path.join(RAIZ, "src/app/globals.css"), "utf8");

let falhou = false;
function etapa(nome, fn) {
  try {
    const detalhe = fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

/* Só o trecho dos tokens: o resto do arquivo tem cor dentro de gradiente e
   sombra, que não são tokens e não entram nesta conferência. */
const inicio = CSS.indexOf(":root");
const fim = CSS.indexOf("@theme inline");
if (inicio < 0 || fim < 0) throw new Error("globals.css mudou de forma: não achei :root ou @theme inline");
const BLOCO = CSS.slice(inicio, fim);

/** Divide "a, rgba(1, 2, 3, .4)" em ["a", "rgba(1, 2, 3, .4)"] — vírgula de dentro do parêntese não conta. */
function dividirNoTopo(texto) {
  const partes = [];
  let profundidade = 0;
  let atual = "";
  for (const c of texto) {
    if (c === "(") profundidade++;
    if (c === ")") profundidade--;
    if (c === "," && profundidade === 0) {
      partes.push(atual.trim());
      atual = "";
      continue;
    }
    atual += c;
  }
  partes.push(atual.trim());
  return partes;
}

const legado = new Map(); // token -> valor do bloco de compatibilidade
const pares = new Map(); // token -> { claro, escuro }

for (const [, token, bruto] of BLOCO.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
  const valor = bruto.trim();
  const m = /^light-dark\((.*)\)$/s.exec(valor);
  if (!m) {
    legado.set(token, valor);
    continue;
  }
  const args = dividirNoTopo(m[1]);
  if (args.length !== 2) throw new Error(`${token}: light-dark() precisa de 2 valores, veio ${args.length}`);
  pares.set(token, { claro: args[0], escuro: args[1] });
}

console.log("estrutura da paleta");

etapa("existe um tema claro", () => {
  if (pares.size === 0) throw new Error("nenhum token usa light-dark() — só existe o tema escuro");
  return `${pares.size} tokens com os dois lados`;
});

etapa("todo token tem os dois lados", () => {
  const orfaos = [...legado.keys()].filter((t) => !pares.has(t));
  if (orfaos.length) throw new Error(`sem lado claro: ${orfaos.join(", ")}`);
});

etapa("o bloco de compatibilidade repete a metade escura", () => {
  for (const [token, { escuro }] of pares) {
    const antigo = legado.get(token);
    if (antigo === undefined) throw new Error(`${token} não tem valor de compatibilidade`);
    if (antigo !== escuro) {
      throw new Error(`${token}: compatibilidade diz ${antigo}, light-dark() diz ${escuro}`);
    }
  }
});

etapa("o navegador é quem decide o tema quando ninguém escolheu", () => {
  if (!/color-scheme:\s*light dark/.test(CSS)) {
    throw new Error("falta `color-scheme: light dark` — sem isso light-dark() não segue o sistema");
  }
  for (const escolha of ["claro", "escuro"]) {
    if (!CSS.includes(`[data-tema="${escolha}"]`)) {
      throw new Error(`falta a regra de quem escolheu "${escolha}" na mão`);
    }
  }
});

etapa("a metade escura é a de hoje", () => {
  // Âncora: se alguém trocar o fundo escuro sem querer, isto acusa.
  const void_ = pares.get("--void");
  if (!void_ || void_.escuro !== "#07080b") {
    throw new Error(`--void escuro deveria ser #07080b, veio ${void_?.escuro}`);
  }
});

/*
 * Piso de contraste, par a par.
 *
 * 4.5 é o piso da WCAG para texto normal e 3 para texto grande e elemento
 * gráfico — é o que usamos para o que é decorativo mas ainda precisa ser visto
 * (rótulo pequeno em maiúsculas, traço da marca, cor de estado).
 */
const PISOS = [
  ["--texto", "--void", 4.5, "texto sobre o fundo"],
  ["--texto-soft", "--void", 4.5, "texto secundário sobre o fundo"],
  ["--texto-faint", "--void", 3, "texto terciário sobre o fundo"],
  ["--texto", "--carbon", 4.5, "texto sobre cartão"],
  ["--texto-soft", "--carbon", 4.5, "texto secundário sobre cartão"],
  ["--texto-faint", "--carbon", 3, "texto terciário sobre cartão"],
  ["--acento", "--void", 4.5, "link em âmbar sobre o fundo"],
  ["--acento", "--carbon", 4.5, "link em âmbar sobre cartão"],
  ["--void", "--acento", 4.5, "texto do botão sobre o âmbar"],
  ["--acento-alto", "--carbon", 4.5, "preço sobre cartão"],
  ["--marca-traco", "--void", 3, "traço da marca sobre o fundo"],
  ["--tinta", "--marfim", 4.5, "texto da folha clara"],
  ["--tinta-suave", "--marfim", 4.5, "texto secundário da folha clara"],
  ["--tinta-faint", "--marfim", 3, "texto terciário da folha clara"],
  ["--ouro-tinta", "--marfim", 3, "marcador da folha clara"],
  ["--ok", "--void", 3, "verde de sucesso"],
  ["--alerta", "--void", 3, "âmbar de alerta"],
  ["--erro", "--void", 3, "vermelho de erro"],
];

for (const tema of ["claro", "escuro"]) {
  console.log(`\ncontraste no tema ${tema}`);
  for (const [frente, fundo, piso, descricao] of PISOS) {
    etapa(`${descricao} (${frente} sobre ${fundo})`, () => {
      const a = pares.get(frente)?.[tema];
      const b = pares.get(fundo)?.[tema];
      if (!a) throw new Error(`${frente} não existe`);
      if (!b) throw new Error(`${fundo} não existe`);
      // contraste() cai na cor padrão diante de valor que não seja hex; conferir
      // aqui evita um "passou" que na verdade mediu outra cor.
      if (!normalizarCor(a)) throw new Error(`${frente} não é hex: ${a}`);
      if (!normalizarCor(b)) throw new Error(`${fundo} não é hex: ${b}`);
      const r = contraste(a, b);
      if (r < piso) throw new Error(`${r.toFixed(2)}:1, piso é ${piso}:1`);
      return `${r.toFixed(1)}:1`;
    });
  }
}

/*
 * O script do tema roda antes da primeira pintura — mas SÓ se estiver dentro do
 * <head>. Solto entre <html> e <body> ele ainda executa, e por isso o defeito
 * passou despercebido: o tema aplicava certo e nada parecia errado.
 *
 * O que quebrava era a hidratação. O React reclamava em toda página
 * ("In HTML, <script> cannot be a child of <html>") e, ao encontrar o
 * `data-js` que o script tinha acabado de escrever, tratava como divergência de
 * atributo e refazia a árvore no cliente. Custo invisível em toda visita.
 *
 * Ver node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md,
 * que traz exatamente este caso: <head> em volta, e `suppressHydrationWarning`
 * no <html> porque é o próprio script que muda os atributos da raiz.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

console.log("\no script do tema está no lugar certo");
try {
  const r = await fetch(BASE, { headers: { connection: "close" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} — o servidor de desenvolvimento está no ar?`);
  const html = await r.text();

  const fimDaCabeca = html.indexOf("</head>");
  const posScript = html.indexOf("document.documentElement.dataset.js");

  if (posScript === -1) {
    falhou = true;
    console.log("  ✗ o script de arranque sumiu da página");
  } else if (fimDaCabeca === -1) {
    falhou = true;
    console.log("  ✗ a página não tem </head>");
  } else if (posScript > fimDaCabeca) {
    falhou = true;
    console.log(
      "  ✗ o script está FORA do <head> — o React trata como erro de hidratação " +
        "em toda página e refaz a árvore no cliente",
    );
  } else {
    console.log("  ✓ dentro do <head>, antes do primeiro pixel");
  }

  const tagHtml = html.slice(html.indexOf("<html"), html.indexOf(">", html.indexOf("<html")) + 1);
  if (!/suppresshydrationwarning|data-tema|suppressHydrationWarning/i.test(tagHtml)) {
    /* O atributo não aparece no HTML servido — ele é instrução para o React, não
     * marcação. Confere na fonte, que é onde ele existe. */
    const layout = readFileSync(path.join(RAIZ, "src/app/layout.tsx"), "utf8");
    /* `<html` seguido de ESPAÇO: a tag de verdade tem atributos, e os comentários
     * do arquivo citam "<html>" fechado sem espaço. Procurar só por "<html"
     * casava com o comentário e media a coisa errada. */
    const raiz = layout.match(/<html\s+[^>]*>/)?.[0] ?? "";
    if (!raiz.includes("suppressHydrationWarning")) {
      falhou = true;
      console.log(
        "  ✗ falta `suppressHydrationWarning` no <html> — o script escreve data-js " +
          "e data-tema na raiz, e sem isso o React acusa divergência de atributo",
      );
    } else {
      console.log("  ✓ o <html> avisa o React que os atributos da raiz mudam antes dele");
    }
  }
} catch (e) {
  falhou = true;
  console.log(`  ✗ não consegui conferir — ${e.message}`);
}

/*
 * ── SOBRE FOTOGRAFIA, O TEMA NÃO VALE ────────────────────────────────────
 *
 * A home apoia texto direto em cima de foto de casamento em três seções, mais
 * o cabeçalho que flutua sobre o hero. Foto não é superfície do tema: ela tem a
 * luz que tem, e no tema claro o texto secundário (`--texto-soft`, um cinza
 * médio) aparecia lavado sobre o contraluz dourado do hero — foi assim que o
 * defeito chegou, por print do dono em 27/08/2026.
 *
 * A correção é fixar os tokens dentro de `.sobre-foto`: ali a página é sempre
 * escura, nos dois temas, porque o contraste vem do véu sobre a foto e não da
 * preferência de quem abriu. O piso de contraste medido aqui é o que impede a
 * regressão — sem ele, a próxima mexida na paleta lava o texto de novo e só um
 * print acusaria.
 */
console.log("\nsobre fotografia");

/*
 * São DUAS cópias de `.sobre-foto`, como no `:root`: a de compatibilidade em
 * CSS comum e a que troca com o tema, dentro do `@supports`. A segunda mora ali
 * por obrigação — fora do `@supports`, o Lightning CSS traduz `light-dark()`
 * para variáveis que ele amarra ao primeiro `color-scheme` do arquivo (`dark`),
 * e a regra volta a ser escura nos dois temas sem reclamar de nada.
 */
const BLOCOS_FOTO = [...CSS.matchAll(/\.sobre-foto\s*\{([^}]*)\}/gs)].map((m) => {
  const tokens = new Map();
  for (const [, token, valor] of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(token, valor.trim());
  }
  return tokens;
});
const FIXOS = BLOCOS_FOTO.find((t) => [...t.values()].some((v) => v.includes("light-dark"))) ?? null;
const FOTO_LEGADO = BLOCOS_FOTO.find((t) => t !== FIXOS) ?? null;

etapa("existe uma classe `.sobre-foto` que troca com o tema", () => {
  if (BLOCOS_FOTO.length === 0) throw new Error("não achei `.sobre-foto` em globals.css");
  if (!FIXOS) throw new Error("nenhuma cópia usa light-dark() — a foto não acompanha o tema");
  return `${FIXOS.size} tokens`;
});

etapa("a cópia de compatibilidade de .sobre-foto fica dentro do @supports", () => {
  const guarda = /@supports \(color: light-dark\([^)]*\)\) \{/g;
  const posSupports = [...CSS.matchAll(guarda)].map((m) => m.index);
  const posFoto = [...CSS.matchAll(/\.sobre-foto\s*\{/g)].map((m) => m.index);
  const comLightDark = posFoto.find((p) => /light-dark/.test(CSS.slice(p, CSS.indexOf("}", p))));
  if (comLightDark === undefined) throw new Error("não achei a cópia com light-dark()");
  if (!posSupports.some((p) => p < comLightDark)) {
    throw new Error("a cópia com light-dark() está fora do @supports — o compilador a trava no escuro");
  }
});

etapa("a cópia de compatibilidade de .sobre-foto repete a metade escura", () => {
  if (!FOTO_LEGADO) throw new Error("some a cópia sem light-dark() — navegador antigo fica sem paleta");
  for (const [token, valor] of FIXOS) {
    const m = /^light-dark\((.*)\)$/s.exec(valor);
    if (!m) continue;
    const escuro = dividirNoTopo(m[1])[1];
    const legado = FOTO_LEGADO.get(token);
    if (!legado) throw new Error(`${token} não está na cópia de compatibilidade`);
    if (normalizarCor(legado) !== normalizarCor(escuro)) {
      throw new Error(`${token}: compatibilidade diz ${legado}, o escuro é ${escuro}`);
    }
  }
  return `${FOTO_LEGADO.size} tokens conferidos`;
});

/** Abre `light-dark(a, b)` em { claro, escuro } — ou explode dizendo o porquê. */
function doisLados(token, valor) {
  if (!valor) {
    throw new Error("não é redefinido — herda a paleta da página, que não foi medida sobre foto");
  }
  const m = /^light-dark\((.*)\)$/s.exec(valor);
  if (!m) throw new Error(`não acompanha o tema: ${valor}`);
  const args = dividirNoTopo(m[1]);
  if (args.length !== 2) throw new Error(`light-dark() precisa de 2 valores, veio ${args.length}`);
  for (const cor of args) {
    if (!normalizarCor(cor)) throw new Error(`${token}: "${cor}" não é uma cor que eu saiba medir`);
  }
  return { claro: args[0], escuro: args[1] };
}

const SOBRE_FOTO = ["--texto", "--texto-soft", "--texto-faint", "--void", "--acento"];

for (const token of SOBRE_FOTO) {
  etapa(`${token} acompanha o tema dentro de .sobre-foto`, () => {
    const { claro, escuro } = doisLados(token, FIXOS?.get(token));
    if (normalizarCor(claro) === normalizarCor(escuro)) {
      throw new Error(`os dois lados são a mesma cor (${claro}) — o botão de tema não muda nada`);
    }
    return `${claro} / ${escuro}`;
  });
}

/*
 * O piso vale nos DOIS lados, e é o mesmo piso: o véu clareia ou escurece a
 * foto, mas em qualquer um dos dois o texto tem de sobreviver a ela.
 */
for (const [frente, piso, descricao] of [
  ["--texto", 4.5, "título sobre a foto"],
  ["--texto-soft", 4.5, "linha de apoio sobre a foto"],
  ["--texto-faint", 3, "rótulo pequeno sobre a foto"],
  ["--acento", 4.5, "âmbar sobre a foto"],
]) {
  for (const lado of ["claro", "escuro"]) {
    etapa(`${descricao} no tema ${lado} (${frente})`, () => {
      const a = doisLados(frente, FIXOS?.get(frente))[lado];
      const b = doisLados("--void", FIXOS?.get("--void"))[lado];
      const r = contraste(a, b);
      if (r < piso) throw new Error(`${r.toFixed(2)}:1, piso é ${piso}:1`);
      return `${r.toFixed(1)}:1`;
    });
  }
}

/*
 * A classe só serve se estiver PLANTADA. Toda seção com foto de fundo — o
 * marcador é a imagem em `-z-20`, que é como as três são escritas — precisa
 * carregá-la, e o cabeçalho junto, porque ele flutua sobre o hero.
 */
etapa("toda seção com foto de fundo carrega .sobre-foto", () => {
  const HOME = readFileSync(path.join(RAIZ, "src/app/page.tsx"), "utf8");
  const secoes = HOME.split(/(?=<section)/).filter((t) => t.startsWith("<section"));
  const comFoto = secoes.filter((t) => t.includes("-z-20"));
  if (comFoto.length === 0) throw new Error("nenhuma seção com foto de fundo — o marcador mudou?");
  const nuas = comFoto.filter((t) => !/<section[^>]*sobre-foto/.test(t));
  if (nuas.length) {
    throw new Error(
      `${nuas.length} de ${comFoto.length} seção(ões) com foto sem a classe — ` +
        `no tema claro o texto delas fica lavado`,
    );
  }
  return `${comFoto.length} seções`;
});

etapa("o cabeçalho que flutua sobre o hero carrega .sobre-foto", () => {
  const HOME = readFileSync(path.join(RAIZ, "src/app/page.tsx"), "utf8");
  const cabecalho = /<header[^>]*>/.exec(HOME)?.[0] ?? "";
  if (!cabecalho) throw new Error("não achei o <header> da home");
  if (!cabecalho.includes("sobre-foto")) {
    throw new Error("o <header> segue o tema — sobre o hero escuro ele some no claro");
  }
});

/*
 * A MARCA NÃO TEM FUNDO.
 *
 * O núcleo do símbolo era pintado com `--marca-fundo` para tapar as órbitas que
 * passam atrás dele. Funciona sobre a página; sobre FOTO vira um disco branco
 * (tema claro) ou preto (tema escuro) grudado na logo — que foi exatamente o
 * que o dono viu. O recorte passa a ser feito por máscara, que esconde sem
 * pintar.
 */
etapa("o símbolo da marca não pinta fundo nenhum", () => {
  const TILE = readFileSync(path.join(RAIZ, "src/components/marca-tile.tsx"), "utf8");
  /* O que é proibido é PINTAR, não citar: o comentário do arquivo explica por
   * que o disco saiu, e uma busca solta por "--marca-fundo" reprovaria a
   * própria explicação. Só o atributo `fill` conta. */
  const pintado = /fill\s*=\s*["{]?["']?var\(--[a-z-]*fundo\)/.exec(TILE);
  if (pintado) {
    throw new Error(`ainda pinta fundo (${pintado[0]}) — sobre foto isso é um disco opaco na logo`);
  }
  if (!/fill="none"/.test(TILE)) {
    throw new Error("o núcleo precisa ser `fill=\"none\"` para a foto aparecer por dentro dele");
  }
  if (!/<mask/.test(TILE)) {
    throw new Error("sem máscara: sem ela as órbitas cruzam por dentro da câmera");
  }
});

console.log(falhou ? "\n✗ tema com problema" : "\n✓ tema ok");
process.exitCode = falhou ? 1 : 0;
