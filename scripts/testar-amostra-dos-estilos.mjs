#!/usr/bin/env node
/**
 * DUAS AMOSTRAS DE ESTILO NUNCA PODEM SER IGUAIS. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-amostra-dos-estilos.mjs
 *
 * ── A QUEIXA, VIRADA INVARIANTE (25/09/2026) ──────────────────────────────
 *
 * Juan, escolhendo estilo ao criar uma galeria:
 *
 *   "Essas prévias dos estilos não fazem sentido. Tem várias super iguais, não
 *    dá pra perceber qual a diferença entre elas. Talvez podemos deixar uma
 *    'prévia' nessa escolha dos estilos. Pra mim a 'ateliê', 'marfim' e
 *    'caligrafia' são iguais. Convite e revista também."
 *
 * "Super iguais" é testável: a amostra é HTML com estilo em linha, então duas
 * amostras indistinguíveis são duas amostras com a MESMA marcação. A etapa
 * principal compara as dez entre si e, quando duas baterem, diz quais — que é
 * a frase que ele mandou, escrita pelo teste em vez de por ele.
 *
 * Isso não pega tudo: duas amostras podem diferir num pixel e continuar
 * parecendo iguais aos olhos. Mas o defeito real era deste tipo — a amostra
 * antiga desenhava tema e tipografia, e "Ateliê" e "Marfim" são creme com a
 * MESMA manuscrita, então saíam byte a byte idênticas.
 *
 * ── E UMA AMOSTRA SÓ, PARA OS DOIS LUGARES ────────────────────────────────
 *
 * Havia duas, diferentes, para a mesma decisão: uma no assistente (tema e
 * fonte) e outra no editor de Design (grade). Cada uma mostrava um terço, e
 * nenhuma desenhava a CAPA — que é justamente o que separa um preset do outro.
 * A última etapa confere que as duas telas usam o mesmo desenho, porque foi a
 * duplicação que deixou as duas erradas de jeitos diferentes.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

exigirBancoDeTeste();

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

const { PRESETS } = await import("../src/config/aparencia.ts");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const g = await galeriaDaRodada(db, { nome: "amostras", medias: 3, publicada: true });
const cookie = cookieDeSessao(g.tenant_id);

const pegar = async (caminho) =>
  (await fetch(`${BASE}${caminho}`, { headers: { cookie }, cache: "no-store" })).text();

/** A amostra de cada preset, tirada do HTML pelo nome que vem logo depois dela. */
function amostras(html, altura) {
  const re = new RegExp(
    `<span aria-hidden="true" class="mb-2 ${altura} w-full"([\\s\\S]*?)` +
      `<span class="block text-sm font-medium">([^<]+)</span>`,
    "g",
  );
  const achadas = new Map();
  for (const m of html.matchAll(re)) achadas.set(m[2].trim(), m[1]);
  return achadas;
}

console.log("\nAs amostras dos estilos:\n");

const nova = await pegar("/painel/galerias/nova");
const doAssistente = amostras(nova, "h-28");

await etapa("cada estilo tem a sua amostra no assistente", () => {
  if (doAssistente.size !== PRESETS.length) {
    throw new Error(
      `achei ${doAssistente.size} amostras para ${PRESETS.length} estilos` +
        ` — ${JSON.stringify([...doAssistente.keys()])}`,
    );
  }
  return `${doAssistente.size} amostras`;
});

await etapa("NENHUM par de estilos desenha a mesma amostra", () => {
  const porMarcacao = new Map();
  for (const [nome, marcacao] of doAssistente) {
    const igual = porMarcacao.get(marcacao);
    if (igual) {
      throw new Error(
        `"${igual}" e "${nome}" saem idênticos na tela — é a queixa de 25/09 ` +
          `("tem várias super iguais, não dá pra perceber qual a diferença"), e ` +
          `nenhum dos dois é escolhível por quem olha`,
      );
    }
    porMarcacao.set(marcacao, nome);
  }
  return `${doAssistente.size} desenhos distintos`;
});

await etapa("a amostra desenha a CAPA, e não só a cor e a letra", () => {
  /*
   * O defeito antigo em uma linha: a amostra era uma tarja de cor com o nome
   * dentro. Se um dia voltar a ser, todas as capas viram o mesmo retângulo —
   * e a etapa acima não pega, porque tema e fonte ainda diferem entre alguns.
   *
   * A prova é o par ateliê/marfim: MESMO tema, MESMA fonte, capas diferentes
   * (dividida com foto ao lado do nome; mínima sem foto nenhuma). Se as duas
   * amostras tiverem a mesma altura de capa, a capa não está sendo desenhada.
   */
  const alturaDaCapa = (nome) =>
    doAssistente.get(nome)?.match(/height:\s*(\d+)%/)?.[1] ?? null;
  const a = alturaDaCapa("Ateliê");
  const m = alturaDaCapa("Marfim");
  if (!a || !m) throw new Error("não achei a capa nas amostras de Ateliê/Marfim");
  if (a === m) {
    throw new Error(
      `Ateliê e Marfim abrem com a mesma capa (${a}%) — a amostra voltou a ignorar` +
        " o eixo que mais separa um estilo do outro",
    );
  }
  return `capa dividida ${a}% · capa mínima ${m}%`;
});

await etapa("a amostra mostra a fonte do título do preset", () => {
  /* Entre duas manuscritas sobre creme, a letra é a única diferença que
     sobra — Ateliê e Caligrafia são o mesmo desenho com outra caligrafia. */
  const fonte = (nome) => doAssistente.get(nome)?.match(/font-family:([^;"]+)/)?.[1]?.trim();
  const atelie = fonte("Ateliê");
  const caligrafia = fonte("Caligrafia");
  if (!atelie) throw new Error("a amostra não diz em que fonte o título sai");
  if (atelie === caligrafia) {
    throw new Error(`Ateliê e Caligrafia saem na mesma fonte (${atelie})`);
  }
  return "fontes distintas";
});

await etapa("o editor de Design usa a MESMA amostra do assistente", async () => {
  const design = await pegar(`/painel/galerias/${g.id}/design`);
  const doEditor = amostras(design, "h-20");
  if (doEditor.size !== PRESETS.length) {
    throw new Error(
      `o editor mostra ${doEditor.size} amostras — ele voltou a ter um desenho próprio,` +
        " que foi como as duas telas acabaram erradas de jeitos diferentes",
    );
  }
  /* Mesma marcação nos dois lados, tirando a altura da caixa, que é de cada
     tela: no assistente o cartão é maior. */
  for (const [nome, marcacao] of doAssistente) {
    if (doEditor.get(nome) !== marcacao) {
      throw new Error(`"${nome}" sai diferente nas duas telas — voltou a haver duas amostras`);
    }
  }
  return `${doEditor.size} iguais nas duas telas`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ as amostras dos estilos têm problema" : "\n✓ amostras dos estilos ok");
process.exit(falhou ? 1 : 0);
