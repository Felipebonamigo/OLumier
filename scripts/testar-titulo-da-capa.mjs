#!/usr/bin/env node
/**
 * O TAMANHO E A QUEBRA DO TÍTULO DA CAPA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-titulo-da-capa.mjs
 *
 * ── O DEFEITO (16/09/2026) ────────────────────────────────────────────────
 *
 * Felipe mandou a foto da prévia: "Nathalia & Matheus" empilhado em três
 * linhas na capa redonda. "O título fica obrigatoriamente um em cima do outro.
 * Eu acho que eu iria preferir se tudo ficasse em uma linha só."
 *
 * A causa era uma conta na fonte errada. As capas embrulhavam o título assim:
 *
 *     <div class="mt-2 max-w-[18ch] mx-auto">
 *       <h1 style="font-family: Cormorant; font-size: 48px">…</h1>
 *
 * O `18ch` estava na `div`, e `ch` é a largura do "0" DO ELEMENTO EM QUE A
 * REGRA ESTÁ. A `div` herda a fonte do corpo em 16 px, então o limite valia uns
 * 145 px — enquanto o título ao lado desenhava em 48 px e pedia uns 430. O
 * nome não cabia, e caía em três linhas dentro de uma caixa estreita demais
 * para qualquer uma delas.
 *
 * ── O QUE ESTE TESTE PRENDE ───────────────────────────────────────────────
 *
 * 1. O limite de largura mora no `h1` — onde o `ch` mede a fonte do título.
 * 2. Nome de casal comum cabe em uma linha quando a escolha é "1 linha", e o
 *    `nowrap` vem com um teto que impede o título de vazar a tela.
 * 3. "2 linhas" e "3 linhas" produzem caixas progressivamente mais estreitas,
 *    e nunca mais estreitas que a maior palavra do nome.
 * 4. A barrinha multiplica o tamanho da capa, e 100% não muda nada.
 * 5. Valor fora da faixa é aparado, não quebra a página.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import {
  OPCOES,
  lerAparencia,
  APARENCIA_PADRAO,
  TAMANHO_TITULO,
  PRESETS,
} from "../src/config/aparencia.ts";
import { linhasDoTitulo, desenhoDoTitulo, temPalavraQueNaoCabe } from "../src/lib/titulo-da-capa.ts";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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

/* O nome que gerou a queixa. Mantido ao pé da letra de propósito: é curto,
   tem uma palavra de oito letras e um "&" no meio — o formato de praticamente
   toda galeria de casamento, e o caso que o defeito quebrava. */
const NOME = "Nathalia & Matheus";

/* `nome` é a chave da bancada e entra no SLUG; o texto da capa é `titulo`.
   Passar "Nathalia & Matheus" como nome montaria uma URL com espaço e "&". */
const g = await galeriaDaRodada(db, {
  nome: "titulo-da-capa",
  titulo: NOME,
  medias: 3,
  publicada: true,
});
await db.query("update galerias set senha_hash = null, capa_media_id = $2 where id = $1", [
  g.id,
  g.midias[0].id,
]);

const base = { ...APARENCIA_PADRAO, capa: "redonda", tema: "claro", tipografia: "serifada" };

/** Devolve a tag `<h1 …>` da capa com a aparência pedida. */
/* O `<h1>` INTEIRO, e não só a tag: as linhas forçadas são conteúdo (`<br>`),
   não atributo, e a tag de abertura não diz nada sobre elas. */
const tituloInteiroCom = async (extra) => {
  await db.query("update galerias set aparencia = $1 where id = $2", [
    JSON.stringify({ ...base, ...extra }),
    g.id,
  ]);
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  const h1 = html.match(/<h1[^]*?<\/h1>/)?.[0];
  if (!h1) throw new Error("a capa não desenhou nenhum <h1>");
  return h1;
};

const tituloCom = async (extra) => {
  await db.query("update galerias set aparencia = $1 where id = $2", [
    JSON.stringify({ ...base, ...extra }),
    g.id,
  ]);
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  const h1 = html.match(/<h1[^>]*>/)?.[0];
  if (!h1) throw new Error("a capa não desenhou nenhum <h1>");
  return h1;
};

console.log("\nO título da capa:\n");

/* ── 1. A CONTA SAIU DA FONTE ERRADA ─────────────────────────────────────── */

await etapa("nenhuma capa embrulha mais o título numa caixa medida na fonte do corpo", async () => {
  const fonte = await import("node:fs/promises").then((fs) =>
    fs.readFile("src/components/galeria-capa.tsx", "utf8"),
  );
  /* O padrão antigo: `max-w-[NNch]` numa classe do Tailwind, que só pode estar
     numa `div` — o `h1` recebe a largura por `style`, calculada em JavaScript.
     Os comentários saem antes da varredura: o arquivo EXPLICA o defeito citando
     a classe que o causava, e o teste não pode confundir a explicação com ele. */
  const codigo = fonte.replace(/\/\*[^]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const sobrou = codigo.match(/max-w-\[\d+ch\]/g);
  if (sobrou) throw new Error(`ainda existem: ${[...new Set(sobrou)].join(", ")}`);
  return "a largura mora no h1, onde o ch é o da fonte do título";
});

await etapa("o limite de largura chega no h1, e não num pai", async () => {
  /* Em `auto`, que é quem ainda usa caixa: desde 17/09/2026 "2 linhas" e "3
     linhas" não são mais largura, são quebra explícita — ver a seção 3. */
  const h1 = await tituloCom({ linhasTitulo: "auto" });
  if (!/max-width:\s*\d+ch/.test(h1)) throw new Error(`o h1 veio sem max-width em ch: ${h1}`);
  return h1.match(/max-width:\s*\d+ch/)[0];
});

/* ── 2. UMA LINHA ────────────────────────────────────────────────────────── */

await etapa('"1 linha" impede a quebra', async () => {
  const h1 = await tituloCom({ linhasTitulo: "uma" });
  if (!/white-space:\s*nowrap/.test(h1)) throw new Error(`sem nowrap: ${h1}`);
  return "white-space: nowrap";
});

/*
 * O teto é o que separa "uma linha" de "uma linha que vaza a tela". Sem ele,
 * um nome comprido com `nowrap` empurra a página inteira e a galeria ganha
 * rolagem horizontal — num celular, a foto sai de vista junto.
 */
await etapa('"1 linha" vem com teto de largura, para o nome não vazar a tela', async () => {
  const h1 = await tituloCom({ linhasTitulo: "uma" });
  if (!h1.includes("cqw")) throw new Error(`o font-size não se mede contra a coluna: ${h1}`);
  if (!/min\(/.test(h1)) throw new Error(`sem min() entre o pedido e o que cabe: ${h1}`);
  return "font-size: min(pedido, o que cabe na coluna)";
});

await etapa('"1 linha" não estreita a caixa — seria contradição', async () => {
  const h1 = await tituloCom({ linhasTitulo: "uma" });
  if (/max-width:\s*\d+ch/.test(h1)) throw new Error(`veio com caixa estreita: ${h1}`);
  return "sem max-width";
});

/* ── 3. DUAS E TRÊS LINHAS ───────────────────────────────────────────────── */

/*
 * ── LARGURA NÃO CONTA LINHA (17/09/2026) ─────────────────────────────────
 *
 * Felipe, com "Júlia & Gustavo" e "3 linhas" marcado: "aqui o 3 linhas não está
 * em 3, está apenas em 2".
 *
 * As duas opções eram uma `max-width` estreita, na esperança de que o navegador
 * quebrasse onde se queria. Largura IMPEDE a linha de passar de um tamanho; o
 * navegador usa quantas linhas precisar, e nunca mais do que precisa. Três
 * linhas pediam uma caixa de 5 caracteres, o piso da maior palavra ("Gustavo",
 * sete) abria para oito, e em oito "Júlia &" cabe: duas linhas.
 *
 * ── E POR QUE O TESTE DEIXOU PASSAR ──────────────────────────────────────
 *
 * As etapas daqui conferiam que a caixa de três era mais estreita que a de
 * duas, e que nenhuma ficava menor que a maior palavra. As duas eram verdade —
 * sobre o MECANISMO. Nenhuma perguntava a única coisa que o Felipe pediu: em
 * quantas linhas o título saiu.
 *
 * É o erro clássico de testar a implementação: quando a implementação estava
 * certa e insuficiente, o teste concordou com ela.
 */

const quantasLinhas = (h1) => (h1.match(/<br\/?>/g) ?? []).length + 1;
/* O texto como a pessoa lê, sem marcação e com o `&` desescapado. */
const textoDoTitulo = (h1) =>
  h1
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

for (const [opcao, esperado] of [
  ["duas", 2],
  ["tres", 3],
]) {
  await etapa(`"${esperado} linhas" entrega ${esperado} linhas`, async () => {
    const h1 = await tituloInteiroCom({ linhasTitulo: opcao });
    const saiu = quantasLinhas(h1);
    if (saiu !== esperado) {
      throw new Error(`"${NOME}" saiu em ${saiu} — o pedido tem de virar o que ele diz ser`);
    }
    return textoDoTitulo(h1).replace(/ /g, " · ");
  });
}

await etapa("a quebra não parte palavra nem troca a ordem", async () => {
  for (const opcao of ["duas", "tres"]) {
    const lido = textoDoTitulo(await tituloInteiroCom({ linhasTitulo: opcao }));
    if (lido !== NOME) {
      throw new Error(`${opcao}: a capa diz "${lido}" e o título é "${NOME}"`);
    }
  }
  return `"${NOME}" inteiro nas duas`;
});

/*
 * Pedido impossível: menos palavras que linhas. Não se parte palavra no meio
 * para fechar a conta — a alternativa seria "Casa-" / "men-" / "to".
 */
await etapa("nome de uma palavra em três linhas sai em uma, sem hífen", async () => {
  await db.query("update galerias set titulo = 'Casamento' where id = $1", [g.id]);
  try {
    const h1 = await tituloInteiroCom({ linhasTitulo: "tres" });
    const saiu = quantasLinhas(h1);
    if (saiu !== 1) throw new Error(`"Casamento" saiu em ${saiu} linha(s)`);
    if (textoDoTitulo(h1) !== "Casamento") throw new Error(`virou "${textoDoTitulo(h1)}"`);
    return "uma palavra, uma linha";
  } finally {
    await db.query("update galerias set titulo = $2 where id = $1", [g.id, NOME]);
  }
});

/*
 * Com a quebra decidida, cada linha precisa CABER — senão ela vira duas e o
 * pedido de três entrega quatro. É o mesmo teto que "1 linha" já usava, agora
 * medido contra a maior das linhas.
 */
await etapa("linha decidida não vira duas por falta de espaço", async () => {
  for (const opcao of ["duas", "tres"]) {
    const h1 = await tituloCom({ linhasTitulo: opcao });
    if (!/white-space:\s*nowrap/.test(h1)) throw new Error(`${opcao}: sem nowrap — pode rewrapar`);
    if (!h1.includes("cqw") || !/min\(/.test(h1)) {
      throw new Error(`${opcao}: sem teto de largura, um nome comprido vaza a tela`);
    }
  }
  return "nowrap + font-size: min(pedido, o que cabe)";
});

await etapa("com a quebra decidida, a caixa estreita sai de cena", async () => {
  for (const opcao of ["duas", "tres"]) {
    const h1 = await tituloCom({ linhasTitulo: opcao });
    if (/max-width:\s*\d+ch/.test(h1)) {
      throw new Error(`${opcao} ainda vem com caixa: ${h1.match(/max-width:[^;"]*/)[0]}`);
    }
  }
  return "quem decide as linhas são as linhas";
});

/*
 * A repartição é equilibrada, e isto NÃO é detalhe de gosto: a gulosa enche a
 * primeira linha e deixa a sobra na última, que produz "Maria Eduarda &" /
 * "Silva" onde o certo é "Maria Eduarda" / "& Silva".
 */
await etapa("as linhas saem parecidas, não uma cheia e uma sobra", () => {
  const casos = [
    ["Júlia & Gustavo", "tres", ["Júlia", "&", "Gustavo"]],
    ["Júlia & Gustavo", "duas", ["Júlia &", "Gustavo"]],
    ["Maria Eduarda & Silva", "duas", ["Maria Eduarda", "& Silva"]],
  ];
  for (const [texto, opcao, esperado] of casos) {
    const deu = linhasDoTitulo(texto, opcao);
    if (JSON.stringify(deu) !== JSON.stringify(esperado)) {
      throw new Error(`"${texto}" em ${opcao}: ${JSON.stringify(deu)}`);
    }
  }
  return `${casos.length} repartições conferidas`;
});

/*
 * ── A CAPA NÃO PODE DERRUBAR A GALERIA (18/09/2026) ──────────────────────
 *
 * Em 17/09 esta mudança foi ao ar e o Felipe mandou a galeria de um casamento
 * entregue mostrando "Alguma coisa saiu do lugar". Eu revertí tudo no mesmo dia
 * sem nunca ter reproduzido a falha.
 *
 * Estas etapas não perguntam qual era o defeito. Elas prendem a hierarquia que
 * torna a pergunta menos cara: onde o nome quebra é PREFERÊNCIA; a galeria é o
 * produto. `desenhoDoTitulo` é total — devolve o automático em vez de estourar,
 * aconteça o que acontecer com a entrada.
 */
await etapa("nenhuma entrada esquisita faz o desenho do título estourar", () => {
  /* Títulos que o banco pode ter: galeria antiga com campo nulo, nome de uma
     palavra só, emoji, nome maior que qualquer linha, espaço em branco puro,
     200 caracteres, e um `&` sozinho. */
  const titulos = [
    "", " ", "   \n\t ", "Casamento", "Júlia & Gustavo", "&",
    "Ana", "Ana & ", " & Pedro", "Maria Eduarda & Silva",
    "Supercalifragilisticexpialidocious", "A".repeat(200),
    "💍", "💍 & 🤍", "Ana\u00a0&\u00a0Pedro", "Ana  &   Pedro",
    "Nathalia & Matheus & Família & Amigos & Fornecedores",
    null, undefined, 42, {}, [],
  ];
  const opcoes = ["uma", "duas", "tres", "auto", "quatro", "", null, undefined];
  let contas = 0;
  for (const t of titulos) {
    for (const o of opcoes) {
      const r = desenhoDoTitulo(t, o);
      contas++;
      if (typeof r !== "object" || r === null) throw new Error(`${JSON.stringify(t)}/${o}: ${r}`);
      if (!(typeof r.larguraEm === "number") || !Number.isFinite(r.larguraEm) || r.larguraEm <= 0) {
        throw new Error(`${JSON.stringify(t)}/${o}: larguraEm = ${r.larguraEm}`);
      }
      if (r.linhas !== null) {
        if (!Array.isArray(r.linhas) || r.linhas.length === 0) {
          throw new Error(`${JSON.stringify(t)}/${o}: linhas = ${JSON.stringify(r.linhas)}`);
        }
        if (r.linhas.some((l) => typeof l !== "string")) {
          throw new Error(`${JSON.stringify(t)}/${o}: linha que não é texto`);
        }
      }
    }
  }
  return `${contas} combinações, nenhuma exceção`;
});

await etapa("se a repartição falhar, a capa cai no automático em vez de na tela de erro", () => {
  /* Um título que estoura de propósito: `String(x)` num objeto sem `toString`
     lança, e é o mais perto que dá para chegar de "algo inesperado lá dentro"
     sem mexer no módulo. */
  const veneno = Object.create(null);
  const antes = console.error;
  const ditos = [];
  console.error = (...a) => ditos.push(a.map(String).join(" "));
  try {
    const r = desenhoDoTitulo(veneno, "tres");
    if (r.linhas !== null) throw new Error(`devolveu ${JSON.stringify(r.linhas)} em vez de cair no automático`);
    if (!Number.isFinite(r.larguraEm)) throw new Error(`larguraEm = ${r.larguraEm}`);
    if (!ditos.some((d) => /desenhoDoTitulo falhou/.test(d))) {
      throw new Error("caiu em silêncio — o log do servidor não saberia de nada");
    }
  } finally {
    console.error = antes;
  }
  return "automático + console.error, sem exceção";
});

/*
 * ── A PALAVRA QUE NÃO TEM ONDE QUEBRAR (21/09/2026) ──────────────────────
 *
 * No `auto` quem quebra é o navegador, e ele só quebra nos ESPAÇOS. Título de
 * uma palavra só — um nome composto digitado sem espaço — não tinha onde
 * quebrar: passava da caixa de 22ch e levava a PÁGINA junto. Medido no
 * navegador antes do conserto: 24 de 70 combinações de título × capa × largura
 * davam rolagem horizontal na galeria inteira, e no celular a capa "convite"
 * chegava a 799 px numa tela de 390.
 */
await etapa("palavra maior que a caixa é reconhecida, e nome normal não", () => {
  const naoCabem = [
    "Supercalifragilisticexpialidocious",
    "Pneumonoultramicroscopicsilicovolcanoconiosis",
    "MariaEduardaDeAlbuquerqueSilva",
  ];
  const cabem = ["Júlia & Gustavo", "Nathalia & Matheus", "Ana & Pedro", "Casamento", "", "&", null];
  for (const t of naoCabem) {
    if (!temPalavraQueNaoCabe(t)) throw new Error(`"${t}" devia precisar de quebra`);
  }
  for (const t of cabem) {
    if (temPalavraQueNaoCabe(t)) throw new Error(`${JSON.stringify(t)} NÃO devia precisar de quebra`);
  }
  return `${naoCabem.length} quebram · ${cabem.length} seguem inteiras`;
});

await etapa("só o título com palavra grande ganha a quebra no meio", async () => {
  await db.query("update galerias set titulo = $1 where id = $2", ["MariaEduardaDeAlbuquerqueSilva", g.id]);
  const comQuebra = await tituloCom({ linhasTitulo: "auto" });
  await db.query("update galerias set titulo = $1 where id = $2", [NOME, g.id]);
  const semQuebra = await tituloCom({ linhasTitulo: "auto" });

  if (!/overflow-wrap:\s*break-word/.test(comQuebra)) {
    throw new Error("o nome sem espaço não recebeu a quebra — a página volta a rolar de lado");
  }
  if (/overflow-wrap:\s*break-word/.test(semQuebra)) {
    throw new Error("nome normal recebeu quebra no meio da palavra sem precisar");
  }
  /* `text-balance` e quebra-no-meio não convivem: juntos, o balanceador escolhe
     o mínimo e escreve o nome UMA LETRA POR LINHA. Visto em print. */
  if (/text-balance/.test(comQuebra)) throw new Error("balance + quebra = nome na vertical");
  if (!/text-balance/.test(semQuebra)) throw new Error("o título normal perdeu o balance");
  return "quebra só onde precisa, e sem balance junto";
});

/*
 * ── A CAIXA DE MEDIDA PRECISA TER LARGURA (21/09/2026) ───────────────────
 *
 * O `div` que carrega `container-type: inline-size` é quem define o `100cqw` do
 * teto da fonte. Em capas que centralizam com `items-center` ele é um item
 * flex que se mede pelo CONTEÚDO — e o conteúdo se mede pelo `cqw`. O ciclo
 * fecha, o navegador resolve com zero, e a fonte vira `font-size: 0`.
 *
 * Não é hipótese: medido no navegador, a capa "convite" com "1 linha",
 * "2 linhas" ou "3 linhas" desenhava o título com tamanho ZERO — invisível, em
 * 24 das 224 combinações conferidas. `width: 100%` dá largura definida ao
 * contêiner e desfaz o ciclo, sem mexer em nenhuma outra combinação.
 */
await etapa("a caixa que mede o título tem largura definida", async () => {
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  const caixa = html.match(/<div[^>]*container-type:\s*inline-size[^>]*>/)?.[0];
  if (!caixa) throw new Error("não achei o contêiner de medida do título");
  if (!/width:\s*100%/.test(caixa)) {
    throw new Error("o contêiner voltou a se medir pelo conteúdo — o título some nas capas centralizadas");
  }
  return "container-type + width:100%";
});

/* ── 4. A BARRINHA ───────────────────────────────────────────────────────── */

await etapa("a barrinha multiplica o tamanho da capa", async () => {
  const cem = await tituloCom({ tamanhoTitulo: 100 });
  const cento50 = await tituloCom({ tamanhoTitulo: 150 });
  if (!cem.includes("* 1")) throw new Error(`100% não saiu como fator 1: ${cem}`);
  if (!cento50.includes("* 1.5")) throw new Error(`150% não saiu como fator 1.5: ${cento50}`);
  return "100% → ×1 · 150% → ×1.5";
});

/*
 * O celular deixou de herdar o tamanho do computador. Era `text-4xl sm:text-5xl`
 * — 36 px abaixo de 640 px de tela, um degrau só. Felipe: "na visualização pro
 * celular ficou exageradamente grande, poderia ficar um pouco menor, mas
 * delicado". Com `clamp`, o mínimo é menor que o máximo e o meio é contínuo.
 */
await etapa("o tamanho é contínuo entre celular e computador, não um degrau", async () => {
  const h1 = await tituloCom({});
  const clamp = h1.match(/clamp\(([\d.]+)rem,\s*([\d.]+)vw,\s*([\d.]+)rem\)/);
  if (!clamp) throw new Error(`o font-size não veio em clamp: ${h1}`);
  const [, min, , max] = clamp.map(Number);
  if (!(min < max)) throw new Error(`mínimo ${min}rem não é menor que o máximo ${max}rem`);
  return `${min}rem no celular → ${max}rem no computador`;
});

/* ── A CAPA QUE FICA ────────────────────────────────────────────────────── */

/*
 * Felipe, 16/09/2026: "permitir fixar o título da capa na galeria, ou seja, se
 * for rolando a galeria, o título fica".
 *
 * O efeito é de CSS, e a prova de que funciona foi no navegador: com a capa
 * rolando, o título sai da tela (topo em -796 px depois de rolar 1200);
 * fixa, ele continua em 121 px. O que se guarda aqui é o que o HTML precisa
 * carregar para isso acontecer — e, sobretudo, que o padrão não mudou.
 */
await etapa("a capa fixa gruda no topo", async () => {
  const html = await tituloCom({ capaFixa: "fixa" });
  void html;
  const pagina = await (
    await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })
  ).text();
  const cabecalho = pagina.match(/<header[^>]*data-capa[^>]*>/)?.[0] ?? "";
  if (!/\bsticky\b/.test(cabecalho)) throw new Error(`o cabeçalho veio "${cabecalho.slice(0, 120)}"`);
  return "sticky no cabeçalho";
});

await etapa("a galeria se declara por cima da capa fixa", async () => {
  /* Sem esta camada, a capa grudada apareceria POR TRÁS das fotos e a rolagem
     viraria uma sobreposição de duas imagens. */
  const pagina = await (
    await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })
  ).text();
  const camada = pagina.match(/<div class="relative z-10[^"]*"[^>]*>/)?.[0];
  if (!camada) throw new Error("a camada da galeria perdeu o z-10");
  if (!/background:var\(--g-fundo\)/.test(camada)) throw new Error(`a camada não tem fundo: ${camada}`);
  /* 28/09/2026: o fundo morava na caixa de 1500 px das fotos, e numa tela
     mais larga a capa grudada aparecia pelas laterais — "a foto continuar só
     um pedaço ali". Quem cobre a capa ocupa a largura toda. */
  if (/max-w-/.test(camada)) throw new Error(`a camada que cobre a capa tem largura máxima: ${camada}`);
  return "z-10 sobre a capa, de borda a borda";
});

await etapa('na dividida, "Centralizado" centraliza a coluna inteira — também no computador', async () => {
  /* 28/09/2026, print da galeria da Juliana Josende: a coluna de texto tinha
     `md:text-left` cravado, a caixa do título obedecia ao eixo, e com
     "Centralizado" só o título ia para o meio. */
  const coluna = async (alinhamento) => {
    await tituloCom({ capa: "dividida", alinhamento });
    const pagina = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
    const capa = pagina.match(/<header[^>]*data-capa="dividida"[^]*?<\/header>/)?.[0];
    if (!capa) throw new Error("a bancada não desenhou a capa dividida (sem foto de capa?)");
    return capa.match(/<div class="flex flex-col[^"]*"/)?.[0] ?? "";
  };
  const centro = await coluna("centro");
  if (!/\btext-center\b/.test(centro) || /md:text-left/.test(centro)) throw new Error(`centralizada: ${centro}`);
  const esquerda = await coluna("esquerda");
  if (!/\btext-left\b/.test(esquerda)) throw new Error(`à esquerda: ${esquerda}`);
  return "centro e esquerda valem nas duas larguras";
});

await etapa("o padrão continua sendo a capa que sobe junto", async () => {
  await tituloCom({ capaFixa: "rola" });
  const pagina = await (
    await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })
  ).text();
  const cabecalho = pagina.match(/<header[^>]*data-capa[^>]*>/)?.[0] ?? "";
  if (/\bsticky\b/.test(cabecalho)) throw new Error("grudou sem ninguém pedir");
  if (lerAparencia({}).capaFixa !== "rola") throw new Error("o padrão mudou");
  return "rola, como sempre";
});

/* ── 5. O EIXO SE COMPORTA COMO OS OUTROS ────────────────────────────────── */

await etapa("os dois eixos existem na interface", () => {
  const ids = OPCOES.linhasTitulo.map((o) => o.id);
  for (const esperado of ["auto", "uma", "duas", "tres"]) {
    if (!ids.includes(esperado)) throw new Error(`falta "${esperado}" em OPCOES.linhasTitulo`);
  }
  return ids.join(", ");
});

await etapa("a barrinha é aparada para dentro da faixa", () => {
  for (const [bruto, esperado] of [
    [10, TAMANHO_TITULO.min],
    [900, TAMANHO_TITULO.max],
    ["grande", TAMANHO_TITULO.padrao],
    [null, TAMANHO_TITULO.padrao],
  ]) {
    const a = lerAparencia({ tamanhoTitulo: bruto });
    if (a.tamanhoTitulo !== esperado) {
      throw new Error(`${JSON.stringify(bruto)} virou ${a.tamanhoTitulo}, esperado ${esperado}`);
    }
  }
  return `faixa ${TAMANHO_TITULO.min}–${TAMANHO_TITULO.max}%`;
});

await etapa("a barrinha assenta num passo inteiro, para voltar onde a pessoa soltou", () => {
  const a = lerAparencia({ tamanhoTitulo: 103 });
  if (a.tamanhoTitulo % TAMANHO_TITULO.passo !== 0) {
    throw new Error(`103 virou ${a.tamanhoTitulo}, que não é múltiplo de ${TAMANHO_TITULO.passo}`);
  }
  return `103 → ${a.tamanhoTitulo}`;
});

/* Galeria gravada antes de 16/09/2026 não tem os campos. Ela tem de desenhar
   exatamente o que desenhava: quebra automática e tamanho cheio. */
await etapa("aparência antiga cai no padrão que não muda nada", () => {
  const a = lerAparencia({ capa: "redonda", tema: "claro" });
  if (a.linhasTitulo !== "auto") throw new Error(`linhas caiu em "${a.linhasTitulo}"`);
  if (a.tamanhoTitulo !== 100) throw new Error(`tamanho caiu em ${a.tamanhoTitulo}`);
  return "auto e 100%";
});

await etapa("todo preset declara os dois campos", () => {
  for (const p of PRESETS) {
    if (!p.aparencia.linhasTitulo) throw new Error(`"${p.id}" sem linhasTitulo`);
    if (typeof p.aparencia.tamanhoTitulo !== "number") {
      throw new Error(`"${p.id}" sem tamanhoTitulo`);
    }
  }
  return `${PRESETS.length} presets`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o título da capa tem problema" : "\n✓ título da capa ok");
process.exit(falhou ? 1 : 0);
