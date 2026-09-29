#!/usr/bin/env node
/**
 * NENHUM ESTILO PRONTO PODE PARECER O VIZINHO. Uso:
 *   node --env-file=.env.local scripts/testar-estilos-distintos.mjs
 *
 * Não precisa do servidor: é tudo sobre a tabela `PRESETS`.
 *
 * ── A QUEIXA, ESCRITA COMO CÓDIGO ─────────────────────────────────────────
 *
 * Juan, olhando a escolha de estilos: "essas prévias dos estilos não fazem
 * sentido, tem várias super iguais, não dá pra perceber qual a diferença entre
 * elas. Pra mim a 'ateliê', 'marfim' e 'caligrafia' são iguais. Convite e
 * revista também." E, em 29/09/2026: "refinar os estilos prontos", "fazer
 * estilos prontos mais encaminhados".
 *
 * A causa não é a tabela ser pobre — é a MINIATURA. `AmostraDoPreset` desenha
 * seis dos dezessete eixos: capa, tema, tipografia, grade, densidade e canto.
 * Dois estilos que só diferem em peso, altura da capa, logo, alinhamento ou
 * alturaTitulo saem byte a byte iguais no cartão onde a pessoa escolhe. Ateliê
 * e Caligrafia eram o caso extremo: o MESMO desenho com outra caligrafia.
 *
 * Então a regra que este arquivo prende é essa: dois estilos prontos têm de
 * diferir em pelo menos DOIS dos eixos que a miniatura desenha. Um só não
 * basta — foi exatamente um só que produziu a reclamação.
 *
 * ── POR QUE O ÁTOMO NÃO MUDA ──────────────────────────────────────────────
 *
 * Mudar um preset desmarca o cartão de toda galeria que casava com ele: o
 * editor passa a dizer "personalizado" sem ninguém ter tocado em nada. É o
 * defeito que `testar-eixos-forma.mjs` guardava proibindo os nove presets
 * antigos de mexer em `alturaCapa` e `canto`.
 *
 * Em 29/09/2026 esse custo foi MEDIDO, rodando `presetEquivalente` sobre as
 * 512 galerias do banco: 510 já apareciam como "personalizado", e as 2 que
 * casavam com algum preset casavam com o ÁTOMO. Refinar os outros nove desmarca
 * zero galerias. Refinar o Átomo desmarca duas.
 *
 * Por isso o Átomo fica congelado aqui, valor por valor, e os outros ficaram
 * livres. A guarda não foi apagada — foi apontada para onde ela protege alguém.
 */
import {
  PRESETS,
  OPCOES,
  presetEquivalente,
  lerAparencia,
} from "../src/config/aparencia.ts";

let falhou = false;
const ok = (m) => console.log(`  ✓ ${m}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

console.log("Os estilos prontos:\n");

/**
 * Os eixos que a miniatura desenha — e SÓ eles.
 *
 * Escritos à mão, e não lidos de `AmostraDoPreset`: uma lista deduzida do
 * componente concorda com qualquer mudança nele e não confere nada. Se a
 * amostra passar a desenhar um sétimo eixo, alguém tem de vir aqui e escrever
 * o nome dele — que é o momento de decidir se ele conta para a distinção.
 */
const EIXOS_VISIVEIS = ["capa", "tema", "tipografia", "grade", "densidade", "canto"];

/* ── 1. A regra ───────────────────────────────────────────────────────────── */
const pares = [];
for (let i = 0; i < PRESETS.length; i++) {
  for (let j = i + 1; j < PRESETS.length; j++) {
    const a = PRESETS[i];
    const b = PRESETS[j];
    const diferem = EIXOS_VISIVEIS.filter((e) => a.aparencia[e] !== b.aparencia[e]);
    if (diferem.length < 2) {
      pares.push(
        `${a.nome} × ${b.nome} — ${
          diferem.length === 0
            ? "idênticos na miniatura"
            : `só "${diferem[0]}" os separa`
        }`,
      );
    }
  }
}
if (pares.length === 0) {
  ok(`os ${PRESETS.length} estilos diferem em 2+ eixos visíveis, dois a dois`);
} else {
  for (const p of pares) erro(p);
}

/* ── 2. Todo preset preenche os seis ──────────────────────────────────────── */
const incompletos = PRESETS.filter((p) =>
  EIXOS_VISIVEIS.some((e) => p.aparencia[e] === undefined),
).map((p) => p.nome);
if (incompletos.length === 0) ok("todo estilo define os seis eixos que a miniatura desenha");
else erro(`estilo sem eixo visível preenchido: ${incompletos.join(", ")}`);

/* ── 3. O Átomo, congelado ────────────────────────────────────────────────
 *
 * Valor por valor, e não `toEqual` contra ele mesmo: a tabela abaixo é o
 * contrato com as duas galerias que casam com ele hoje. */
const ATOMO = {
  capa: "imersa",
  tema: "noite",
  tipografia: "serifada",
  grade: "editorial",
  densidade: "normal",
  canto: "suave",
  alturaCapa: "cheia",
};
const atomo = PRESETS.find((p) => p.id === "atomo");
if (!atomo) {
  erro("o preset Átomo sumiu — as duas galerias que casavam com ele viram personalizado");
} else {
  const fora = Object.entries(ATOMO).filter(([e, v]) => atomo.aparencia[e] !== v);
  if (fora.length === 0) {
    ok("o Átomo continua idêntico — as 2 galerias que casam com ele seguem marcadas");
  } else {
    erro(
      `o Átomo mudou: ${fora.map(([e, v]) => `${e} era "${v}", virou "${atomo.aparencia[e]}"`).join("; ")}`,
    );
  }
}

/* ── 4. Cada forma aparece em algum estilo ────────────────────────────────
 *
 * É a resposta prática à pergunta do Juan sobre o acabamento entrar no
 * assistente de galeria nova. Ele NÃO entra: a escolha mora em Design, e chega
 * ao assistente pelos estilos prontos. Para isso valer, cada valor do eixo tem
 * de ser alcançável escolhendo um cartão — senão "está nos estilos" é conversa.
 */
const cantosUsados = new Set(PRESETS.map((p) => p.aparencia.canto));
const cantosOrfaos = OPCOES.canto.map((o) => o.id).filter((id) => !cantosUsados.has(id));
if (cantosOrfaos.length === 0) {
  ok(`os ${OPCOES.canto.length} acabamentos são alcançáveis por algum estilo pronto`);
} else {
  erro(`acabamento que nenhum estilo oferece: ${cantosOrfaos.join(", ")}`);
}

/* ── 5. A capa nova tem vitrine ───────────────────────────────────────────
 *
 * Capa que nenhum estilo pronto usa é capa que quase ninguém acha: o caminho
 * até ela é abrir Design, achar a lista de capas e experimentar. */
if (PRESETS.some((p) => p.aparencia.capa === "cartaz")) {
  ok("a capa Cartaz aparece em algum estilo pronto");
} else {
  erro("nenhum estilo pronto usa a capa Cartaz — ela nasce escondida");
}

/* ── 6. E cada preset ainda casa consigo mesmo ────────────────────────────
 *
 * `presetEquivalente` compara dezesseis eixos. Um preset cujo próprio objeto
 * não casa com ele é um cartão que nunca fica marcado — aconteceria se alguém
 * esquecesse um eixo novo na tabela. */
const naoCasam = PRESETS.filter(
  (p) => presetEquivalente(lerAparencia(p.aparencia)) !== p.id,
).map((p) => p.nome);
if (naoCasam.length === 0) ok("todo estilo casa consigo mesmo");
else erro(`estilo que não casa com o próprio cartão: ${naoCasam.join(", ")}`);

console.log(falhou ? "\n✗ os estilos prontos se repetem" : "\n✓ estilos prontos distintos");
process.exit(falhou ? 1 : 0);
