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

console.log(falhou ? "\n✗ tema com problema" : "\n✓ tema ok");
process.exit(falhou ? 1 : 0);
