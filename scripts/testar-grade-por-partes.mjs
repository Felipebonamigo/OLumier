#!/usr/bin/env node
/**
 * A grade desenha por partes, e nada além do desenho muda. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-grade-por-partes.mjs
 *
 * ── O DEFEITO (26/09/2026) ────────────────────────────────────────────────
 *
 * "A galeria parece lenta para abrir." A galeria de 600 fotos saía com 600
 * cards no documento — 6.113 nós, 1,88 MB de HTML — e um celular médio levava
 * 2,1 s para ficar pronto, com a tela travada por 1,7 s. Agora ela nasce com
 * `PRIMEIRA_LEVA` cards e ganha `LEVA` a cada aproximação do fim. Ver
 * `src/lib/grade-por-partes.ts`.
 *
 * O que este arquivo prende é o CORTE — é nele que um erro esconde foto:
 *
 *   1. o limite conta foto VISÍVEL, não posição (senão "só as favoritas" abre
 *      em branco quando as marcadas estão no fim);
 *   2. cada leva continua a anterior, sem pular nem repetir foto;
 *   3. o capítulo que ainda não chegou fica na lista, vazio — o menu de
 *      capítulos procura a seção dele desde o começo;
 *   4. a página usa o corte (e não os capítulos crus) para desenhar.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { recortarParaDesenhar, PRIMEIRA_LEVA, LEVA } from "../src/lib/grade-por-partes.ts";

let falhou = false;
const ok = (m, extra) => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ""}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

/* Capítulos como a página os monta: índices contíguos, na ordem da galeria. */
function galeria(...tamanhos) {
  let proximo = 0;
  return tamanhos.map((n, c) => ({
    id: `cap-${c}`,
    nome: `Capítulo ${c}`,
    total: n,
    indices: Array.from({ length: n }, () => proximo++),
  }));
}
const todas = () => true;
const desenhadas = (d) => d.capitulos.flatMap((c) => c.indices);

console.log("As levas\n");

/* Os números escritos à mão: tabela lida da própria fonte concorda com
   qualquer mudança e não confere nada. Mudar a primeira leva muda o que o
   celular do convidado monta antes de responder, e tem de doer aqui. */
if (PRIMEIRA_LEVA === 60) ok("a primeira leva é de 60 cards");
else erro(`a primeira leva virou ${PRIMEIRA_LEVA} — medir de novo antes de mudar`);
if (LEVA === 120) ok("as seguintes são de 120");
else erro(`a leva virou ${LEVA}`);
/* O comentário da constante promete fileiras inteiras nas grades comuns. */
const quebradas = [2, 3, 4, 5, 6].filter((c) => PRIMEIRA_LEVA % c !== 0);
if (quebradas.length === 0) ok("a primeira leva fecha fileiras inteiras em 2 a 6 colunas");
else erro(`a primeira leva deixa a última fileira pela metade em ${quebradas.join(", ")} colunas`);

console.log("\nO corte\n");

{
  const pequena = galeria(20, 15);
  const d = recortarParaDesenhar(pequena, todas, PRIMEIRA_LEVA);
  if (!d.falta && desenhadas(d).length === 35 && d.visiveis === 35) {
    ok("galeria menor que a primeira leva sai inteira, sem sentinela");
  } else {
    erro(`galeria de 35 fotos: desenhou ${desenhadas(d).length}, falta=${d.falta}`);
  }
}

{
  /* A bancada da medição: 600 fotos em três capítulos. */
  const g = galeria(150, 210, 240);
  const d = recortarParaDesenhar(g, todas, PRIMEIRA_LEVA);
  const [a, b, c] = d.capitulos;
  if (desenhadas(d).length === PRIMEIRA_LEVA && d.falta && d.visiveis === 600) {
    ok(`600 fotos saem com ${PRIMEIRA_LEVA} desenhadas e a sentinela ligada`);
  } else {
    erro(`600 fotos: desenhou ${desenhadas(d).length}, falta=${d.falta}, visíveis=${d.visiveis}`);
  }
  if (d.capitulos.length === 3 && a.indices.length === 60 && b.indices.length === 0 && c.indices.length === 0) {
    ok("os capítulos que a rolagem ainda não alcançou ficam na lista, vazios");
  } else {
    erro(`capítulos: ${d.capitulos.map((x) => `${x.id}=${x.indices.length}`).join(", ")}`);
  }
  if (d.capitulos.map((x) => x.id).join() === "cap-0,cap-1,cap-2") ok("na ordem da página");
  else erro(`a ordem virou ${d.capitulos.map((x) => x.id).join()}`);
  if (a.nome === "Capítulo 0" && a.total === 150) ok("o capítulo cortado guarda nome e total");
  else erro("o corte perdeu os outros campos do capítulo");

  /* Leva após leva até o fim: cada uma é a anterior MAIS as seguintes. */
  let limite = PRIMEIRA_LEVA;
  let anterior = desenhadas(d);
  let emOrdem = true;
  let levas = 0;
  while (recortarParaDesenhar(g, todas, limite).falta) {
    limite += LEVA;
    levas++;
    const agora = desenhadas(recortarParaDesenhar(g, todas, limite));
    if (agora.slice(0, anterior.length).join() !== anterior.join()) emOrdem = false;
    anterior = agora;
  }
  const esperado = Array.from({ length: 600 }, (_, i) => i).join();
  if (emOrdem && anterior.join() === esperado) {
    ok(`em ${levas} levas a grade chega às 600, sem pular nem repetir foto`);
  } else {
    erro("uma leva mudou o que já estava desenhado, ou a grade terminou incompleta");
  }

  const cruzando = recortarParaDesenhar(g, todas, 180);
  if (cruzando.capitulos[0].indices.length === 150 && cruzando.capitulos[1].indices.length === 30) {
    ok("a leva atravessa a emenda dos capítulos", "150 + 30");
  } else {
    erro(`limite 180: ${cruzando.capitulos.map((x) => x.indices.length).join(" + ")}`);
  }

  /* A grade "Colunas" só reparte a última fileira no fim de verdade do
     capítulo (ver `fileirasDeColunas`). Chamar de inteiro o capítulo cortado
     pela leva faria as fotos do fim dela mudarem de fileira quando a leva
     seguinte entrasse. */
  const inteiros = cruzando.capitulos.map((x) => x.inteiro).join();
  if (inteiros === "true,false,false") {
    ok("só o capítulo que o desenho alcançou inteiro é marcado inteiro");
  } else {
    erro(`limite 180 marcou inteiros: ${inteiros} — esperava true,false,false`);
  }
  const tudo = recortarParaDesenhar(g, todas, 600).capitulos.map((x) => x.inteiro).join();
  if (tudo === "true,true,true") ok("e, desenhada a galeria toda, todos são");
  else erro(`com as 600 desenhadas: ${tudo}`);
}

console.log("\nCom filtro ligado\n");

{
  const g = galeria(150, 210, 240);
  /* As favoritas todas no fim — a foto 400 em diante. Um corte por posição
     desenharia as 60 primeiras posições, nenhuma delas marcada. */
  const favoritas = new Set(Array.from({ length: 12 }, (_, i) => 400 + i * 7));
  const soFavoritas = (i) => favoritas.has(i);
  const d = recortarParaDesenhar(g, soFavoritas, PRIMEIRA_LEVA);
  if (desenhadas(d).length === 12 && !d.falta) {
    ok("as favoritas do fim da galeria aparecem na primeira leva", "12 de 12");
  } else {
    erro(`com 12 favoritas no fim, desenhou ${desenhadas(d).length} (falta=${d.falta})`);
  }
  if (d.capitulos.length === 1 && d.capitulos[0].id === "cap-2") {
    ok("capítulo sem nenhuma favorita some, como sempre sumiu");
  } else {
    erro(`capítulos com filtro: ${d.capitulos.map((x) => x.id).join()}`);
  }

  /* Muitas visíveis: o limite vale sobre elas, não sobre as posições. */
  const pares = (i) => i % 2 === 0;
  const p = recortarParaDesenhar(g, pares, PRIMEIRA_LEVA);
  if (desenhadas(p).length === PRIMEIRA_LEVA && p.visiveis === 300 && p.falta) {
    ok("o limite conta as fotos visíveis", `${PRIMEIRA_LEVA} de 300`);
  } else {
    erro(`filtro de pares: desenhou ${desenhadas(p).length} de ${p.visiveis}`);
  }
}

console.log("\nA página usa o corte\n");

{
  const RAIZ = path.resolve(import.meta.dirname, "..");
  const cliente = readFileSync(path.join(RAIZ, "src/components/galeria-cliente.tsx"), "utf8");
  /* A grade tem de sair de `desenho.capitulos`. Voltar a `capitulos.map` no
     desenho devolveria os 600 cards ao documento sem nenhum outro sintoma. */
  if (/\{desenho\.capitulos\.map\(/.test(cliente)) ok("a grade desenha a partir do corte");
  else erro("a grade não desenha mais a partir de `desenho.capitulos`");
  if (/useState\(PRIMEIRA_LEVA\)/.test(cliente)) ok("e nasce com a primeira leva");
  else erro("o limite do desenho não nasce na primeira leva");
  /* A sentinela da rede (galeria fatiada) só vale depois do desenho completo:
     antes disso ela pediria ao servidor fotos que já estão na memória. */
  if (/faltaDesenhar \? \(\s*<div ref=\{sentinelaDoDesenho\}/.test(cliente)) {
    ok("a rede só é chamada depois que o que já chegou foi desenhado");
  } else {
    erro("a sentinela do desenho não vem antes da sentinela da rede");
  }
  /*
   * E o observador da rede tem de ACORDAR quando o desenho acaba. A sentinela
   * dele só entra na página nesse momento; um efeito que não depende de
   * `faltaDesenhar` roda uma vez, não a encontra, e nunca mais olha. Foi o que
   * aconteceu na primeira versão desta mudança: a galeria de 2100 fotos parava
   * nas 600 do documento, conferido rolando no navegador.
   */
  const efeitoDaRede = cliente.match(/const alvo = sentinela\.current;[\s\S]*?\}, \[([^\]]*)\]\);/);
  if (efeitoDaRede && /\bfaltaDesenhar\b/.test(efeitoDaRede[1])) {
    ok("e o observador da rede acorda quando o desenho acaba");
  } else {
    erro(
      `o efeito da sentinela da rede não depende de faltaDesenhar (${efeitoDaRede?.[1] ?? "efeito não encontrado"}) — ` +
        "a galeria fatiada para nas primeiras fotos",
    );
  }
}

if (falhou) {
  console.error("\n✗ o desenho por partes tem problema");
  process.exit(1);
}
console.log("\n✓ a grade desenha por partes");
