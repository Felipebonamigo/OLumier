/*
 * ── MARCAR ARRASTANDO, SEM ATRAPALHAR O REORDENAR (09/10/2026) ────────────
 *
 * Juan, repassando: "quando eu to ajustando a ordem das fotos, eu conseguia
 * clicar no lado esquerdo do mouse e ir subindo e selecionar tudo sem precisar
 * selecionar 1 por 1 a mão". E depois: "clicar em um, e arrastar, seja para
 * cima e para baixo, assim como no celular também".
 *
 * ── O CONFLITO, QUE É O PROBLEMA INTEIRO ──────────────────────────────────
 *
 * Apertar numa foto e arrastar JÁ faz uma coisa: reordenar. Dar a mesma ação a
 * dois resultados é o tipo de escolha que erra sozinha, então a diferença é o
 * TEMPO parado antes de andar — segurou e andou, marca; andou logo, reordena.
 * É o gesto que o celular já ensinou a todo mundo.
 *
 * ── POR QUE A REGRA MORA FORA DO COMPONENTE ───────────────────────────────
 *
 * Porque ela é dois números e um ponto de corte, e errar neles é o que faz a
 * pessoa mover uma foto sem querer no meio de 4.577. Testar isso pelo
 * navegador pediria encenar um ponteiro com relógio; aqui são chamadas de
 * função, e é possível perguntar pelos casos de borda sem subir nada.
 */
import { ESPERA_PARA_MARCAR_MS, TOLERANCIA_DO_DEDO_PX, viraMarcacao } from "../src/lib/gesto-da-grade.ts";

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
  if (a !== b) throw new Error(`${oque}: ${JSON.stringify(a)} em vez de ${JSON.stringify(b)}`);
};

console.log("Marcar arrastando:\n");

etapa("segurou parado o tempo todo: vira marcação", () => {
  igual(viraMarcacao({ ms: ESPERA_PARA_MARCAR_MS, px: 0 }), true, "parado");
  igual(viraMarcacao({ ms: ESPERA_PARA_MARCAR_MS + 500, px: 0 }), true, "bem parado");
  return `${ESPERA_PARA_MARCAR_MS} ms`;
});

etapa("andou antes do tempo: é reordenar, e não marcação", () => {
  /* Quem já está arrastando a foto para outro lugar não quer marcar nada. */
  igual(viraMarcacao({ ms: ESPERA_PARA_MARCAR_MS - 1, px: 0 }), false, "cedo demais");
  igual(viraMarcacao({ ms: ESPERA_PARA_MARCAR_MS + 500, px: TOLERANCIA_DO_DEDO_PX + 1 }), false, "andou");
  return "reordenar";
});

etapa("tremida de mão não conta como andar", () => {
  /* Segurar parado, no mundo real, anda alguns pixels — o dedo no vidro anda
     mais que o mouse. Sem folga, a marcação quase nunca começaria no celular. */
  igual(viraMarcacao({ ms: ESPERA_PARA_MARCAR_MS, px: TOLERANCIA_DO_DEDO_PX }), true, "no limite da folga");
  if (TOLERANCIA_DO_DEDO_PX < 4) throw new Error("folga pequena demais para dedo em vidro");
  if (TOLERANCIA_DO_DEDO_PX > 20) throw new Error("folga tão grande que arrastar curto viraria marcação");
  return `${TOLERANCIA_DO_DEDO_PX} px de folga`;
});

etapa("a espera é curta o bastante para não parecer travamento", () => {
  /* Acima de meio segundo a pessoa acha que a tela não respondeu e solta. */
  if (ESPERA_PARA_MARCAR_MS < 200) throw new Error("tão curta que um clique normal viraria marcação");
  if (ESPERA_PARA_MARCAR_MS > 600) throw new Error("tão longa que parece travamento");
  return `${ESPERA_PARA_MARCAR_MS} ms`;
});

etapa("tempo ou distância sem sentido não viram marcação", () => {
  /* O relógio e a geometria vêm de eventos do navegador, e evento com número
     estranho existe. Na dúvida, o gesto é o que já era: reordenar. */
  for (const caso of [
    { ms: Number.NaN, px: 0 },
    { ms: -1, px: 0 },
    { ms: 9999, px: Number.NaN },
  ]) {
    igual(viraMarcacao(caso), false, JSON.stringify(caso));
  }
  return "na dúvida, reordena";
});

if (vermelhas) {
  console.log(`\n✗ ${vermelhas} vermelha(s)\n`);
  process.exit(1);
}
console.log("\n✓ marcar arrastando\n");
