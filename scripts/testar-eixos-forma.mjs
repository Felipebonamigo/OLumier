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

/*
 * ── A REGRA É SOBRE MUDAR UM PRESET, NÃO SOBRE CRIAR UM (16/09/2026) ──────
 *
 * MUDAR o par de um preset que já existe desmarca o card de toda galeria antiga
 * que casava com ele: ninguém mexeu em nada e o editor passa a dizer
 * "personalizado". É o defeito que esta verificação nasceu para impedir, e ele
 * continua guardado — a lista abaixo é fechada de propósito.
 *
 * CRIAR um preset com outro par não desmarca ninguém, e a razão é aritmética:
 * nenhuma galeria casa hoje com uma combinação que não existia. É exatamente o
 * que o comentário de `PRESETS` prevê ("dá para dar a cada preset o canto que
 * combina com ele — Moda com `reto`, Papel com `redondo`"), e o "Marfim" é o
 * primeiro a exercer isso: ele reproduz o telefone da página inicial, cujas
 * miniaturas têm canto visivelmente arredondado.
 *
 * Preset novo entra nesta lista só se alguém decidir que ele deve seguir o par
 * antigo. Verificar `PRESETS` inteiro voltaria a proibir o que já foi decidido
 * que é permitido.
 */
/*
 * ── A LISTA ENCOLHEU PARA UM, E O MOTIVO FOI MEDIDO (29/09/2026) ──────────
 *
 * Ela nasceu com nove nomes para impedir que refinar um preset desmarcasse o
 * cartão de galerias antigas. O raciocínio continua certo; o que faltava era o
 * NÚMERO de quem ele protegia.
 *
 * Rodando `presetEquivalente` sobre as 512 galerias do banco naquele dia:
 *
 *     (personalizado)  510
 *     atomo              2
 *
 * Nenhuma galeria casava com Revista, Ateliê, Essencial, Convite, Caligrafia,
 * Moda, Cerimônia ou Papel. Congelar esses oito não guardava ninguém — só
 * proibia o conserto que o Juan tinha pedido ("tem várias super iguais, não dá
 * pra perceber a diferença"), porque a forma é um dos seis eixos que a
 * miniatura desenha, e portanto um dos poucos jeitos de separar dois cartões.
 *
 * O Átomo fica, e agora com a razão em números: ele é o único com galerias
 * casadas. Quem for mexer nele desmarca duas — e que seja uma decisão, não um
 * efeito colateral.
 *
 * Preset novo entra nesta lista só se alguém decidir que ele deve seguir o par
 * antigo. `testar-estilos-distintos.mjs` cuida do outro lado: que os dez
 * continuem diferentes entre si onde a pessoa escolhe.
 */
const PRESETS_DO_PAR_ANTIGO = ["atomo"];
const presetsDivergentes = PRESETS.filter(
  (p) =>
    PRESETS_DO_PAR_ANTIGO.includes(p.id) &&
    (p.aparencia.alturaCapa !== "cheia" || p.aparencia.canto !== "suave"),
).map((p) => p.id);
if (!presetsDivergentes.length) {
  ok(`os ${PRESETS_DO_PAR_ANTIGO.length} presets antigos usam o mesmo par, e o card segue marcado`);
} else {
  erro(`preset ANTIGO mudou de forma: ${presetsDivergentes.join(", ")}`);
}

/* E o contrário: um id que sumiu de `PRESETS` sem sair desta lista faria a
   verificação passar sem verificar nada. */
const sumidos = PRESETS_DO_PAR_ANTIGO.filter((id) => !PRESETS.some((p) => p.id === id));
if (!sumidos.length) ok("a lista dos presets antigos ainda descreve presets que existem");
else erro(`a lista cita preset que não existe mais: ${sumidos.join(", ")}`);

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

  /*
   * ── O ALINHAMENTO DA CAPA (05/09/2026) ───────────────────────────────────
   *
   * Juan: "me incomoda tudo estar torto. Não tá nem centralizado, nem tudo pra
   * esquerda. Cada coisa tá de um jeito". Ele estava olhando a capa jornal, em
   * que nome do estúdio, título, data e botão são todos centralizados — e por
   * terem larguras diferentes, as bordas ESQUERDAS de cada um caem em lugares
   * diferentes. Centralizado está certo em relação ao eixo do meio e torto em
   * relação a qualquer linha vertical, que é o que o olho procura.
   *
   * A resposta é a escolha que ele pediu junto ("tem como escolher entre as
   * opções de formatação? centralizado, alinhamento pra esquerda"): um eixo, e
   * `centro` como padrão para nenhuma galeria entregue mudar de cara.
   */
  for (const [alinhamento, marca, ausente] of [
    ["centro", "text-center", "text-left"],
    ["esquerda", "text-left", "text-center"],
  ]) {
    const corpo = await html({ ...base, capa: "jornal", alinhamento });
    const cabecalho = corpo.match(/<header[^>]*data-capa="jornal"[^>]*>/)?.[0] ?? "";
    if (cabecalho.includes(marca) && !cabecalho.includes(ausente)) {
      ok(`alinhamento "${alinhamento}" desenha a capa com ${marca}`);
    } else {
      erro(`alinhamento "${alinhamento}": cabeçalho veio "${cabecalho.slice(0, 120)}"`);
    }
  }

  /* A caixa do título é centrada por `mx-auto`. Trocar só o `text-align`
     deixaria a CAIXA no meio e o texto encostado na esquerda dela — ou seja,
     ainda torto, e pior, porque agora há duas referências.
 *
 * A caixa mudou de elemento em 16/09/2026 e a asserção mudou junto: era uma
 * `div` com `max-w-[16ch]` em volta do título, e o limite passou para o
 * próprio `h1`. O motivo está em `quebraDoTitulo` — na `div` o `ch` era medido
 * na fonte do CORPO, e um limite que devia valer uns 430 px de título valia
 * 145, empilhando "Nathalia & Matheus" em três linhas. O que este teste
 * guarda continua sendo o mesmo: à esquerda, a caixa não pode ficar centrada. */
  for (const [alinhamento, deveCentrar] of [
    ["centro", true],
    ["esquerda", false],
  ]) {
    const corpo = await html({ ...base, capa: "jornal", alinhamento });
    const caixaDoTitulo = corpo.match(/<h1[^>]*class="[^"]*"/)?.[0] ?? "";
    const centrada = caixaDoTitulo.includes("mx-auto");
    if (caixaDoTitulo && centrada === deveCentrar) {
      ok(
        deveCentrar
          ? "centralizado, a caixa do título fica no eixo do meio"
          : "à esquerda, a caixa do título perde o mx-auto e encosta na mesma linha",
      );
    } else {
      erro(`a caixa do título veio "${caixaDoTitulo.slice(0, 110)}" com alinhamento ${alinhamento}`);
    }
  }

  /*
   * A COR DO NOME DO ESTÚDIO NÃO É A COR DO BOTÃO.
   *
   * Juan: "deixei os botões verdinhos e gostei, mas a logo também ficou verde
   * e isso ficou ruim". `TextoEstudio` pintava com `--g-destaque` — a mesma
   * variável do botão. Enquanto o destaque era do tema, ninguém reparava;
   * desde que ele virou escolha rotulada "Botões", pintar o nome do estúdio com
   * ela é o botão vazando para onde ninguém pediu.
   */
  const comBotaoVerde = await html({
    ...base,
    capa: "jornal",
    cores: { destaque: "#22c55e" },
  });
  const nomeDoEstudio =
    comBotaoVerde.match(/<p class="font-mono text-\[11px\] uppercase[^"]*"[^>]*>/)?.[0] ?? "";
  if (nomeDoEstudio && !/--g-destaque/.test(nomeDoEstudio)) {
    ok("o nome do estúdio não usa a cor do botão");
  } else {
    erro(`o nome do estúdio ainda pinta com --g-destaque: "${nomeDoEstudio.slice(0, 120)}"`);
  }

  /*
   * ── O NOME DO CAPÍTULO É TEXTO, NÃO BOTÃO (06/09/2026) ───────────────────
   *
   * Duas queixas do Juan atravessam a capa e continuam valendo ABAIXO dela, e
   * eu tinha corrigido só a metade de cima:
   *
   *   "deixei os botões verdinhos e gostei, mas a logo também ficou verde"
   *   "queria que TODOS os textos estivessem alinhados pra esse lado"
   *
   * O nome do capítulo — "Making Of", "Cerimônia" — pintava com `--g-destaque`
   * e ficava `text-center` cravado. Com a cor do botão escolhida, ele virava
   * verde junto; com o alinhamento à esquerda, a capa ia para a esquerda e ele
   * continuava no meio. Ou seja, "cada coisa de um jeito", só que rolando a
   * página para baixo.
   */
  const comCapitulo = await db.query(
    "insert into secoes (galeria_id, nome, ordem) values ($1, 'Cerimônia', 0) returning id",
    [bancada.id],
  );
  await db.query("update medias set secao_id = $2 where galeria_id = $1", [
    bancada.id,
    comCapitulo.rows[0].id,
  ]);
  try {
    /*
     * ── AS DUAS CONFERÊNCIAS DAQUI PERDERAM O OBJETO (29/09/2026) ──────────
     *
     * Elas liam o `<h2>` do capítulo dentro da galeria — a cor dele e o
     * alinhamento dele. Esse `<h2>` NÃO EXISTE MAIS: o Juan pediu para tirá-lo
     * ("aparece ali em cima a 'aba' prévia e embaixo o mesmo título, fica
     * repetitivo... tire esse 'título', deixe só a 'aba'"), e ele saiu em
     * `galeria-cliente.tsx`, onde o motivo está escrito.
     *
     * Mantê-las aqui daria vermelho eterno num defeito que não existe. Apagá-las
     * sem dizer nada perderia a memória de por que elas nasceram. Então ficam
     * como texto, e a regra que elas guardavam continua guardada onde as duas
     * queixas do Juan nasceram — na CAPA, por `testar-cores-galeria.mjs` (a cor
     * de `--g-destaque` é só dos botões) e pelas etapas de alinhamento de
     * `testar-titulo-da-capa.mjs`.
     *
     * Se um dia o nome do capítulo voltar a ser desenhado no corpo da galeria,
     * estas duas voltam junto — o desenho abaixo é o que elas eram:
     *
     *     const tituloDoCapitulo = (corpo) =>
     *       corpo.match(/<h2[^>]*>\s*Cerimônia\s*<\/h2>/)?.[0] ?? "";
     *     // a cor: o `<h2>` não podia citar `--g-destaque`
     *     // o alinhamento: `text-left` com o eixo à esquerda, `text-center` no centro
     *
     * O que sobrou desta bancada com capítulo é a conferência de que a galeria
     * com seção NÃO quebra e continua desenhando os eixos de forma — que é o
     * assunto deste arquivo.
     */
    const comSecao = await html({ ...base, alinhamento: "esquerda" });
    if (comSecao.includes("--g-capa-h:") && comSecao.includes("--g-canto:")) {
      ok("galeria com capítulo continua desenhando os eixos de forma");
    } else {
      erro("galeria com capítulo perdeu as variáveis de forma");
    }
  } finally {
    await db.query("update medias set secao_id = null where galeria_id = $1", [bancada.id]);
    await db.query("delete from secoes where id = $1", [comCapitulo.rows[0].id]);
  }

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
