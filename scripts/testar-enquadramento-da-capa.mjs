/*
 * ── O ENQUADRAMENTO DA CAPA (05/10/2026) ──────────────────────────────────
 *
 * Juan, por áudio e vídeo da tela:
 *
 *   "A prévia poderia ser desse mesmo tamanho que a parte de selecionar o
 *    enquadramento da capa"
 *   "E o enquadramento poderia estar dentro de um botão chamado 'enquadramento
 *    da capa', que quando clicasse nele abriria a foto pra escolher com a
 *    bolinha onde fica o centro"
 *
 * Medido antes de mexer: a Prévia tinha 927×578 e o enquadramento 384×224. O
 * pequeno dos dois era o enquadramento, então a frase foi lida ao contrário do
 * literal — confirmado com o Felipe: aumentar o enquadramento.
 *
 * Aumentar o quadro trouxe junto um defeito que era pequeno porque o quadro
 * era pequeno: a conta do clique media contra o QUADRO, e a foto é desenhada
 * com `object-contain` — ela quase nunca preenche o quadro. Ver `pontoNaFoto`.
 */
import { pontoNaFoto } from "../src/lib/enquadramento.ts";

let vermelhas = 0;
function etapa(nome, fn) {
  try {
    const nota = fn();
    console.log(`  ✓ ${nome}${nota ? ` — ${nota}` : ""}`);
  } catch (e) {
    vermelhas++;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, oque) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${oque}: ${JSON.stringify(a)} em vez de ${JSON.stringify(b)}`);
  }
};

console.log("O enquadramento da capa:\n");

/* ── A CONTA DO CLIQUE ───────────────────────────────────────────────────── */

etapa("quadro na mesma proporção da foto: o clique é onde parece", () => {
  const p = pontoNaFoto({
    quadro: { largura: 800, altura: 600 },
    foto: { largura: 1600, altura: 1200 },
    clique: { x: 200, y: 150 },
  });
  igual(p, { x: 25, y: 25 }, "um quarto do caminho");
  return "25% 25%";
});

etapa("foto deitada em quadro alto: a faixa vazia não entra na conta", () => {
  /* 1600×900 num quadro 800×600: a foto desenha 800×450 e sobram 75px de faixa
     em cima e embaixo. Clicar no MEIO VERTICAL da foto é y=300 no quadro. */
  const p = pontoNaFoto({
    quadro: { largura: 800, altura: 600 },
    foto: { largura: 1600, altura: 900 },
    clique: { x: 400, y: 300 },
  });
  igual(p, { x: 50, y: 50 }, "o meio da foto");
  return "o centro é o centro";
});

etapa("e o erro que a conta antiga cometia era grande", () => {
  /* Mesma foto deitada. O TOPO da foto está em y=75 no quadro. Medindo contra o
     quadro daria 12% — a conta certa diz 0%. Doze por cento de uma capa é o
     rosto inteiro de alguém. */
  const p = pontoNaFoto({
    quadro: { largura: 800, altura: 600 },
    foto: { largura: 1600, altura: 900 },
    clique: { x: 0, y: 75 },
  });
  igual(p, { x: 0, y: 0 }, "o topo da foto");
  const comoEraAntes = Math.round((75 / 600) * 100);
  if (comoEraAntes === 0) throw new Error("o caso escolhido não distingue as duas contas");
  return `a conta velha diria ${comoEraAntes}%`;
});

etapa("foto em pé em quadro deitado: a sobra vai para os lados", () => {
  /* 900×1600 num quadro 800×600: desenha 337,5×600, sobra 231,25 de cada lado. */
  const p = pontoNaFoto({
    quadro: { largura: 800, altura: 600 },
    foto: { largura: 900, altura: 1600 },
    clique: { x: 400, y: 300 },
  });
  igual(p, { x: 50, y: 50 }, "o meio da foto");
  return "centro mantido";
});

etapa("clique na faixa vazia não vira ponto nenhum", () => {
  /* Ali não há foto. Puxar para a borda mais próxima gravaria uma decisão que
     a pessoa não tomou — e ela não teria como saber que foi gravada. */
  const p = pontoNaFoto({
    quadro: { largura: 800, altura: 600 },
    foto: { largura: 1600, altura: 900 },
    clique: { x: 400, y: 10 },
  });
  igual(p, null, "fora da foto");
  return "null, e nada é gravado";
});

etapa("sem o tamanho natural da foto, não arrisca", () => {
  /* A foto ainda não carregou. Gravar um ponto medido contra o quadro aqui
     seria exatamente o defeito antigo, de volta pela porta dos fundos. */
  igual(
    pontoNaFoto({ quadro: { largura: 800, altura: 600 }, foto: { largura: 0, altura: 0 }, clique: { x: 10, y: 10 } }),
    null,
    "sem foto medida",
  );
  return "null";
});

etapa("os cantos da foto são 0% e 100%, não mais que isso", () => {
  const base = { quadro: { largura: 800, altura: 600 }, foto: { largura: 800, altura: 600 } };
  igual(pontoNaFoto({ ...base, clique: { x: 0, y: 0 } }), { x: 0, y: 0 }, "canto de cima");
  igual(pontoNaFoto({ ...base, clique: { x: 800, y: 600 } }), { x: 100, y: 100 }, "canto de baixo");
  return "0–100";
});

if (vermelhas) {
  console.log(`\n✗ ${vermelhas} vermelha(s)\n`);
  process.exit(1);
}
console.log("\n✓ o enquadramento da capa\n");
