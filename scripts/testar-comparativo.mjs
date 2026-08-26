#!/usr/bin/env node
/**
 * Prende a seção de comparação da home.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-comparativo.mjs
 *
 * Por que existe: a seção responde a UMA objeção de venda — "o concorrente
 * cobra R$ 29,90 e aqui é R$ 49". A resposta honesta não é desconto, é o teto:
 * o pacote barato do concorrente guarda dezenas de GB, e um casamento com filme
 * não cabe lá por nenhum preço. Isso só continua verdade enquanto a NOSSA grade
 * continuar do jeito que está, e uma grade muda sem ninguém reler a home.
 *
 * As três coisas que este teste prende, e por que cada uma:
 *
 *   1. Os tamanhos escritos na home saem de `ESPACOS`, não da mão de quem
 *      escreveu. Se alguém acrescentar um degrau de 25 GB embaixo, a frase
 *      "o menor plano já guarda um casamento" vira mentira em silêncio — a
 *      página continua no ar, bonita, e errada.
 *
 *   2. O menor degrau guarda pelo menos um casamento inteiro. É o número que
 *      sustenta a seção: se a entrada cair abaixo disso, o argumento se vira
 *      contra nós e a seção tem de ser reescrita, não só reajustada.
 *
 *   3. Nenhum concorrente é citado pelo nome. Essa é a regra que apaga primeiro
 *      — é tentador responder ao anúncio do concorrente com o nome dele. Só que
 *      número de terceiro envelhece sem avisar, citar dá palco de graça, e a
 *      página inteira nunca citou ninguém. Se um nome entrar aqui, que entre por
 *      decisão, com este teste ficando vermelho antes.
 */
import { ESPACOS, formatarGb } from "../src/config/planos.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

/* Um casamento fotografado, com filme, mora na casa das centenas de GB. 100 é o
 * piso do que dá para chamar de "cabe uma entrega inteira" sem forçar. */
const CASAMENTO_GB = 100;

/* Quem a home NÃO cita. Não é lista de inimigos: é a lista do que, se aparecer
 * no texto, quer dizer que a regra editorial caiu sem ninguém decidir. */
const NOMES_QUE_NAO_ENTRAM = ["Pixieset", "Pixellu", "Lumi", "SmartAlbums", "Pic-Time", "ShootProof"];

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

const menor = ESPACOS[0];
const maior = ESPACOS[ESPACOS.length - 1];

let html = "";

console.log("a home responde à objeção do preço");

await etapa("a home responde", async () => {
  /* `connection: close` de propósito: com keep-alive o socket fica vivo depois
   * da última etapa, e sair com `process.exit` em cima dele derruba o processo
   * com uma asserção do libuv no Windows — a saída vira 127 em vez de 0 ou 1.
   * Teste que morre com código de acidente vira suíte vermelha sem defeito. */
  const r = await fetch(BASE, { headers: { connection: "close" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} — o servidor de desenvolvimento está no ar?`);
  html = await r.text();
  return `${(html.length / 1024).toFixed(0)} KB`;
});

await etapa("a seção existe", () => {
  if (!html.includes('id="comparativo"')) {
    throw new Error("não achei a seção de comparação (id=comparativo) na home");
  }
});

await etapa("o menor degrau ainda guarda uma entrega inteira", () => {
  if (menor.gb < CASAMENTO_GB) {
    throw new Error(
      `o menor plano caiu para ${formatarGb(menor.gb)} — abaixo de ${CASAMENTO_GB} GB a seção ` +
        `não pode mais dizer que a entrada guarda um casamento. Reescreva a seção, não o número.`,
    );
  }
  return formatarGb(menor.gb);
});

await etapa("o tamanho de entrada escrito na home é o da grade", () => {
  const escrito = formatarGb(menor.gb);
  if (!html.includes(escrito)) {
    throw new Error(`a home não diz "${escrito}", que é o menor degrau de ESPACOS`);
  }
  return escrito;
});

await etapa("o teto escrito na home é o da grade", () => {
  const escrito = formatarGb(maior.gb);
  if (!html.includes(escrito)) {
    throw new Error(`a home não diz "${escrito}", que é o maior degrau de ESPACOS`);
  }
  return escrito;
});

await etapa("nenhum concorrente é citado pelo nome", () => {
  /* Palavra inteira, não pedaço: "Olumier" contém "lumi", e um `includes` cru
   * acusa a própria marca de ser concorrente. A borda `\b` resolve — em
   * "olumier" o "l" vem depois de letra, então não abre palavra. */
  const achados = NOMES_QUE_NAO_ENTRAM.filter((n) =>
    new RegExp(`\\b${n.replace(/[-]/g, "\\-")}\\b`, "i").test(html),
  );
  if (achados.length > 0) {
    throw new Error(
      `a home cita ${achados.join(", ")}. Número de concorrente envelhece sozinho e citar dá ` +
        `palco de graça — se a decisão mudou, mude este teste junto, de propósito.`,
    );
  }
});

console.log(falhou ? "\n✗ a comparação da home saiu do lugar" : "\n✓ comparação da home ok");
/* `exitCode` e não `exit()`: deixa o Node fechar o que estiver aberto e sair
 * sozinho. Ver a etapa da home — sair à força aqui custa o código de saída. */
process.exitCode = falhou ? 1 : 0;
