#!/usr/bin/env node
/**
 * Onde o convidado consegue marcar e baixar as favoritas. Uso:
 *   node --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-favoritas-na-tela.mjs
 *
 * ── OS DOIS PEDIDOS ───────────────────────────────────────────────────────
 *
 * 11/09/2026, Felipe: "na galeria, quando abre a foto, não estamos conseguindo
 * marcar como favorito" e "permita também baixar só as favoritas".
 *
 * O primeiro não era defeito de gravação: o coração NUNCA existiu dentro do
 * visualizador. Ele estava só na grade, no canto da miniatura — e é abrindo a
 * foto que se decide se ela entra no álbum. `git log -S alternarFavorita`
 * mostra uma única chamada desde que as favoritas nasceram.
 *
 * ── POR QUE ESTE TESTE LÊ O CÓDIGO ────────────────────────────────────────
 *
 * O que falta é um BOTÃO, e botão não tem como ser conferido por HTTP: o
 * servidor manda o mesmo HTML com ou sem ele dentro do bloco certo. As rotas
 * de favoritas já têm suíte própria (`testar-favoritas`, `testar-selecao`) e
 * continuam valendo — o buraco era entre a rota e o dedo.
 *
 * A conferência é de POSIÇÃO, não de existência: procurar `alternarFavorita`
 * no arquivo inteiro passaria feliz com o coração só na grade, que é
 * exatamente o estado que gerou a queixa.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const fonte = (p) => readFileSync(path.join(RAIZ, p), "utf8");

let falhou = false;
const ok = (m, extra) => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ""}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

const cliente = fonte("src/components/galeria-cliente.tsx");
const menus = fonte("src/components/menus-da-galeria.tsx");

console.log("Marcar favorita com a foto aberta\n");

/* O visualizador começa no `role="dialog"` e vai até o fim do arquivo — é o
   último bloco do componente. Recortar dali para baixo basta para separar "o
   que está dentro da foto aberta" de "o que está na grade". */
const visualizador = cliente.slice(cliente.indexOf('role="dialog"'));
if (!visualizador) {
  erro("não achei o visualizador no componente");
} else {
  if (/alternarFavorita\s*\(/.test(visualizador)) {
    ok("o visualizador oferece marcar como favorita");
  } else {
    erro("com a foto aberta não há como marcar favorita — o coração só existe na grade");
  }

  /*
   * E o recado precisa aparecer POR CIMA da foto.
   *
   * `aviso` é onde a regra da escolha fala: "você já escolheu 30 fotos, que é o
   * combinado". Ele é desenhado acima da grade — atrás do visualizador, que
   * ocupa a tela inteira. Quem bate no limite com a foto aberta tocaria o
   * coração, veria nada acontecer e não saberia por quê.
   */
  if (/\{aviso/.test(visualizador)) {
    ok("e o recado da escolha aparece por cima da foto aberta");
  } else {
    erro("o aviso do limite não é desenhado dentro do visualizador — a pessoa tocaria no vazio");
  }
}

console.log("\nBaixar só as favoritas\n");

if (/favoritas/i.test(menus) && /MenuBaixar/.test(menus)) {
  const tipo = menus.slice(menus.indexOf("export type MenuBaixar"), menus.indexOf("};", menus.indexOf("export type MenuBaixar")));
  if (/baixarFavoritas/.test(tipo)) {
    ok("o menu de baixar conhece as favoritas");
  } else {
    erro("o menu de baixar não oferece as favoritas — só tudo e as pastas");
  }
} else {
  erro("não achei o menu de baixar");
}

if (/baixarFavoritas/.test(cliente)) {
  ok("e a galeria monta o lote das favoritas");
} else {
  erro("a galeria não monta o lote das favoritas");
}

/*
 * ── A ARMADILHA DA GALERIA FATIADA ────────────────────────────────────────
 *
 * Desde 11/09/2026 a galeria acima de 600 fotos vem em pedaços, e `itens` é só
 * o capítulo carregado. As favoritas do casal, não: elas estão espalhadas pela
 * galeria inteira. Filtrar `itens` entregaria "as favoritas" que por acaso
 * estão nesta parte, com o número certo no rótulo e as fotos erradas no
 * telefone — a mesma mentira que a busca por rosto quase virou.
 *
 * A saída é a mesma de lá: os ids viajam no endereço, e a página volta com
 * exatamente elas. Ver `?fotos=` em `config/fatia-galeria.ts`.
 */
/* Repare no `favoritas` DENTRO do endereço: sem ele o teste passaria só por
   causa do `?fotos=` da busca por rosto, que já existia — e concordaria com o
   defeito. */
if (/\?fotos=\$\{\[\.\.\.favoritas\]/.test(cliente)) {
  ok("numa galeria fatiada as favoritas são buscadas pelo endereço, não filtradas na tela");
} else {
  erro("na galeria fatiada as favoritas seriam só as do capítulo aberto");
}

if (falhou) {
  console.error("\n✗ as favoritas têm problema na tela");
  process.exit(1);
}
console.log("\n✓ dá para marcar com a foto aberta e baixar só as favoritas");
