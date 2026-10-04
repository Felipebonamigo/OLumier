#!/usr/bin/env node
/**
 * Prende a régua do portão de vulnerabilidade (`auditar-dependencias.mjs`). Uso:
 *   node scripts/testar-portao-de-vulnerabilidade.mjs
 *
 * Sem rede e sem npm: os relatórios abaixo têm o formato do `npm audit --json`
 * (npm 10), com o alerta de verdade que motivou a lista de exceções — o do
 * `braces`, que entra pelo ESLint — e alertas inventados para os casos que
 * precisam barrar. O que importa prender é que a exceção é ESTREITA: lista,
 * fora da produção e dentro do prazo, as três juntas.
 */
import { avaliar } from "./auditar-dependencias.mjs";

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

const alerta = (nome, ghsa, gravidade) => ({
  source: 1,
  name: nome,
  dependency: nome,
  title: `falha em ${nome}`,
  url: `https://github.com/advisories/${ghsa}`,
  severity: gravidade,
  range: "*",
});

/* A árvore de hoje: braces (alto) herdado por quatro pacotes do ESLint, e o
   fast-xml-parser (moderado) do s3rver. */
const BRACES = "GHSA-vfj7-8cjw-p6xm";
const arvore = (...extras) => ({
  vulnerabilities: {
    braces: { name: "braces", severity: "high", via: [alerta("braces", BRACES, "high")] },
    micromatch: { name: "micromatch", severity: "high", via: ["braces"] },
    "fast-glob": { name: "fast-glob", severity: "high", via: ["micromatch"] },
    "eslint-config-next": { name: "eslint-config-next", severity: "high", via: ["@next/eslint-plugin-next"] },
    "fast-xml-parser": {
      name: "fast-xml-parser",
      severity: "moderate",
      via: [alerta("fast-xml-parser", "GHSA-x3cc-x39p-42qx", "moderate")],
    },
    ...Object.fromEntries(extras.map((v) => [v.name, v])),
  },
});
const producaoLimpa = { vulnerabilities: {} };
const EXCECOES = [{ alerta: BRACES, pacote: "braces", revisar_ate: "2026-11-03" }];
const HOJE = "2026-10-03";

console.log("O portão de vulnerabilidade\n");

etapa("o braces do ESLint, na lista e só em desenvolvimento, não barra", () => {
  const { barram, aceitos } = avaliar(arvore(), producaoLimpa, EXCECOES, HOJE);
  if (barram.length) throw new Error(`barrou: ${barram.map((b) => b.id).join(", ")}`);
  if (aceitos.length !== 1 || aceitos[0].id !== BRACES) throw new Error(`aceitos: ${JSON.stringify(aceitos)}`);
});

etapa("moderado continua não barrando (a régua é alto e crítico)", () => {
  const { barram } = avaliar(arvore(), producaoLimpa, EXCECOES, HOJE);
  if (barram.some((b) => b.pacote === "fast-xml-parser")) throw new Error("o moderado barrou");
});

etapa("sem a lista, o mesmo alerta barra — como antes", () => {
  const { barram } = avaliar(arvore(), producaoLimpa, [], HOJE);
  if (barram.length !== 1 || barram[0].id !== BRACES) throw new Error(JSON.stringify(barram));
});

etapa("o mesmo alerta no que vai para produção barra, mesmo na lista", () => {
  const producao = { vulnerabilities: { braces: { name: "braces", severity: "high", via: [alerta("braces", BRACES, "high")] } } };
  const { barram } = avaliar(arvore(), producao, EXCECOES, HOJE);
  if (barram.length !== 1 || !/produção/.test(barram[0].porque)) throw new Error(JSON.stringify(barram));
});

etapa("exceção vencida barra de novo", () => {
  const { barram } = avaliar(arvore(), producaoLimpa, EXCECOES, "2026-11-04");
  if (barram.length !== 1 || !/venceu/.test(barram[0].porque)) throw new Error(JSON.stringify(barram));
});

etapa("outro alerta alto, mesmo só em desenvolvimento, barra", () => {
  const outro = { name: "lodash", severity: "high", via: [alerta("lodash", "GHSA-aaaa-bbbb-cccc", "high")] };
  const { barram, aceitos } = avaliar(arvore(outro), producaoLimpa, EXCECOES, HOJE);
  if (barram.length !== 1 || barram[0].pacote !== "lodash") throw new Error(JSON.stringify(barram));
  if (aceitos.length !== 1) throw new Error("o braces deixou de ser aceito");
});

etapa("crítico conta como grave", () => {
  const critico = { name: "next", severity: "critical", via: [alerta("next", "GHSA-dddd-eeee-ffff", "critical")] };
  const { barram } = avaliar(arvore(critico), producaoLimpa, EXCECOES, HOJE);
  if (!barram.some((b) => b.gravidade === "critical")) throw new Error("o crítico passou");
});

console.log(falhou ? "\n✗ o portão de vulnerabilidade tem problema" : "\n✓ portão de vulnerabilidade ok");
process.exit(falhou ? 1 : 0);
