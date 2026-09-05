#!/usr/bin/env node
/**
 * Os dois eixos de FORMA da galeria: altura da capa e canto das fotos. Uso:
 *   node --env-file=.env.local scripts/testar-eixos-forma.mjs
 *
 * ── O QUE ESTE ARQUIVO EXISTE PARA PRENDER ────────────────────────────────
 *
 * Até 04/09/2026 a capa imersa tinha `min-h-[78vh]` e as fotos `rounded-md`
 * escritos no componente. Não eram padrões: eram as únicas opções. O Felipe
 * pediu as duas — "diminuir o tamanho da foto da capa" e "escolher se o canto
 * das fotos será ondulado ou quadrado, e se for ondulado, o quanto".
 *
 * O jeito de errar isto é sutil. O Tailwind gera as classes LENDO O CÓDIGO: só
 * existe `min-h-[42vh]` se alguém tiver escrito exatamente isso em algum
 * arquivo. Uma altura escolhida no painel nunca teria classe gerada, e o
 * resultado seria uma galeria sem altura nenhuma — a capa colapsando na altura
 * da foto. Por isso o valor viaja como variável de CSS e a classe é fixa.
 *
 * Este teste confere as duas pontas: que a variável CHEGA no HTML com o valor
 * escolhido, e que os componentes a USAM em vez do número cravado. Uma sem a
 * outra passa e entrega galeria quebrada.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

import {
  OPCOES,
  APARENCIA_PADRAO,
  PRESETS,
  alturaCapaVh,
  raioDoCantoPx,
  variaveisDeForma,
  presetEquivalente,
} from "../src/config/aparencia.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let falhou = false;
const ok = (m) => console.log(`  ✓ ${m}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

console.log("Eixos de forma — altura da capa e canto das fotos\n");

/* ── 1. Os valores, escritos à mão ────────────────────────────────────────
 *
 * De propósito NÃO saem de OPCOES: uma tabela lida da própria fonte concorda
 * com qualquer mudança e não confere nada. Estes quatro números são o contrato
 * — mudar um deles muda a cara de galeria entregue, e tem de doer aqui. */
const ALTURAS = { baixa: 42, media: 60, cheia: 78 };
const CANTOS = { reto: 0, suave: 6, redondo: 14, muito: 24 };

for (const [id, vh] of Object.entries(ALTURAS)) {
  const lido = alturaCapaVh(id);
  if (lido === vh) ok(`altura "${id}" vale ${vh}vh`);
  else erro(`altura "${id}" devia valer ${vh}vh, veio ${lido}`);
}
for (const [id, px] of Object.entries(CANTOS)) {
  const lido = raioDoCantoPx(id);
  if (lido === px) ok(`canto "${id}" vale ${px}px`);
  else erro(`canto "${id}" devia valer ${px}px, veio ${lido}`);
}

/* Os dois eixos precisam ter todas as opções listadas na interface: opção que
   existe no tipo e não em OPCOES é escolha que ninguém consegue fazer. */
for (const [eixo, esperado] of [
  ["alturaCapa", Object.keys(ALTURAS)],
  ["canto", Object.keys(CANTOS)],
]) {
  const ids = (OPCOES[eixo] ?? []).map((o) => o.id);
  const faltando = esperado.filter((e) => !ids.includes(e));
  if (!faltando.length && ids.length === esperado.length) {
    ok(`o eixo "${eixo}" oferece as ${esperado.length} opções na interface`);
  } else {
    erro(`o eixo "${eixo}" tem ${ids.join(", ") || "nada"} — esperava ${esperado.join(", ")}`);
  }
}

/* ── 2. O padrão repete o que o componente cravava ────────────────────────
 *
 * 78vh e 6px eram os números escritos no código antes dos eixos existirem.
 * Como `lerAparencia` completa o que falta com o padrão, TODA galeria já
 * entregue passa por aqui. Um padrão diferente mudaria a cara delas sem
 * ninguém ter mexido em nada. */
if (APARENCIA_PADRAO.alturaCapa === "cheia" && APARENCIA_PADRAO.canto === "suave") {
  ok("o padrão é cheia/suave — 78vh e 6px, o que o componente já desenhava");
} else {
  erro(
    `o padrão virou ${APARENCIA_PADRAO.alturaCapa}/${APARENCIA_PADRAO.canto} — galeria antiga muda de cara`,
  );
}

const forma = variaveisDeForma(APARENCIA_PADRAO);
if (forma["--g-capa-h"] === "78vh" && forma["--g-canto"] === "6px") {
  ok("variaveisDeForma devolve 78vh e 6px no padrão");
} else {
  erro(`variaveisDeForma devolveu ${JSON.stringify(forma)}`);
}

/* Preset que escolhesse outro par desmarcaria o card de toda galeria antiga
   que usa aquele preset — ver o comentário acima de PRESETS. */
const presetsDivergentes = PRESETS.filter(
  (p) => p.aparencia.alturaCapa !== "cheia" || p.aparencia.canto !== "suave",
).map((p) => p.id);
if (!presetsDivergentes.length) {
  ok(`os ${PRESETS.length} presets usam o mesmo par, e o card antigo segue marcado`);
} else {
  erro(`presets com forma própria: ${presetsDivergentes.join(", ")}`);
}

/* A prova disso: uma aparência gravada ANTES dos eixos — sem os dois campos —
   ainda tem de casar com o preset dela. */
const antiga = { ...PRESETS[0].aparencia };
delete antiga.alturaCapa;
delete antiga.canto;
const casou = presetEquivalente({ ...APARENCIA_PADRAO, ...antiga });
if (casou === PRESETS[0].id) {
  ok(`aparência gravada antes dos eixos ainda casa com o preset "${PRESETS[0].id}"`);
} else {
  erro(`aparência antiga casou com "${casou}" em vez de "${PRESETS[0].id}"`);
}

/* ── 3. Os componentes usam a variável, não o número ──────────────────────
 *
 * É a metade que o teste de HTTP não pega: com `min-h-[78vh]` de volta no
 * componente, a variável continuaria chegando no HTML e a página continuaria
 * 200 — só que a escolha não faria nada. */
const capa = readFileSync(path.join(RAIZ, "src/components/galeria-capa.tsx"), "utf8");
const cliente = readFileSync(path.join(RAIZ, "src/components/galeria-cliente.tsx"), "utf8");

const cravadoNaCapa = capa.match(/min-h-\[\d+vh\]/g);
if (!cravadoNaCapa) ok("nenhuma altura de capa cravada em vh no componente");
else erro(`altura cravada na capa: ${[...new Set(cravadoNaCapa)].join(", ")}`);

if (/min-h-\[var\(--g-capa-h/.test(capa)) ok("a capa lê a altura da variável");
else erro("a capa não usa --g-capa-h");

if (/rounded-\[var\(--g-canto/.test(cliente)) ok("a grade lê o canto da variável");
else erro("a grade não usa --g-canto");

const cantoCravado = cliente.match(/overflow-hidden rounded-(md|lg|xl|sm)\b/g);
if (!cantoCravado) ok("nenhum canto de foto cravado na grade");
else erro(`canto cravado na grade: ${[...new Set(cantoCravado)].join(", ")}`);

/* ── 4. A ponta de fora: o HTML da galeria pública ────────────────────────── */
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const bancada = await galeriaDaRodada(db);
const url = `${BASE}/g/${bancada.tslug}/${bancada.gslug}`;
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [
  bancada.id,
]);

async function html(aparencia) {
  await db.query("update galerias set aparencia = $1 where id = $2", [
    JSON.stringify(aparencia),
    bancada.id,
  ]);
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.text();
}

const base = { capa: "imersa", tema: "noite", tipografia: "serifada", grade: "colunas" };

try {
  for (const [alturaCapa, canto, vh, px] of [
    ["baixa", "reto", 42, 0],
    ["media", "redondo", 60, 14],
    ["cheia", "muito", 78, 24],
  ]) {
    const corpo = await html({ ...base, alturaCapa, canto });
    /* React escreve a propriedade custom no atributo style tal como está. */
    const temAltura = corpo.includes(`--g-capa-h:${vh}vh`);
    const temCanto = corpo.includes(`--g-canto:${px}px`);
    if (temAltura && temCanto) {
      ok(`${alturaCapa}/${canto} chega no HTML como ${vh}vh e ${px}px`);
    } else {
      erro(
        `${alturaCapa}/${canto}: altura ${temAltura ? "ok" : "faltou"}, canto ${temCanto ? "ok" : "faltou"}`,
      );
    }
  }

  /* Valor inventado cai no padrão, como todo eixo de `lerAparencia`. */
  const corpoInvalido = await html({ ...base, alturaCapa: "gigante", canto: "ondulado" });
  if (corpoInvalido.includes("--g-capa-h:78vh") && corpoInvalido.includes("--g-canto:6px")) {
    ok("valor inválido cai no padrão sem quebrar a página");
  } else {
    erro("valor inválido não caiu no padrão");
  }

  /*
   * ── O QUE ESTE ARQUIVO NÃO CONFERE, E POR QUÊ ──────────────────────────
   *
   * Falta uma pergunta: o Tailwind chegou a GERAR a regra de
   * `.min-h-[var(--g-capa-h,78vh)]`? Classe no atributo sem regra na folha é
   * atributo decorativo, e a capa colapsaria com tudo aqui verde.
   *
   * Tentei três formas de escrevê-la em 04/09/2026 e nenhuma falhou pelo
   * motivo certo. Em desenvolvimento a folha do Next ACUMULA: apaguei a classe
   * do componente e a regra continuou lá, de uma compilação anterior — a
   * conferência ficava verde exatamente no caso que ela existia para pegar. E
   * um valor arbitrário que o Tailwind recusa de verdade (colchete
   * desbalanceado) derruba a página inteira com HTTP 500, que já é vermelho
   * antes de chegar no CSS.
   *
   * Fica sem, de propósito. As duas conferências que sobraram — "nenhuma
   * altura cravada no componente" e "o valor chega no HTML" — eu vi falharem
   * ao recolocar `rounded-md` no lugar, e é essa a regressão provável. Quem
   * for tentar de novo: precisa de servidor recém-subido, como o do portão do
   * deploy, senão a folha velha responde pela nova.
   */

  /* Aparência de antes dos eixos: os campos simplesmente não existem. */
  const corpoAntigo = await html(base);
  if (corpoAntigo.includes("--g-capa-h:78vh") && corpoAntigo.includes("--g-canto:6px")) {
    ok("aparência sem os campos novos desenha 78vh e 6px, como antes");
  } else {
    erro("aparência antiga não desenhou o que desenhava antes");
  }
} finally {
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ os eixos de forma têm problema");
  process.exit(1);
}
console.log("\n✓ altura da capa e canto das fotos funcionando");
