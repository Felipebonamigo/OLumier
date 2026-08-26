#!/usr/bin/env node
/**
 * Prende a seção de comparação da home.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-comparativo.mjs
 *
 * Por que existe: a seção responde a UMA objeção de venda — "o concorrente
 * cobra R$ 29,90 e aqui é R$ 49,99". A resposta honesta não é desconto, é o teto:
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
import { PRAZO_LIXEIRA_DIAS } from "../src/lib/tenants.ts";

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

/*
 * A FAQ.
 *
 * Prende três coisas, e nenhuma é a redação:
 *
 *   1. Ela existe e responde em HTML, sem depender de JavaScript. Feita com
 *      <details>/<summary>, abre no navegador de quem bloqueia script e no
 *      Ctrl+F do próprio navegador — que é como muita gente procura resposta.
 *
 *   2. Cada resposta que promete algo aponta para onde a promessa é cumprida.
 *      "Guardamos com segurança" sem link para /seguranca é slogan.
 *
 *   3. O número de dias da lixeira sai de `PRAZO_LIXEIRA_DIAS`, não da mão de
 *      quem escreveu. Prometer 30 dias na home e apagar em 15 é o tipo de
 *      mentira que só aparece no dia em que alguém precisa restaurar.
 */
console.log("\na home responde as perguntas antes da conta");

/* Só o pedaço da FAQ. Procurar no HTML inteiro daria falso verde: o rodapé já
 * tem link para /seguranca e o número 30 aparece em classe do Tailwind. Teste
 * que passa por causa de outra parte da página não está testando nada. */
let faq = "";

await etapa("a FAQ existe", () => {
  const i = html.indexOf('id="perguntas"');
  if (i === -1) throw new Error("não achei a FAQ (id=perguntas) na home");
  faq = html.slice(i);
  const abas = (faq.match(/<details/g) ?? []).length;
  if (abas < 5) throw new Error(`só ${abas} pergunta(s) — a FAQ está pela metade`);
  return `${abas} perguntas`;
});

await etapa("abre sem JavaScript", () => {
  /* <details> é do navegador. Se um dia virar botão com onClick, quem tem
   * script bloqueado passa a ver só os títulos, sem nenhuma resposta. */
  if (!faq.includes("<summary")) throw new Error("as perguntas não usam <summary> — viraram JS?");
});

await etapa("o prazo da lixeira vem do código, não do texto", () => {
  if (!faq.includes(String(PRAZO_LIXEIRA_DIAS))) {
    throw new Error(`a FAQ não diz "${PRAZO_LIXEIRA_DIAS}", que é o prazo real da lixeira`);
  }
  return `${PRAZO_LIXEIRA_DIAS} dias`;
});

await etapa("a resposta sobre guarda aponta para a página de segurança", () => {
  if (!faq.includes('href="/seguranca"')) {
    throw new Error("a FAQ fala de segurança sem levar para /seguranca");
  }
});

/*
 * ── A HOME VENDE O QUE O PRODUTO ENTREGA ──────────────────────────────────
 *
 * O problema inverso do resto deste arquivo. As etapas acima impedem a página
 * de prometer DEMAIS; estas impedem de prometer DE MENOS. O produto ganhou
 * escolha de álbum, capítulos pela pasta, nove fontes, vitrine — e a home
 * seguiu vendendo a versão de uma semana atrás. Página de venda que não conta
 * o que existe perde a venda em silêncio, que é o pior jeito de perder.
 *
 * Cada palavra exigida aqui corresponde a um recurso NO AR com teste próprio:
 * seleção (testar-selecao), capítulos (testar-capitulos-pasta), fontes
 * (testar-aparencia), vitrine (testar-site-estudio), filme sem adicional
 * (testar-planos, testar-multipart). Se um deles for desligado um dia, a
 * palavra sai daqui JUNTO — mesma regra da página de segurança.
 */
console.log("\na home vende o que existe");

const VENDAS = [
  ["a escolha do álbum", /escolha do álbum/i],
  ["a lista pronta para o Lightroom", /Lightroom/],
  ["capítulos nascendo das pastas", /pastas? viram? capítulos|subpastas viram capítulos/i],
  ["o filme em 4K dentro da galeria", /4K/],
  ["as nove fontes de título", /nove fontes/i],
  ["a vitrine do estúdio", /vitrine/i],
];

for (const [nome, padrao] of VENDAS) {
  await etapa(`a home conta sobre ${nome}`, () => {
    if (!padrao.test(html)) {
      throw new Error(`a página de venda não menciona — o recurso existe e está mudo`);
    }
  });
}

console.log(falhou ? "\n✗ a comparação da home saiu do lugar" : "\n✓ comparação da home ok");
/* `exitCode` e não `exit()`: deixa o Node fechar o que estiver aberto e sair
 * sozinho. Ver a etapa da home — sair à força aqui custa o código de saída. */
process.exitCode = falhou ? 1 : 0;
