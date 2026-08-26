#!/usr/bin/env node
/**
 * Prende o aviso de beta.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-beta.mjs
 *
 * Por que existe: quem cria conta hoje está entrando num produto novo, com
 * pouquíssimos estúdios rodando nele. Dizer isso na cara do cliente custa
 * algumas assinaturas e compra a única coisa que não se recupera depois — a
 * confiança de quem entregou o casamento de alguém pelo nosso link.
 *
 * O risco real não é esquecer de POR o aviso. É esquecer de TIRAR: um dia o
 * beta acaba, alguém apaga o selo de um lugar, e a página de cadastro segue
 * chamando de beta um produto que já cobra de trinta estúdios há um ano. Por
 * isso o teste é de CONCORDÂNCIA, não de presença: `marca.beta` manda, e as
 * páginas têm de concordar com ele nos dois sentidos.
 *
 * Sair do beta é, então, uma linha só em `config/marca.ts` — e este teste
 * confere que nenhum canto ficou para trás.
 */
import { marca } from "../src/config/marca.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

/* As páginas que alguém vê ANTES de se comprometer. É onde o aviso vale: dizer
 * "beta" só depois de a pessoa ter subido o casamento não é aviso, é desculpa. */
const ANTES_DE_SE_COMPROMETER = ["/", "/cadastrar"];

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

/* Palavra inteira: evita casar "betamax" ou qualquer coisa que só contenha as
 * letras. `connection: close` pelo mesmo motivo de testar-comparativo.mjs. */
const DIZ_BETA = /\bbeta\b/i;
const pegar = async (rota) => {
  const r = await fetch(`${BASE}${rota}`, { headers: { connection: "close" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${rota}`);
  return r.text();
};

console.log(`aviso de beta (marca.beta = ${marca.beta})`);

await etapa("a marca declara se está em beta", () => {
  if (typeof marca.beta !== "boolean") {
    throw new Error("marca.beta não existe ou não é booleano — falta o ponto único de verdade");
  }
  return String(marca.beta);
});

await etapa("a marca explica o que beta quer dizer", () => {
  if (!marca.beta) return "fora do beta — nada a explicar";
  if (!marca.betaExplicacao || marca.betaExplicacao.length < 40) {
    throw new Error(
      "falta `marca.betaExplicacao`. Selo sem frase é enfeite: quem lê 'beta' " +
        "precisa saber o que isso muda para ele.",
    );
  }
  return `${marca.betaExplicacao.length} caracteres`;
});

for (const rota of ANTES_DE_SE_COMPROMETER) {
  await etapa(`${rota} concorda com marca.beta`, async () => {
    const html = await pegar(rota);
    const diz = DIZ_BETA.test(html);

    if (marca.beta && !diz) {
      throw new Error(
        `marca.beta é true e ${rota} não avisa. Quem cria conta tem de saber ` +
          `antes de subir a entrega de um cliente.`,
      );
    }
    if (!marca.beta && diz) {
      throw new Error(
        `o beta acabou (marca.beta = false) e ${rota} ainda chama o produto de ` +
          `beta. Aviso vencido é pior que aviso nenhum — dá a impressão de que ` +
          `ninguém mais lê a página.`,
      );
    }
    return diz ? "avisa" : "não avisa, e não deve";
  });
}

await etapa("a explicação chega junto no cadastro", async () => {
  if (!marca.beta) return "fora do beta";
  const html = await pegar("/cadastrar");
  /* Compara por um pedaço da frase: o HTML escapa acento e aspas, então casar a
   * string inteira daria falso negativo por causa de entidade. */
  const pedaco = marca.betaExplicacao.split(" ").slice(0, 4).join(" ");
  if (!html.includes(pedaco)) {
    throw new Error(`/cadastrar diz "beta" mas não traz a explicação ("${pedaco}…")`);
  }
});

console.log(falhou ? "\n✗ o aviso de beta saiu do lugar" : "\n✓ aviso de beta ok");
process.exitCode = falhou ? 1 : 0;
