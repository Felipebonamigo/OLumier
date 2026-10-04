#!/usr/bin/env node
/**
 * OS BOTÕES DA GALERIA RESPONDEM, E O QUE SOBRA EM CIMA DA FOTO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-botoes-da-galeria.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── OS TRÊS PEDIDOS (03/10/2026, Felipe, com o print da galeria da Sirius) ──
 *
 * 1. "Esse botão não tem nenhuma ação, tem que ter um hover ou algo assim
 *    (Deixe um recado), e o mesmo para o pop up dele."
 *
 *    Era verdade e era defeito: os botões do fim da galeria e a tela do recado
 *    tinham `transition` e NENHUM estado de hover. A cor deles vem de variável
 *    CSS no `style` inline, e `transition` sozinho não transiciona coisa
 *    nenhuma — não havia o que mudar.
 *
 * 2. "Também não achei o botão de 'voltar ao início' para a galeria, que fica
 *    ruim de voltar tudo no scroll."
 *
 *    Ele existia e nascia desligado — mas o defeito maior é que, mesmo ligado,
 *    ele morava no RODAPÉ. Um botão para subir que só aparece depois de descer
 *    tudo não resolve o problema de quem está no meio de 600 fotos. Agora ele
 *    flutua durante a rolagem.
 *
 * 3. "No celular, permita ocultar os botões de download e favorito, para não
 *    estragar a imagem."
 *
 *    O download já saía do celular desde 08/09/2026 (o print anterior dele, com
 *    a mesma queixa). O que sobrava era o coração, em toda miniatura. Virou
 *    escolha — e a saída continua existindo: abrir a foto tem "Escolher"
 *    escrito por extenso, ao lado de "Baixar".
 *
 * ── POR QUE PARTE DISTO SE CONFERE NO JAVASCRIPT DA PÁGINA ─────────────────
 *
 * A tela do recado só existe depois de um clique, então ela não está no HTML
 * que o servidor manda. Procurar os botões dela ali daria verde para sempre,
 * com ou sem conserto. O que se confere, então, é o código que a página
 * CARREGA — é o mesmo caminho que `testar-despedida-da-galeria.mjs` usa para
 * as abas fechadas do painel, e prova o que importa: que o estado de hover foi
 * para o navegador de quem abre a galeria.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
};
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

/* O HTML sem os `<script>`: só o que o casal vê desenhado. */
const desenhado = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "");

const g = await galeriaDaRodada(db, { nome: "botoes", medias: 4 });
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);
const url = `${BASE}/g/${g.tslug}/${g.gslug}`;

const BASE_AP = { capa: "minima", tema: "claro", grade: "colunas", densidade: "normal" };
const comAparencia = async (extra) => {
  await db.query("update galerias set aparencia = $1 where id = $2", [
    JSON.stringify({ ...BASE_AP, ...extra }),
    g.id,
  ]);
  return (await fetch(url, { cache: "no-store" })).text();
};

/** O `<button>` inteiro que contém este texto, com todos os atributos. */
function botaoCom(html, texto) {
  const i = html.indexOf(texto);
  if (i === -1) throw new Error(`não achei "${texto}" na página`);
  const abre = html.lastIndexOf("<button", i);
  if (abre === -1) throw new Error(`"${texto}" não está dentro de um <button>`);
  return html.slice(abre, html.indexOf("</button>", i) + 9);
}

/** Este trecho de marcação reage ao ponteiro? */
const respondeAoPonteiro = (trecho) => /hover:/.test(trecho);

/*
 * ── MEDIR BOTÃO QUE SÓ EXISTE DEPOIS DO CLIQUE (03/10/2026) ──────────────
 *
 * A tela do recado não está no HTML: ela nasce quando a pessoa clica. O que
 * dá para conferir é o código que a página carrega — e aí mora uma armadilha
 * que já deu dois resultados falsos nesta mesma rodada:
 *
 *  1. `indexOf("Fechar")` acha o PRIMEIRO "Fechar" do pacote, que é um
 *     comentário de outro arquivo. O teste passava a medir o lugar errado.
 *  2. a classe do botão pode ser um template que cita um const
 *     (`className: \`px-5 ${RESPONDE}\``). Procurar "hover:" perto do
 *     rótulo não encontra nada, porque ali está o NOME da variável.
 *
 * Então: primeiro recorta o módulo do componente, depois recorta o elemento
 * do botão, e só então resolve o const. Isso separa "a classe chega NESTE
 * botão" de "a palavra hover existe em algum lugar do arquivo".
 */
async function codigoDaPagina(html) {
  const chunks = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  if (chunks.length === 0) throw new Error("a galeria não trouxe nenhum script");
  return (
    await Promise.all(
      chunks.map(async (src) => {
        const r = await fetch(src.startsWith("http") ? src : `${BASE}${src}`, { cache: "no-store" });
        return r.ok ? r.text() : "";
      }),
    )
  ).join(";");
}

/** Só o pedaço do pacote que veio de um arquivo nosso. */
function moduloDe(codigo, arquivo) {
  const marca = `fileName: "[project]/src/components/${arquivo}"`;
  const onde = [];
  for (let i = codigo.indexOf(marca); i !== -1; i = codigo.indexOf(marca, i + 1)) onde.push(i);
  if (onde.length === 0) throw new Error(`${arquivo} não está no código que a página carrega`);
  return codigo.slice(onde[0], onde[onde.length - 1]);
}

/** O elemento `button` inteiro que contém esta marca, no código compilado. */
function elementoDoBotao(modulo, marca) {
  const i = modulo.indexOf(marca);
  if (i === -1) throw new Error(`não achei ${JSON.stringify(marca)} no módulo`);
  const abre = modulo.lastIndexOf('"button", {', i);
  if (abre === -1) throw new Error(`${JSON.stringify(marca)} não está dentro de um button`);
  /* O fim do elemento: o `}, void 0` que o jsxDEV sempre deixa depois dele.
     Sem esse corte, o teste leria a classe do botão SEGUINTE. */
  const fecha = modulo.indexOf("}, void 0", i);
  return modulo.slice(abre, fecha === -1 ? modulo.length : fecha);
}

/** As classes desse botão, com `${CONST}` já substituído pelo valor. */
function classesDoBotao(codigo, modulo, marca) {
  const elemento = elementoDoBotao(modulo, marca);
  const achou = elemento.match(/className: (`[^`]*`|"[^"]*")/);
  if (!achou) return "";
  return achou[1].slice(1, -1).replace(/[$][{](\w+)[}]/g, (_, nome) => {
    /* O const mora no topo do módulo e pode ser várias linhas somadas. */
    const def = codigo.match(new RegExp(`const ${nome} =([^;]*);`));
    return def ? def[1] : "";
  });
}

console.log("Os botões da galeria:\n");

/* ── 1. RESPOSTA AO PONTEIRO ────────────────────────────────────────────── */

await etapa("o botão do recado no fim da galeria responde ao ponteiro", async () => {
  await db.query("update galerias set recado_ativo = true where id = $1", [g.id]);
  const html = desenhado(await comAparencia({}));
  const botao = botaoCom(html, "Deixar um recado");
  if (!respondeAoPonteiro(botao)) {
    throw new Error("o botão não muda nada no hover — é a queixa do Felipe");
  }
  /* `transition` sozinho não é resposta: era exatamente o que havia antes. */
  if (!/transition/.test(botao)) throw new Error("sem transição, o hover pisca");
  return "hover + transição";
});

await etapa("a tela do recado também responde — ela não está no HTML, está no código", async () => {
  const codigo = await codigoDaPagina(await comAparencia({}));
  const modulo = moduloDe(codigo, "recado-na-galeria.tsx");

  /* Os três botões que o Felipe vai tocar nessa tela. */
  for (const [oque, marca] of [
    ["o botão de enviar", 'children: ocupado ? "enviando…" : "Enviar recado"'],
    ["o de desistir", 'children: "Agora não"'],
    ["o de fechar", 'children: "Fechar"'],
  ]) {
    if (!respondeAoPonteiro(classesDoBotao(codigo, modulo, marca))) {
      throw new Error(`${oque} não tem resposta ao ponteiro`);
    }
  }
  return "enviar, desistir e fechar";
});

await etapa("as estrelas reagem antes de serem clicadas", async () => {
  /* Dar nota é a parte que se faz com o dedo parado em cima, decidindo. Sem
     resposta ao ponteiro não dá para saber qual estrela vai ser marcada. */
  const codigo = await codigoDaPagina(await comAparencia({}));
  const modulo = moduloDe(codigo, "recado-na-galeria.tsx");
  /* A estrela se identifica pelo rótulo "N de 5" — e aqui a classe vem DEPOIS
     da marca, não antes: era por isso que uma janela só para trás não achava. */
  if (!respondeAoPonteiro(classesDoBotao(codigo, modulo, "de 5"))) {
    throw new Error("as estrelas não reagem ao ponteiro");
  }
  return "estrelas";
});

/* ── 2. VOLTAR AO INÍCIO, DURANTE A ROLAGEM ─────────────────────────────── */

await etapa("desligado, não existe botão de voltar", async () => {
  const html = desenhado(await comAparencia({ voltarAoInicio: "nao" }));
  if (/[Vv]olte ao in[íi]cio/.test(html)) {
    throw new Error("apareceu sem ninguém ligar — galeria entregue não muda");
  }
  return "sem botão";
});

await etapa("ligado, ele existe e FLUTUA — não mora no rodapé", async () => {
  /*
   * O defeito que esta etapa prende: o botão existia e ficava no fim da
   * página. "Voltar ao início" alcançável só depois de rolar até o fim é o
   * oposto do que ele serve.
   *
   * `fixed` é o que o diferencia: ele acompanha a tela. E ele nasce no HTML,
   * escondido, em vez de aparecer só quando o JavaScript roda — assim o
   * primeiro toque de quem rolou rápido não espera hidratação nenhuma.
   */
  const html = desenhado(await comAparencia({ voltarAoInicio: "sim" }));
  const botao = botaoCom(html, "Volte ao início");
  if (!/\bfixed\b/.test(botao)) {
    throw new Error("o botão não flutua — continua preso no fim da página");
  }
  if (!respondeAoPonteiro(botao)) throw new Error("e não responde ao ponteiro");
  return "flutuante";
});

await etapa("ele não tapa a tela de quem está no topo", async () => {
  /* Flutuar não pode virar um botão permanente em cima da capa: ele só tem
     sentido depois de a pessoa ter descido. Fora da vista, ele também não pode
     roubar o toque. */
  const html = desenhado(await comAparencia({ voltarAoInicio: "sim" }));
  const botao = botaoCom(html, "Volte ao início");
  if (!/opacity-0/.test(botao)) throw new Error("nasce visível, em cima da capa");
  if (!/pointer-events-none/.test(botao)) {
    throw new Error("invisível mas ainda clicável — rouba o toque de quem não o vê");
  }
  return "invisível e intocável no topo";
});

/* ── 3. OS GLIFOS SOBRE A FOTO, NO CELULAR ──────────────────────────────── */

/**
 * Os controles DESENHADOS SOBRE A FOTO, pelo que eles têm em comum.
 *
 * Na primeira rodada esta conferência procurava por `aria-label`, e passou
 * verde antes de existir conserto nenhum: o rótulo do coração é o NOME DA FOTO
 * (ou "Marcar … como favorita"), nunca "Escolher" — então ela só achava os
 * botões de baixar, que já saíam do celular desde 08/09/2026. Media a metade
 * que já estava pronta.
 *
 * `data-sobre-a-foto` é o contrato: todo controle que o produto desenhar em
 * cima da imagem carrega essa marca, e é ela que esta regra desliga no celular.
 * Um terceiro botão que nasça amanhã sem ela reprova aqui.
 */
const sobreAFoto = (html) => [...html.matchAll(/<button[^>]*data-sobre-a-foto[^>]*>/g)].map((m) => m[0]);

await etapa("por padrão, o coração continua no celular — galeria entregue não muda", async () => {
  const html = desenhado(await comAparencia({}));
  const botoes = sobreAFoto(html);
  if (botoes.length === 0) throw new Error("não achei controle nenhum sobre a foto");
  /* O download JÁ sai do celular desde 08/09 e continua saindo; o coração, não.
     Se os dois saíssem agora, a galeria de alguém teria mudado sozinha. */
  const ficam = botoes.filter((b) => !/max-\[900px\]:hidden/.test(b));
  if (ficam.length === 0) {
    throw new Error("TODO controle sumiu do celular sem ninguém pedir");
  }
  return `${ficam.length} de ${botoes.length} continuam no celular`;
});

await etapa("escolhido 'só no computador', o celular fica sem glifo nenhum", async () => {
  const html = desenhado(await comAparencia({ glifosNaFoto: "computador" }));
  const botoes = sobreAFoto(html);
  if (botoes.length === 0) throw new Error("não achei controle nenhum sobre a foto");
  for (const botao of botoes) {
    if (!/max-\[900px\]:hidden/.test(botao)) {
      throw new Error(`um controle continua no celular: ${botao.slice(0, 100)}`);
    }
  }
  return `${botoes.length} controles fora do celular`;
});

await etapa("e a saída continua existindo — abrir a foto ainda deixa escolher", async () => {
  /*
   * A regra que o download já seguia em 08/09: "sai do card, não do produto".
   * Sem esta etapa, esconder o coração viraria tirar o favoritar do celular —
   * e o fotógrafo descobriria pelo casal.
   */
  const bruto = await comAparencia({ glifosNaFoto: "computador" });
  if (!/Escolher|Baixar/.test(bruto)) {
    throw new Error("o visualizador perdeu os comandos junto com os glifos");
  }
  return "o visualizador continua inteiro";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ os botões da galeria não fecham" : "\n✓ os botões da galeria ok");
process.exitCode = falhou ? 1 : 0;
