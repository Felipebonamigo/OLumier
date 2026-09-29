#!/usr/bin/env node
/**
 * O ACABAMENTO DOS BOTÕES ACOMPANHA O CANTO DAS FOTOS. Uso:
 *   node --env-file=.env.local scripts/testar-acabamento-reto.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (29/09/2026) ─────────────────────────────────────────────────
 *
 * Juan Sirius, com um print da galeria no celular: "tem como adicionar alguma
 * opção no design de fazer os acabamentos retos? (se serão circulares,
 * quadrados, ou outros formatos)".
 *
 * No print dava para ver o defeito: as miniaturas saíam com o canto quase reto
 * — o eixo `canto`, 6 px — e a ficha "MAKING OF" e o botão "Encontrar as
 * minhas fotos" eram cápsulas inteiras. Foto quadrada ao lado de botão redondo
 * na mesma tela. O canto da FOTO era escolha dele desde 04/09; o acabamento
 * dos CONTROLES estava cravado em `rounded-full`, e ninguém podia mexer.
 *
 * ── POR QUE O MESMO EIXO, E NÃO UM EIXO NOVO ──────────────────────────────
 *
 * Um eixo "acabamento" separado seria o décimo oitavo controle da tela de
 * Design — e o Juan já reclamou que ali tem coisa demais parecida. Pior: com
 * dois controles, o padrão de fábrica continuaria sendo exatamente a mistura
 * do print, e só sumiria se a pessoa achasse os dois e os fizesse concordar.
 *
 * A objeção séria a reusar `canto` é que ele obrigaria a foto e o botão a
 * andarem juntos para sempre, mudando a cara de quem já escolheu `reto` na mão.
 * Conferido no banco em 29/09/2026: das 510 galerias, ZERO têm `canto` gravado
 * — todas caem no padrão `suave` por `lerAparencia`. E só `reto` mexe na
 * pílula: `suave`, `redondo` e `muito` continuam com a cápsula de sempre.
 * Nenhuma galeria entregue muda de cara, e é isso que a primeira etapa prende.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

import { APARENCIA_PADRAO, variaveisDeForma } from "../src/config/aparencia.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let falhou = false;
const ok = (m) => console.log(`  ✓ ${m}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

console.log("Acabamento dos botões — o eixo `canto` também governa a pílula\n");

/* ── 1. O contrato, escrito à mão ─────────────────────────────────────────
 *
 * Como em `testar-eixos-forma.mjs`: a tabela NÃO sai de OPCOES, porque uma
 * tabela lida da própria fonte concorda com qualquer mudança e não confere
 * nada. Só `reto` quadra o botão — mudar qualquer outra linha muda a cara de
 * galeria entregue, e tem de doer aqui. */
const PILULAS = { reto: 0, suave: 999, redondo: 999, muito: 999 };

const padrao = variaveisDeForma(APARENCIA_PADRAO);
if (padrao["--g-pilula"] === "999px") {
  ok("o padrão continua sendo a cápsula — galeria entregue não muda de cara");
} else {
  erro(`o padrão saiu ${padrao["--g-pilula"]}, e não 999px — toda galeria no ar mudaria`);
}

/* ── 2. Os componentes leem a variável, em vez de cravar o redondo ───────── */
const ARQUIVOS = {
  "galeria-cliente.tsx": "src/components/galeria-cliente.tsx",
  "menus-da-galeria.tsx": "src/components/menus-da-galeria.tsx",
  "encontrar-me.tsx": "src/components/encontrar-me.tsx",
};

for (const [nome, rel] of Object.entries(ARQUIVOS)) {
  const fonte = readFileSync(path.join(RAIZ, rel), "utf8");
  if (/rounded-\[var\(--g-pilula/.test(fonte)) {
    ok(`${nome} lê o acabamento da variável`);
  } else {
    erro(`${nome} não usa --g-pilula — os botões dele ficam redondos para sempre`);
  }
}

/*
 * O selo de PLAY e a moldura da capa redonda/arco ficam de fora de propósito:
 * ali o círculo não é acabamento, é o próprio elemento. Um play quadrado não é
 * um play com outro acabamento — é outro desenho. `testar-capas-novas.mjs`
 * prende a moldura; o play fica preso aqui.
 */
const cliente = readFileSync(path.join(RAIZ, ARQUIVOS["galeria-cliente.tsx"]), "utf8");
if (/h-14 w-14 place-items-center rounded-full/.test(cliente)) {
  ok("o selo de play continua redondo — círculo ali é o elemento, não o acabamento");
} else {
  erro("o selo de play deixou de ser redondo");
}

/* ── 3. A ponta de fora: o HTML da galeria pública ───────────────────────── */
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const bancada = await galeriaDaRodada(db, { nome: "acabamento" });
const url = `${BASE}/g/${bancada.tslug}/${bancada.gslug}`;
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [
  bancada.id,
]);

async function html(canto) {
  await db.query("update galerias set aparencia = $1 where id = $2", [
    JSON.stringify({ capa: "imersa", tema: "noite", tipografia: "serifada", grade: "colunas", canto }),
    bancada.id,
  ]);
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.text();
}

try {
  for (const [canto, px] of Object.entries(PILULAS)) {
    const corpo = await html(canto);
    if (corpo.includes(`--g-pilula:${px}px`)) {
      ok(`canto "${canto}" chega no HTML como pílula de ${px}px`);
    } else {
      erro(`canto "${canto}": esperava --g-pilula:${px}px, não achei`);
    }
  }

  /*
   * A prova que interessa ao Juan: com `reto`, a página não pode ter mais
   * NENHUM controle em cápsula. Contamos `rounded-full` no HTML servido — o
   * que sobrar ali é botão que ficou de fora da troca.
   *
   * O selo de play não conta: ele só existe quando há vídeo na galeria, e a
   * bancada não tem nenhum.
   */
  const reto = await html("reto");
  const sobrando = reto.match(/class="[^"]*rounded-full[^"]*"/g) ?? [];
  if (sobrando.length === 0) {
    ok("com o canto reto, nenhum controle continua em cápsula");
  } else {
    erro(`${sobrando.length} controles continuam redondos: ${sobrando.slice(0, 3).join(" | ")}`);
  }

  /* E o contrário: com o padrão, a galeria de hoje continua igual. */
  const suave = await html("suave");
  if (suave.includes("--g-pilula:999px")) {
    ok("no padrão, a cápsula de sempre");
  } else {
    erro("o padrão deixou de desenhar a cápsula");
  }
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ o acabamento não acompanha o canto" : "\n✓ acabamento ok");
process.exit(falhou ? 1 : 0);
