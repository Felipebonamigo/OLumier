#!/usr/bin/env node
/**
 * Os dois limites do teste, ditos antes de morder. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-lembrete-do-teste.mjs
 *
 * Regra pura, sem banco: a tela da lista de galerias e o e-mail da madrugada
 * leem a mesma conta (`src/lib/lembrete-do-teste.ts`). Ver o porquê lá.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { lembreteDoTeste, faltamPorExtenso, DIAS_PARA_AVISAR_TEMPO } from "../src/lib/lembrete-do-teste.ts";
import { DIAS_DE_TESTE, TETO_TRIAL_GB } from "../src/config/trial.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");
const GB = 1024n ** 3n;
const DIA = 24 * 60 * 60 * 1000;
const agora = new Date("2026-10-14T12:00:00Z");
const conta = (dias, extra = {}) => ({
  status: "trial",
  trial_ate: new Date(agora.getTime() + dias * DIA),
  quota_bytes: String(200n * GB),
  ...extra,
});

let falhou = false;
const etapa = (nome, fn) => {
  try {
    fn();
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: veio ${a}, esperava ${b}`);
};

console.log("O lembrete do teste:\n");

etapa("os números da política: 14 dias e 10 GB", () => {
  igual(DIAS_DE_TESTE, 14, "dias");
  igual(TETO_TRIAL_GB, 10, "GB");
  /* O `default` da coluna é o mesmo número escrito em SQL. */
  const schema = readFileSync(path.join(RAIZ, "db/schema.sql"), "utf8");
  if (!schema.includes(`interval '${DIAS_DE_TESTE} days'`)) {
    throw new Error("db/schema.sql não bate com DIAS_DE_TESTE");
  }
});

etapa("quem não está no teste não recebe lembrete", () => {
  for (const status of ["ativo", "cortesia", "cancelado", "inadimplente"]) {
    igual(lembreteDoTeste(conta(5, { status }), 0n, true, agora), null, status);
  }
  igual(lembreteDoTeste(conta(5, { trial_ate: null }), 0n, true, agora), null, "sem data");
});

etapa("folgado: sem alarme", () => {
  const l = lembreteDoTeste(conta(10), 1n * GB, true, agora);
  igual(l.tempo, "folgado", "tempo");
  igual(l.espaco, "folgado", "espaço");
  igual(l.pedeAtencao, false, "atenção");
  igual(l.diasRestantes, 10, "dias");
});

etapa("tempo: acaba em 3 dias vira aviso; 4 ainda não", () => {
  igual(lembreteDoTeste(conta(DIAS_PARA_AVISAR_TEMPO), 0n, true, agora).tempo, "acabando", "3 dias");
  igual(lembreteDoTeste(conta(DIAS_PARA_AVISAR_TEMPO + 1), 0n, true, agora).tempo, "folgado", "4 dias");
  igual(lembreteDoTeste(conta(0.2), 0n, true, agora).diasRestantes, 1, "hoje ainda é 1 dia");
});

etapa("tempo: venceu", () => {
  const l = lembreteDoTeste(conta(-1), 0n, true, agora);
  igual(l.tempo, "vencido", "tempo");
  igual(l.diasRestantes, 0, "dias");
  igual(faltamPorExtenso(0), "terminou", "texto");
  igual(faltamPorExtenso(1), "falta 1 dia", "texto 1");
  igual(faltamPorExtenso(5), "faltam 5 dias", "texto 5");
});

etapa("sem cobrança ligada o relógio não vira aviso (ninguém pode assinar)", () => {
  igual(lembreteDoTeste(conta(-1), 0n, false, agora).tempo, "folgado", "vencido sem cobrança");
  igual(lembreteDoTeste(conta(1), 0n, false, agora).tempo, "folgado", "acabando sem cobrança");
});

etapa("espaço: 80% enche, 100% fecha — sobre o TETO, não sobre o plano", () => {
  igual(lembreteDoTeste(conta(10), 7n * GB, true, agora).espaco, "folgado", "70%");
  igual(lembreteDoTeste(conta(10), 8n * GB, true, agora).espaco, "enchendo", "80%");
  igual(lembreteDoTeste(conta(10), 10n * GB, true, agora).espaco, "cheio", "100%");
  /* Plano de 200 GB, teto do teste de 10 GB: 9 GB é 90% do que vale. */
  const l = lembreteDoTeste(conta(10), 9n * GB, true, agora);
  igual(l.tetoBytes, 10n * GB, "teto");
  igual(Math.round(l.fracaoDoEspaco * 100), 90, "fração");
});

etapa("o espaço avisa mesmo sem cobrança (o teto vale sempre)", () => {
  igual(lembreteDoTeste(conta(10), 9n * GB, false, agora).espaco, "enchendo", "espaço");
});

etapa("plano menor que o teto manda: quota de 5 GB enche aos 4 GB", () => {
  const l = lembreteDoTeste(conta(10, { quota_bytes: String(5n * GB) }), 4n * GB, true, agora);
  igual(l.tetoBytes, 5n * GB, "teto");
  igual(l.espaco, "enchendo", "espaço");
});

etapa("a fração nunca passa de 100%", () => {
  igual(lembreteDoTeste(conta(10), 50n * GB, true, agora).fracaoDoEspaco, 1, "fração");
});

etapa("a tela e o e-mail estão ligados à regra", () => {
  const pagina = readFileSync(path.join(RAIZ, "src/app/painel/page.tsx"), "utf8");
  if (!pagina.includes("AvisoDoTeste") || !pagina.includes("lembreteDoTeste(")) {
    throw new Error("a tela das galerias não mostra o aviso do teste");
  }
  const rotina = readFileSync(path.join(RAIZ, "scripts/limpar-lixeira.mjs"), "utf8");
  if (!rotina.includes("rodarLembretesDoTeste")) {
    throw new Error("a rotina diária não envia o lembrete (o deploy não instala unidade nova)");
  }
  const email = readFileSync(path.join(RAIZ, "src/lib/lembretes-do-teste.ts"), "utf8");
  if (!email.includes("aviso_teste_tempo_em") || !email.includes("aviso_teste_espaco_em")) {
    throw new Error("o e-mail não guarda o que já avisou");
  }
});

console.log(falhou ? "\n✗ o lembrete do teste tem problema" : "\n✓ lembrete do teste ok");
process.exitCode = falhou ? 1 : 0;
