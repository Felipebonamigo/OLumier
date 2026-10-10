#!/usr/bin/env node
/**
 * A janela em que um link de leitura é assinado. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-janela-de-assinatura.mjs
 *
 * 10/10/2026: o link de cada miniatura levava a hora do pedido, e o casal que
 * voltava à galeria baixava as 600 de novo. Agora a assinatura usa o começo
 * de uma janela (`src/lib/janela-de-assinatura.ts`). O que esta suíte prende:
 *
 *   - dentro da janela, o mesmo instante — é o que deixa a URL igual;
 *   - a assinatura nunca é do futuro, então o link nunca vale MAIS que o
 *     prazo prometido ("link que vaza para de funcionar");
 *   - sobra sempre pelo menos 5/6 da validade — a galeria renova aos 4 h dos 6 h;
 *   - link curtíssimo não é arredondado.
 */
const { inicioDaJanela, JANELA_MAXIMA_SEG } = await import("../src/lib/janela-de-assinatura.ts");

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
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const SEIS_HORAS = 6 * 3600;
const base = Date.parse("2026-10-10T14:00:00Z");

console.log("A janela da assinatura\n");

etapa("dentro da janela, o mesmo instante", () => {
  const a = inicioDaJanela(SEIS_HORAS, base + 1_000);
  const b = inicioDaJanela(SEIS_HORAS, base + 59 * 60_000);
  igual(a.getTime(), b.getTime(), "dois pedidos na mesma hora");
  igual(a.toISOString(), "2026-10-10T14:00:00.000Z", "começo da hora");
  const depois = inicioDaJanela(SEIS_HORAS, base + 60 * 60_000);
  igual(depois.toISOString(), "2026-10-10T15:00:00.000Z", "a janela seguinte");
  return "14:00:01 e 14:59 assinam como 14:00";
});

etapa("nunca do futuro, e sempre com 5/6 da validade pela frente", () => {
  let casos = 0;
  for (const validade of [7, 60, 120, 300, 3600, SEIS_HORAS, 24 * 3600]) {
    for (let passo = 0; passo < 500; passo++) {
      const agora = base + Math.floor(Math.random() * 3 * 24 * 3600_000);
      const quando = inicioDaJanela(validade, agora).getTime();
      if (quando > agora) throw new Error(`${validade}s: assinou no futuro`);
      const sobra = (quando + validade * 1000 - agora) / 1000;
      if (sobra > validade) throw new Error(`${validade}s: o link valeria ${sobra}s`);
      if (sobra < (validade * 5) / 6) throw new Error(`${validade}s: sobrou só ${sobra}s`);
      casos++;
    }
  }
  return `${casos} casos`;
});

etapa("a janela não passa de uma hora", () => {
  const longa = 7 * 24 * 3600;
  const a = inicioDaJanela(longa, base + 30 * 60_000).getTime();
  igual(base + 30 * 60_000 - a, 30 * 60_000, "meia hora depois do começo");
  igual(JANELA_MAXIMA_SEG, 3600, "uma hora");
  return "link de 7 dias continua em janelas de 1 h";
});

etapa("link curtíssimo não é arredondado", () => {
  const agora = base + 1234;
  igual(inicioDaJanela(5, agora).getTime(), agora, "5 s");
  return "assinado agora";
});

console.log(falhou ? "\n✗ a janela da assinatura tem problema" : "\n✓ o link é o mesmo na janela, e nunca vale mais que o prometido");
process.exitCode = falhou ? 1 : 0;
