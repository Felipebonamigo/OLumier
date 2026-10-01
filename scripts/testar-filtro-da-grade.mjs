#!/usr/bin/env node
/**
 * Testa o RECORTE DA GRADE da aba "Fotos e vídeos". Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-filtro-da-grade.mjs
 *
 * Juan, 01/10/2026, com 4.000 fotos em 15 capítulos: "Subi 200 fotos em um
 * capítulo X. Mas, 6 fotos repetiram, quero remover elas. Impossível eu achar
 * (…). Ainda não tem como visualizar as fotos que tem em cada capítulo." O
 * que esta suíte prende:
 *
 *   - repetida é mesmo nome E mesmo tamanho, e fica a que o cliente escolheu;
 *   - "ver as fotos" do capítulo e "ver as repetidas" do aviso mudam a grade;
 *   - apagar e mover agem só sobre o que está à vista.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const fonte = (arq) => readFileSync(path.join(RAIZ, arq), "utf8");
const { copiasRepetidas, verNaGrade, lerEstadoDaGrade, mudarEstadoDaGrade, ouvirEstadoDaGrade, ESTADO_INICIAL } =
  await import("../src/lib/filtro-da-grade.ts");

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
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${o}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
};

console.log("O recorte da grade\n");

await etapa("repetida é mesmo nome E mesmo tamanho", () => {
  const r = copiasRepetidas([
    { id: "a1", nome: "IMG_1.jpg", bytes: 100 },
    { id: "b1", nome: "IMG_2.jpg", bytes: 100 },
    { id: "a2", nome: "IMG_1.jpg", bytes: 100 },
    { id: "c1", nome: "IMG_3.jpg", bytes: 100 },
    { id: "c2", nome: "IMG_3.jpg", bytes: 999 },
  ]);
  igual([...r.repetidas].sort(), ["a1", "a2"], "repetidas");
  igual(r.extras, ["a2"], "extras");
  igual(r.grupos, 1, "grupos");
  return "IMG_3 com tamanhos diferentes são duas fotos";
});

await etapa("fica a que o cliente marcou; empatando, a primeira da galeria", () => {
  const r = copiasRepetidas([
    { id: "x1", nome: "A.jpg", bytes: 5 },
    { id: "x2", nome: "A.jpg", bytes: 5, favoritas: 1 },
    { id: "x3", nome: "A.jpg", bytes: 5 },
    { id: "y1", nome: "B.jpg", bytes: 7 },
    { id: "y2", nome: "B.jpg", bytes: 7, baixadas: 2 },
    { id: "z1", nome: "C.jpg", bytes: 9 },
    { id: "z2", nome: "C.jpg", bytes: 9 },
  ]);
  igual(r.extras.sort(), ["x1", "x3", "y1", "z2"], "extras");
  igual(r.grupos, 3, "grupos");
  return "a favorita e a baixada ficam";
});

await etapa("ver na grade abre a grade no recorte, por galeria", () => {
  igual(lerEstadoDaGrade("g1"), ESTADO_INICIAL, "começa em todas");
  let avisos = 0;
  const parar = ouvirEstadoDaGrade("g1", () => avisos++);
  mudarEstadoDaGrade("g1", { aberta: false });
  verNaGrade("g1", "cap:123");
  igual(lerEstadoDaGrade("g1"), { filtro: "cap:123", aberta: true }, "g1");
  igual(lerEstadoDaGrade("g2"), ESTADO_INICIAL, "outra galeria não muda");
  parar();
  igual(avisos, 2, "avisos");
});

await etapa("as três portas apontam para a grade", () => {
  const editor = fonte("src/components/editor-secoes.tsx");
  if (!/verNaGrade\(galeriaId, `cap:\$\{s\.id\}`\)/.test(editor)) throw new Error("o capítulo não mostra as fotos dele");
  if (!/verNaGrade\(galeriaId, "sem-capitulo"\)/.test(editor)) throw new Error("as sem capítulo não têm caminho");
  const aviso = fonte("src/components/aviso-de-repetidas.tsx");
  if (!/<VerNaGrade[^>]*filtro="repetidas"/.test(aviso)) throw new Error("o aviso de repetidas não leva às repetidas");
  const grade = fonte("src/components/grade-medias.tsx");
  if (!/id=\{ID_DA_GRADE\}/.test(grade)) throw new Error("a grade não tem o endereço para onde a tela desce");
  return "capítulo, sem capítulo, aviso";
});

await etapa("apagar, mover e arrastar agem só sobre o que está à vista", () => {
  /* Marcar dez no capítulo X, trocar para o Y e apagar não pode levar as dez
     escondidas. Toda ação parte de `marcadas` (a seleção recortada), nunca da
     seleção inteira. */
  const grade = fonte("src/components/grade-medias.tsx").replace(/\/\*[^]*?\*\//g, "");
  const corpo = (nome) => grade.match(new RegExp(`function ${nome}\\([^]*?\\n  \\}`))?.[0] ?? "";
  for (const f of ["apagarSelecionadas", "moverPara", "moverSelecao", "comecarArrasto"]) {
    const c = corpo(f);
    if (!c) throw new Error(`não achei ${f}`);
    if (/\bselecao\b/.test(c)) throw new Error(`${f} usa a seleção inteira, com as escondidas`);
  }
  if (!/selecionada=\{marcadas\.has\(m\.id\)\}/.test(grade)) throw new Error("o ladrilho mostra a seleção escondida");
  return "4 ações sobre `marcadas`";
});

console.log(falhou ? "\n✗ o recorte da grade tem problema" : "\n✓ recorte da grade ok");
process.exit(falhou ? 1 : 0);
