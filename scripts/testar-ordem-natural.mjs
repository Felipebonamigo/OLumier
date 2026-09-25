#!/usr/bin/env node
/**
 * A COLORIDA VEM ANTES DA SUA VARIANTE EM PRETO-E-BRANCO. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *        scripts/testar-ordem-natural.mjs
 *
 * Não fala com banco nem com servidor: é a função pura de `lib/ordem-natural.ts`.
 *
 * ── DE ONDE VEIO (25/09/2026) ──────────────────────────────────────────────
 *
 * Juan, numa galeria de verdade, com pares de foto colorida + preto-e-branco:
 *
 *   "Nas horizontais; a preto e branco tá na frente" — a PB vindo ANTES da
 *   colorida na ordem "Nome A → Z". "Eu cheguei a atualizar ali os capítulos
 *   'por ordem de nome A-Z'. E ainda assim nothing happened" — ou seja, a
 *   galeria JÁ estava nessa ordem: o defeito nasce no ENVIO, não só na tela
 *   de reordenar.
 *
 * A causa: o editor dele nomeia a variante em PB com um sufixo colado —
 * "-PB", "_bw", " (PB)", o formato varia — e comparando o NOME INTEIRO (com
 * a extensão), o "." do arquivo colorido cai bem onde o sufixo do outro
 * começa. "-" (e espaço, e "(") vêm ANTES de "." em qualquer tabela de
 * caracteres, então o arquivo COM sufixo "ganha" a comparação e sai primeiro
 * — o oposto do que qualquer fotógrafo espera. Ver o comentário de
 * `lib/ordem-natural.ts` para a conta completa.
 *
 * ── O QUE ESTE TESTE PRENDE ────────────────────────────────────────────────
 *
 * 1. Qualquer separador comum antes do sufixo (-, _, espaço, parênteses) dá
 *    "colorida antes da PB", não o contrário.
 * 2. Isso não quebra o que já funcionava: números naturais ("foto_2" antes
 *    de "foto_10"), maiúsc./minúsc., acento.
 * 3. `ordenarNaturalPorCaminho` (a ordem do ENVIO) usa a MESMA regra — é o
 *    upload que nasce certo, e não só o botão de reordenar depois.
 */
import { compararNomeNatural } from "../src/lib/ordem-natural.ts";

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const extra = fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

console.log("\nA colorida antes da sua variante em preto-e-branco:\n");

const PARES = [
  ["DSC1234.jpg", "DSC1234-PB.jpg", "hífen, maiúsculo"],
  ["DSC1234.jpg", "DSC1234-pb.jpg", "hífen, minúsculo"],
  ["DSC1234.jpg", "DSC1234_bw.jpg", "sublinhado"],
  ["DSC1234.jpg", "DSC1234 PB.jpg", "espaço"],
  ["lu-042.jpg", "lu-042 (PB).jpg", "parênteses"],
  ["sirius-jugusw-1070.jpg", "sirius-jugusw-1070-pb.jpg", "o nome real do print do Juan"],
];

for (const [cor, pb, rotulo] of PARES) {
  etapa(`"${cor}" antes de "${pb}" (${rotulo})`, () => {
    const r = compararNomeNatural(cor, pb);
    if (!(r < 0)) {
      throw new Error(`veio ${r >= 0 ? "PB antes da colorida" : "empate"} — o sufixo venceu a extensão`);
    }
  });
}

etapa("o mesmo par, mas Z→A (chamando ao contrário) também acerta", () => {
  const r = compararNomeNatural("DSC1234-PB.jpg", "DSC1234.jpg");
  if (!(r > 0)) throw new Error(`veio ${r}, esperava positivo (a PB depois)`);
});

console.log("\nO que já funcionava continua funcionando:\n");

etapa("numérico: foto_2 antes de foto_10", () => {
  if (!(compararNomeNatural("foto_2.jpg", "foto_10.jpg") < 0)) {
    throw new Error("perdeu a ordenação natural de números");
  }
});

etapa("sem acento e sem caixa: base = sensitivity", () => {
  if (compararNomeNatural("FOTO.jpg", "foto.jpg") !== 0) {
    throw new Error("caixa diferente parou de empatar");
  }
});

etapa("nomes sem relação continuam na ordem alfabética", () => {
  if (!(compararNomeNatural("abelha.jpg", "zebra.jpg") < 0)) {
    throw new Error("perdeu a ordem alfabética comum");
  }
});

etapa("mesmo nome, extensões diferentes: empata (não inventa ordem)", () => {
  /* Caso raro (a mesma capa exportada em .jpg e .png), e correto empatar: o
     desempate de verdade é ordem/criado_em/id, nunca este comparador sozinho. */
  if (compararNomeNatural("capa.jpg", "capa.png") !== 0) {
    throw new Error("nomes iguais sem extensão deveriam empatar");
  }
});

etapa("caminho com pasta: só a extensão do ARQUIVO sai da conta", () => {
  const antes = compararNomeNatural(
    "01 Cerimônia/dsc1234.jpg",
    "01 Cerimônia/dsc1234-pb.jpg",
  );
  if (!(antes < 0)) throw new Error("caminho com pasta não corrigiu a ordem");
  /* E pastas diferentes continuam mandando na ordem — "01" antes de "02". */
  const pastas = compararNomeNatural("01 Making Of/z.jpg", "02 Cerimônia/a.jpg");
  if (!(pastas < 0)) throw new Error("a ordem das pastas se perdeu");
});

console.log(
  falhou ? "\n✗ a ordem natural tem problema" : "\n✓ a colorida vem antes da preto-e-branco\n",
);
process.exit(falhou ? 1 : 0);
