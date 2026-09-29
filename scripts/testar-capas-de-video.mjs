#!/usr/bin/env node
/**
 * A REGRA DO MUTIRÃO DAS CAPAS DE VÍDEO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-capas-de-video.mjs
 *
 * Suíte PURA: sem banco, sem rede. A decisão que autoriza uma ESCRITA no banco
 * de produção precisa poder ser conferida sem nada por perto — é a mesma razão
 * de `varrer-orfaos-regras.mjs` existir separado do varredor.
 *
 * ── O PEDIDO, E O QUE ELE VIROU (29/09/2026) ──────────────────────────────
 *
 * Felipe: "faça a aba de vídeo e o script das capas que faltam". O pedido nasceu
 * achando que faltavam capas. Medindo produção, o quadro era outro: das 46, só 2
 * não tinham capa — e 41 tinham uma capa BRANCA, byte a byte idêntica entre
 * estúdios diferentes.
 *
 * Então "as capas que faltam" não é `chave_thumb is null`. É isso mais as capas
 * que existem e não são capa de nada.
 */
import { classificarCapas, paraRegerar, BYTES_SUSPEITOS } from "./capas-de-video-regras.mjs";

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const extra = fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    falhou = true;
    console.error(`  ✗ ${nome} — ${e.message}`);
  }
};
const igual = (a, b, oque) => {
  if (a !== b) throw new Error(`${oque}: esperava ${b}, veio ${a}`);
};

const v = (over) => ({
  id: "x",
  chave: "k",
  bytes: 400_000,
  hash: "unico",
  galeria: "G",
  nome: "f.mov",
  ...over,
});

console.log("Quem precisa de capa nova\n");

etapa("sem chave nenhuma é “sem capa”", () => {
  const [c] = classificarCapas([v({ chave: null, hash: null })]);
  igual(c.situacao, "sem-capa", "situação");
  return c.motivo;
});

etapa("chave gravada mas objeto ausente também é “sem capa”", () => {
  /* Acontece quando o envio confirmou e o PUT da derivada falhou depois: a
     coluna aponta para um objeto que não existe, e a grade cai no original. */
  const [c] = classificarCapas([v({ hash: null })]);
  igual(c.situacao, "sem-capa", "situação");
  return c.motivo;
});

etapa("capa repetida entre vídeos diferentes é de fábrica", () => {
  /*
   * O coração da regra, e a evidência que dispensa decodificar imagem: duas
   * fotos diferentes não produzem o mesmo arquivo. Em produção eram 40 vídeos
   * com o mesmo PNG de 4.195 bytes, em três estúdios.
   */
  const lista = classificarCapas([
    v({ id: "a", hash: "mesma", bytes: 4195 }),
    v({ id: "b", hash: "mesma", bytes: 4195 }),
    v({ id: "c", hash: "mesma", bytes: 4195 }),
  ]);
  for (const c of lista) igual(c.situacao, "de-fabrica", `situação de ${c.id}`);
  if (!/outros 2/.test(lista[0].motivo)) throw new Error(`motivo pobre: ${lista[0].motivo}`);
  return lista[0].motivo;
});

etapa("capa única e pesada é aceita", () => {
  const [c] = classificarCapas([v({ hash: "so-dele", bytes: 480_000 })]);
  igual(c.situacao, "ok", "situação");
  return "480 KB";
});

etapa("capa única porém minúscula é suspeita", () => {
  /*
   * A segunda evidência, para o vídeo que saiu branco sem par. Erra para o lado
   * seguro: no máximo manda regerar uma capa legítima e simples, e regerar não
   * destrói nada.
   */
  const [c] = classificarCapas([v({ hash: "sozinha", bytes: 4195 })]);
  igual(c.situacao, "suspeita", "situação");
  return `< ${BYTES_SUSPEITOS} bytes`;
});

etapa("o limite do suspeito não pega capa boa de raspão", () => {
  const [c] = classificarCapas([v({ hash: "u", bytes: BYTES_SUSPEITOS })]);
  igual(c.situacao, "ok", "situação no limite exato");
  return `${BYTES_SUSPEITOS} bytes passa`;
});

etapa("duas capas boas e iguais por acaso NÃO existem, mas o caso é tratado", () => {
  /*
   * Se dois vídeos idênticos forem enviados duas vezes, as capas serão
   * idênticas de verdade — e a regra vai marcá-las. Regerar as duas devolve o
   * mesmo par idêntico, e elas voltam a ser marcadas na varredura seguinte.
   *
   * É um laço, e ele é ACEITÁVEL: custa duas miniaturas por varredura e nunca
   * apaga nada. O contrário — deixar passar 40 capas brancas para não incomodar
   * um duplicado hipotético — foi o que produziu este problema.
   */
  const lista = classificarCapas([
    v({ id: "a", hash: "gemea", bytes: 480_000 }),
    v({ id: "b", hash: "gemea", bytes: 480_000 }),
  ]);
  igual(lista[0].situacao, "de-fabrica", "situação");
  return "marcadas, e o laço é assumido";
});

etapa("a fila de regerar junta as três situações e deixa a boa de fora", () => {
  const lista = classificarCapas([
    v({ id: "a", chave: null, hash: null }),
    v({ id: "b", hash: "m", bytes: 4195 }),
    v({ id: "c", hash: "m", bytes: 4195 }),
    v({ id: "d", hash: "boa", bytes: 400_000 }),
    v({ id: "e", hash: "curta", bytes: 900 }),
  ]);
  const fila = paraRegerar(lista);
  igual(fila.length, 4, "quantas entram na fila");
  if (fila.some((f) => f.id === "d")) throw new Error("a capa boa entrou na fila");
  return "4 de 5";
});

etapa("lista vazia não quebra", () => {
  igual(classificarCapas([]).length, 0, "vazia");
  igual(paraRegerar([]).length, 0, "fila vazia");
  return "zero";
});

console.log(falhou ? "\n✗ a regra das capas não fecha" : "\n✓ regra das capas ok");
process.exitCode = falhou ? 1 : 0;
