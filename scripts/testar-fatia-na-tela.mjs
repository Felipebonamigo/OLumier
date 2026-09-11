#!/usr/bin/env node
/**
 * O que a galeria FATIADA promete ao convidado. Uso:
 *   node --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-fatia-na-tela.mjs
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ───────────────────────────────────────────
 *
 * O corte por fatia (11/09/2026, ver `config/fatia-galeria.ts`) resolveu o
 * Safari da Carol e abriu uma família inteira de defeitos do mesmo feitio:
 * pedaços da tela que continuaram falando como se `itens` fosse a galeria.
 * Três já apareceram, um por vez, cada um descoberto por uma pessoa:
 *
 *   · a Atividade registrando "baixou tudo" com 600 de 2108
 *   · a busca por rosto dizendo 37 e mostrando 9
 *   · "baixar as favoritas" levando só as do capítulo aberto
 *
 * O padrão é sempre o mesmo — um número certo ao lado de um conteúdo errado —
 * e por isso vale um arquivo que pergunte de uma vez por todos os lugares onde
 * a fatia pode virar promessa falsa, em vez de esperar a próxima pessoa achar.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const cliente = readFileSync(path.join(RAIZ, "src/components/galeria-cliente.tsx"), "utf8");

let falhou = false;
const ok = (m, extra) => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ""}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

console.log("A fatia não pode virar promessa falsa\n");

/*
 * ── A PASTA QUE NÃO ESTÁ CARREGADA ────────────────────────────────────────
 *
 * `capitulos` passou a trazer, numa galeria fatiada, também os que NÃO vieram
 * nesta parte — o menu precisa deles para poder navegar. `pastasParaBaixar`
 * mapeia essa lista inteira e usa `indices.length` como contagem.
 *
 * Resultado: numa galeria de sete capítulos, seis entradas dizem "(0)" e não
 * baixam nada quando tocadas. O convidado vê a pasta com o nome certo, toca, e
 * não acontece coisa nenhuma.
 */
const pastas = cliente.slice(
  cliente.indexOf("const pastasParaBaixar"),
  cliente.indexOf("const swipe"),
);
if (!pastas) {
  erro("não achei o monte das pastas de download");
} else {
  /* Duas exigências, e as duas precisam: o NÚMERO tem de ser o da galeria
     (`total`), senão a pasta que não veio aparece como "(0)"; e a AÇÃO tem de
     olhar se a pasta está carregada, senão tocar nela não faz nada. Conferir só
     uma deixa passar metade do defeito. */
  if (/quantas:\s*c\.total\b/.test(pastas)) {
    ok("a pasta mostra quantas fotos tem na galeria, não nesta fatia");
  } else {
    erro('o menu de baixar conta só o que está carregado — a pasta que não veio aparece como "(0)"');
  }

  if (/c\.indices\.length\s*>\s*0\s*\?/.test(pastas)) {
    ok("e tocar numa pasta não carregada leva até ela, em vez de não fazer nada");
  } else {
    erro("tocar numa pasta que não veio nesta fatia não baixaria nada");
  }
}

/*
 * ── O CONTADOR DO VISUALIZADOR ────────────────────────────────────────────
 *
 * "3 de 600" numa galeria de 2108 não é errado por pouco: é o número que o
 * convidado usa para saber se já viu tudo. Ou fala da galeria, ou diz de que
 * parte está falando — o que não pode é passar por total.
 */
const visualizador = cliente.slice(cliente.indexOf('role="dialog"'));
/* Contar `itens.length` não é o erro — o índice aberto É dentro da fatia. O
   erro é não DIZER que é a parte. Então o que se exige é a ressalva ao lado do
   número, e não outro número. */
const contador = visualizador.match(/\{aberto! \+ 1\} de \{[^}]+\}([\s\S]{0,140})/)?.[1] ?? "";
if (!contador) {
  erro("não achei o contador do visualizador");
} else if (/fatia/.test(contador)) {
  ok("o contador avisa quando está falando de uma parte só");
} else {
  erro(`o contador passa a fatia por total — "3 de 600" numa galeria de 2108`);
}

/*
 * ── A PROMESSA ESCRITA NO TIPO ────────────────────────────────────────────
 *
 * O comentário de `CapituloGaleria` diz que "o lightbox continua percorrendo a
 * galeria inteira". Era verdade até o corte; hoje as setas andam só dentro da
 * fatia. Comentário que promete o que o código não faz mais é pior que
 * comentário nenhum — a próxima pessoa confia nele.
 */
const tipo = cliente.slice(cliente.indexOf("export interface CapituloGaleria"), cliente.indexOf("}", cliente.indexOf("export interface CapituloGaleria")));
/* A promessa é o PRESENTE do verbo: "continua percorrendo". Explicar que antes
   percorria é o contrário de prometer, e não pode derrubar o teste. */
if (/continua percorrendo a galeria inteira/.test(tipo)) {
  erro("o tipo ainda promete que o visualizador percorre a galeria inteira — não percorre mais");
} else {
  ok("o tipo não promete mais percorrer a galeria inteira");
}

if (falhou) {
  console.error("\n✗ a galeria fatiada ainda promete o que não entrega");
  process.exit(1);
}
console.log("\n✓ a fatia diz o que é, em todo lugar onde fala");
