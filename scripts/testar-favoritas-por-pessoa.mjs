#!/usr/bin/env node
/**
 * Cada pessoa com a sua lista de favoritas. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-favoritas-por-pessoa.mjs
 *
 * ── O PEDIDO, E O DEFEITO QUE ELE DESCREVE ────────────────────────────────
 *
 * Felipe, 15/09/2026: "para que cada usuário tenha as suas favoritas, para que
 * eu não tire as favoritas da noiva por exemplo".
 *
 * Ele descreveu o código: desde a migração 019 a lista é UMA por galeria —
 * `minhasFavoritas` lê todas e `alternar` apaga por `galeria_id + media_id`,
 * sem olhar quem marcou. Qualquer pessoa com o link desmarca a escolha da
 * noiva, inclusive o fotógrafo conferindo a entrega.
 *
 * ── O QUE ESTE ARQUIVO PRENDE ─────────────────────────────────────────────
 *
 * A separação em si é fácil de escrever e fácil de furar por um caminho só: o
 * DESMARCAR. Uma implementação que filtra a leitura por pessoa e esquece o
 * `delete` mostra listas separadas e continua deixando um apagar a do outro —
 * o defeito original, agora invisível. Por isso metade das etapas aqui é sobre
 * remoção.
 *
 * A outra metade é sobre o e-mail ser a identidade, e não o cookie: a noiva
 * abre no celular e no notebook, e tem de encontrar as MESMAS fotos.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

import {
  pessoaPorEmail,
  favoritasDaPessoa,
  alternarDaPessoa,
  resumoPorPessoa,
} from "../src/lib/favoritas.ts";

let falhou = false;
const ok = (m, extra) => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ""}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const g = await galeriaDaRodada(db, { nome: "porpessoa", medias: 4, publicada: true });
const fotos = g.midias.map((m) => m.id);

try {
  console.log("Cada e-mail, uma lista\n");

  const noiva = await pessoaPorEmail(g.id, "ana@exemplo.com", "Ana");
  const noivo = await pessoaPorEmail(g.id, "kaio@exemplo.com", "Kaio");

  if (noiva && noivo && noiva.id !== noivo.id) ok("dois e-mails, duas pessoas");
  else erro("os dois e-mails viraram a mesma pessoa");

  /* O MESMO e-mail com outra caixa é a MESMA pessoa: a noiva digita com
     maiúscula no notebook e não pode perder as escolhas dela. */
  const noivaDeNovo = await pessoaPorEmail(g.id, "Ana@Exemplo.com", "Ana");
  if (noivaDeNovo.id === noiva.id) ok('"Ana@Exemplo.com" é a mesma pessoa que "ana@exemplo.com"');
  else erro("a maiúscula abriu uma segunda lista");

  await alternarDaPessoa(g.id, fotos[0], noiva.id);
  await alternarDaPessoa(g.id, fotos[1], noiva.id);
  await alternarDaPessoa(g.id, fotos[2], noivo.id);

  const daNoiva = await favoritasDaPessoa(g.id, noiva.id);
  const doNoivo = await favoritasDaPessoa(g.id, noivo.id);
  if (daNoiva.length === 2 && doNoivo.length === 1) {
    ok("cada um vê só as suas", `noiva ${daNoiva.length}, noivo ${doNoivo.length}`);
  } else {
    erro(`noiva ficou com ${daNoiva.length} e noivo com ${doNoivo.length}`);
  }

  /* A MESMA foto escolhida pelos dois são duas linhas — é o que a 019 proibia
     com o índice único, e o que a 033 devolve. */
  await alternarDaPessoa(g.id, fotos[0], noivo.id);
  const doNoivoAgora = await favoritasDaPessoa(g.id, noivo.id);
  if (doNoivoAgora.includes(fotos[0]) && (await favoritasDaPessoa(g.id, noiva.id)).includes(fotos[0])) {
    ok("a mesma foto pode estar nas duas listas");
  } else {
    erro("a foto escolhida pelos dois não sobreviveu nas duas listas");
  }

  console.log("\nNinguém apaga a lista do outro\n");

  /* ── A METADE QUE COSTUMA FURAR ──────────────────────────────────────────
   * Filtrar a leitura e esquecer o `delete` mostra listas separadas e mantém o
   * defeito: um continua desmarcando a foto do outro, só que agora sem nem
   * aparecer na tela dele. */
  const antes = await favoritasDaPessoa(g.id, noiva.id);
  await alternarDaPessoa(g.id, fotos[1], noivo.id); // foto que é SÓ da noiva
  const depois = await favoritasDaPessoa(g.id, noiva.id);
  if (depois.length === antes.length && depois.includes(fotos[1])) {
    ok("o noivo mexendo na foto da noiva não tira nada dela");
  } else {
    erro(`a lista da noiva foi de ${antes.length} para ${depois.length}`);
  }

  /* E o que ele fez foi ADICIONAR à lista dele, não remover da dela. */
  if ((await favoritasDaPessoa(g.id, noivo.id)).includes(fotos[1])) {
    ok("e virou escolha dele, na lista dele");
  } else {
    erro("a foto não entrou na lista do noivo");
  }

  /* Desmarcar a própria continua funcionando — senão o teste acima passaria
     com um `delete` simplesmente quebrado. */
  await alternarDaPessoa(g.id, fotos[0], noiva.id);
  if (!(await favoritasDaPessoa(g.id, noiva.id)).includes(fotos[0])) {
    ok("e cada um desmarca a SUA");
  } else {
    erro("a noiva não conseguiu desmarcar a própria foto");
  }

  console.log("\nO fotógrafo vê quem escolheu o quê\n");

  const resumo = await resumoPorPessoa(g.id);
  const pessoas = resumo.map((p) => p.email).sort();
  if (pessoas.join() === "ana@exemplo.com,kaio@exemplo.com") {
    ok("o painel lista as duas pessoas", pessoas.join(" · "));
  } else {
    erro(`o painel listou ${pessoas.join(" · ") || "ninguém"}`);
  }
  const daAna = resumo.find((p) => p.email === "ana@exemplo.com");
  if (daAna && daAna.quantas === (await favoritasDaPessoa(g.id, noiva.id)).length) {
    ok("com a contagem certa de cada uma", `Ana: ${daAna.quantas}`);
  } else {
    erro(`a contagem da Ana no painel não bate: ${daAna?.quantas}`);
  }

  /* Foto de outra galeria não entra por id chutado — a conferência que já
     existia não pode ter se perdido na mudança. */
  const outra = await galeriaDaRodada(db, { nome: "alheia", medias: 1 });
  const r = await alternarDaPessoa(g.id, outra.midias[0].id, noiva.id);
  if (r === null) ok("id de foto de outra galeria é recusado");
  else erro(`foto alheia foi aceita: ${JSON.stringify(r)}`);
  /*
   * ── A TELA NÃO PODE DESMENTIR O PRODUTO (17/09/2026) ────────────────────
   *
   * Felipe mandou uma foto do cartão "Favoritas do cliente" perguntando se o
   * recurso tinha sido feito. Tinha — desde 15/09/2026, com migração e com
   * todas as etapas acima verdes. O que ele leu foi o parágrafo do cartão, que
   * continuava dizendo "a lista é uma só — o casal escolhe junto", escrito
   * quando era verdade e nunca revisto.
   *
   * A frase contradizia a lista POR PESSOA desenhada dez linhas abaixo dela, na
   * mesma tela. Recurso que a tela desmente é recurso que ninguém usa: a pessoa
   * acredita no texto, não no código.
   *
   * Esta etapa é a única aqui que não olha comportamento. É de propósito —
   * nenhuma das outras pegaria uma descrição errada, e foi exatamente por aí
   * que o produto e a tela se separaram.
   */
  {
    const fonte = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/components/painel-selecao.tsx", "utf8"),
    );
    /* Os comentários saem antes: o arquivo EXPLICA o defeito citando a frase
       antiga, e a conferência não pode confundir a explicação com ele. */
    const texto = fonte.replace(/\/\*[^]*?\*\//g, "").replace(/\{\/\*[^]*?\*\/\}/g, "");
    if (/lista é uma só/i.test(texto)) {
      erro('o cartão ainda anuncia "a lista é uma só" — o produto mudou em 15/09/2026');
    } else if (!/e-mail/i.test(texto)) {
      erro("o cartão não diz que a identificação é por e-mail — é o que separa as listas");
    } else {
      ok("o cartão do painel descreve as listas por pessoa");
    }

    /*
     * A SEGUNDA frase errada do mesmo cartão, e a mais cara. Ela dizia "o
     * limite vale para a galeria inteira, não por pessoa" — e quem aplica é
     * `alternarDaPessoa`, contra a contagem de quem está marcando.
     *
     * Não é questão de redação: um fotógrafo que lesse aquilo combinaria 40
     * fotos com o casal achando que 40 era o teto da galeria, e receberia 120.
     * A tela estava, literalmente, informando errado o combinado do contrato.
     */
    if (/para a galeria inteira, não por pessoa/i.test(texto)) {
      erro("o cartão ainda diz que o limite é da galeria — ele é POR PESSOA desde a migração 033");
    } else if (!/por pessoa/i.test(texto)) {
      erro("o cartão não diz que o limite é por pessoa — é o combinado do contrato que depende disso");
    } else {
      ok("o cartão diz que o limite vale por pessoa, que é como o código aplica");
    }
  }

  {
    const home = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/app/page.tsx", "utf8"),
    );
    const texto = home.replace(/\/\*[^]*?\*\//g, "");
    if (/lista é uma só/i.test(texto)) {
      erro('a página de vendas ainda promete "a lista é uma só" — é promessa pública desatualizada');
    } else {
      ok("a página de vendas promete o que o produto faz");
    }
  }
} finally {
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ as favoritas por pessoa têm problema");
  process.exit(1);
}
console.log("\n✓ cada pessoa com a sua lista, e ninguém mexe na do outro");
