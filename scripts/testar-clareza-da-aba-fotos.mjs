#!/usr/bin/env node
/**
 * A ABA FOTOS DIZ O QUE CADA PEDAÇO DELA É. Uso:
 *   node --env-file=.env.local scripts/testar-clareza-da-aba-fotos.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── OS PEDIDOS (29/09/2026) ───────────────────────────────────────────────
 *
 * Juan Sirius, olhando a tela: "Poderia estar mais claro a parte de enviar as
 * fotos" e, logo depois, "na parte de subir as fotos, deixar mais evidente que
 * é uma seção de UPLOAD".
 *
 * Ele está certo e dá para ver no HTML: o bloco dos capítulos é um cartão com
 * `<h2>` e subtítulo, e o bloco de envio começava direto no seletor de capítulo,
 * sem título nenhum. Quem varre a página não encontra uma seção que não se
 * apresenta — só encontra uma caixa tracejada solta no meio do branco.
 *
 * No mesmo dia: "menor o botão de 'criar os capítulos de um casamento', porque
 * vi que clicaram errado e criaram vários capítulos sem querer". Um clique
 * criava SEIS capítulos, sem confirmação e sem desfazer; para voltar atrás a
 * pessoa apagava seis à mão.
 *
 * Felipe decidiu o remédio: "não crie todos os capítulos de uma vez, deixe o
 * usuário criar, se não ele precisará apagar" e "ou tenha a opção de apagar
 * todos os capítulos". Os dois: a criação em lote sai (o estrago de um clique
 * errado passa a ser UM capítulo vazio), e quem já tem seis criados sem querer
 * ganha a saída.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

await exigirBancoDeTeste();

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

const g = await galeriaDaRodada(db, { nome: "clareza-aba-fotos", medias: 2 });
const cookie = cookieDeSessao(g.tenant_id);

const abaFotos = async () => {
  const r = await fetch(`${BASE}/painel/galerias/${g.id}/fotos`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`a aba fotos respondeu ${r.status}`);
  return r.text();
};

/** O texto que o fotógrafo lê, sem as etiquetas nem os atributos. */
const semTags = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

console.log("A aba Fotos, sem capítulo nenhum:\n");

const vazia = await abaFotos();

await etapa("a área de envio existe nesta bancada", () => {
  /* Se o e-mail estivesse pendente, a área de envio nem apareceria (ver o
     comentário de `emailPendente` na página) e todo o resto deste arquivo
     estaria medindo a tela errada. */
  if (!/Arraste a pasta do casamento aqui/.test(vazia)) {
    throw new Error("a caixa de arrastar não está na página — bancada errada");
  }
  return "caixa de arrastar presente";
});

await etapa("a seção de envio se apresenta com título próprio", () => {
  /*
   * O pedido do Juan, medido onde ele olhou: um `<h2>` que diga que dali para
   * baixo é envio. Não basta a caixa tracejada dizer "Arraste a pasta" — isso
   * é a instrução do gesto, não o nome da seção.
   */
  const titulos = [...vazia.matchAll(/<h2[^>]*>(.*?)<\/h2>/gs)].map((m) => semTags(m[1]).trim());
  const deEnvio = titulos.filter((t) => /^Enviar\b/i.test(t));
  if (deEnvio.length === 0) {
    throw new Error(`nenhum <h2> nomeia o envio; achei: ${titulos.join(" | ") || "nenhum"}`);
  }
  /* E ele vem ANTES da caixa de arrastar, senão é título de outra coisa. */
  const ondeTitulo = vazia.indexOf(deEnvio[0]);
  const ondeCaixa = vazia.indexOf("Arraste a pasta do casamento aqui");
  if (ondeTitulo === -1 || ondeTitulo > ondeCaixa) {
    throw new Error("o título aparece depois da caixa de arrastar");
  }
  return deEnvio[0];
});

await etapa("nenhum botão cria os seis capítulos de uma vez", () => {
  if (/Criar os capítulos de um casamento/.test(vazia)) {
    throw new Error("o botão de criar tudo de uma vez continua na tela");
  }
  return "a criação em lote saiu";
});

await etapa("os capítulos sugeridos são clicáveis, um a um", () => {
  /*
   * Os seis nomes já estavam na tela antes — como texto morto embaixo do botão
   * ("Making Of · Cerimônia · …"). Texto não cria capítulo; o que criava era o
   * botão que saiu. Cada nome vira um alvo de clique próprio, e o pior estrago
   * de um clique errado passa a ser UM capítulo vazio.
   */
  const botoes = [...vazia.matchAll(/<button[^>]*>(.*?)<\/button>/gs)].map((m) =>
    semTags(m[1]).trim(),
  );
  const esperados = ["Making Of", "Cerimônia", "Decoração", "Recepção", "Festa", "Ensaio"];
  const faltando = esperados.filter((n) => !botoes.some((b) => b === n || b === `+ ${n}`));
  if (faltando.length) {
    throw new Error(`sem botão próprio para: ${faltando.join(", ")}`);
  }
  return `${esperados.length} sugestões clicáveis`;
});

console.log("\nA mesma aba, com capítulos criados:\n");

/* Dois capítulos à mão — é o estado de quem clicou errado e quer voltar atrás. */
for (const [i, nome] of ["Cerimônia", "Festa"].entries()) {
  await db.query(
    "insert into secoes (galeria_id, nome, slug, ordem) values ($1, $2, $3, $4)",
    [g.id, nome, `cap-teste-${i}`, i],
  );
}

const comCapitulos = await abaFotos();

await etapa("dá para apagar todos os capítulos de uma vez", () => {
  /*
   * A saída que o Felipe pediu para quem já criou os seis sem querer. Apagar
   * capítulo NÃO apaga foto — as fotos voltam para "sem capítulo" —, e é por
   * isso que esta porta pode existir sem ser perda de dado.
   */
  const texto = semTags(comCapitulos);
  if (!/apagar todos os cap[ií]tulos/i.test(texto)) {
    throw new Error("não há como apagar os capítulos de uma vez");
  }
  return "porta de saída presente";
});

await etapa("apagar todos pede confirmação antes", async () => {
  /*
   * Um clique que apaga a organização inteira não pode ser o mesmo tipo de
   * clique que criava seis capítulos sem querer — seria trocar um acidente por
   * outro maior, porque capítulo criado sem querer nasce vazio e capítulo
   * apagado sem querer pode estar cheio.
   *
   * ── POR QUE ISTO NÃO É LIDO NO HTML ───────────────────────────────────
   *
   * O segundo tempo mora em estado do cliente (`confirmandoTudo`), então ele
   * NÃO aparece no HTML da primeira resposta — e um teste que procurasse a
   * frase ali ficaria vermelho com o código certo. Quem tem a frase é o pacote
   * de JavaScript que a página manda para o navegador: se ela está lá, o
   * segundo tempo foi entregue; se não está, o botão virou clique único.
   *
   * O primeiro tempo dá para conferir aqui mesmo: o controle visível é um
   * `<button type="button">`, e não um `<form>` que dispara a ação direto.
   */
  const gatilho = comCapitulos.match(
    /<button[^>]*>\s*apagar todos os cap[ií]tulos\s*<\/button>/i,
  )?.[0];
  if (!gatilho) throw new Error("o controle não é um <button> — pode estar submetendo direto");
  if (!/type="button"/.test(gatilho)) {
    throw new Error("o botão não é type=\"button\" — dentro de <form> ele submeteria");
  }

  const chunks = [...comCapitulos.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  if (chunks.length === 0) throw new Error("a página não carregou pacote de JavaScript nenhum");
  let achou = false;
  for (const src of chunks) {
    const js = await (await fetch(new URL(src, BASE), { cache: "no-store" })).text();
    /* A frase que o segundo tempo mostra: quantos são e para onde as fotos vão. */
    if (/voltam para/.test(js) && /Apagar todos/.test(js)) {
      achou = true;
      break;
    }
  }
  if (!achou) {
    throw new Error("o segundo tempo não foi entregue ao navegador — o clique apaga direto");
  }
  return `confirmação no pacote (${chunks.length} scripts varridos)`;
});

await etapa("a sugestão já criada sai da lista", () => {
  const botoes = [...comCapitulos.matchAll(/<button[^>]*>(.*?)<\/button>/gs)].map((m) =>
    semTags(m[1]).trim(),
  );
  /* "Cerimônia" existe como capítulo agora: oferecer criar de novo é oferecer
     um erro — `criarSecao` recusa repetido e devolve mensagem. */
  const sugestoes = botoes.filter((b) => b === "Cerimônia" || b === "+ Cerimônia");
  if (sugestoes.length) {
    throw new Error("“Cerimônia” continua sendo oferecida como sugestão");
  }
  return "sobraram só as que faltam";
});

await etapa("a caixa dos capítulos continua sem borda tracejada", () => {
  /*
   * Regra de 16/09/2026, e ela não pode cair por tabela nesta mudança: Felipe
   * tentou soltar fotos na caixa dos capítulos porque ela era tracejada igual à
   * de envio. TRACEJADA É EXCLUSIVA DE ALVO DE ARRASTO.
   */
  /* Os DOIS estados: a caixa de vazio dos capítulos só existe sem capítulo, e
     a tela com capítulo ganhou cartão novo em volta do envio. Contar num só
     deixaria metade da regra sem guarda. */
  for (const [estado, html] of [
    ["sem capítulo", vazia],
    ["com capítulos", comCapitulos],
  ]) {
    const tracejadas = [...html.matchAll(/class="([^"]*border-dashed[^"]*)"/g)].map((m) => m[1]);
    if (tracejadas.length === 0) {
      throw new Error(`${estado}: sumiu a tracejada do alvo de arrasto`);
    }
    if (tracejadas.length > 1) {
      throw new Error(
        `${estado}: ${tracejadas.length} caixas tracejadas — só o alvo de arrasto pode ser`,
      );
    }
  }
  return "uma só em cada estado, a de arrastar";
});

await etapa("a seção de envio tem nome acessível", () => {
  /*
   * `<section>` sem nome acessível não é landmark nenhuma: quem navega por
   * marcos não encontra o envio, e "deixar mais evidente que é uma seção de
   * upload" fica valendo só para quem enxerga.
   */
  const secao = comCapitulos.match(/<section[^>]*aria-labelledby="([^"]+)"[^>]*>/);
  if (!secao) throw new Error("nenhuma <section> aponta para um título com aria-labelledby");
  if (!new RegExp(`<h2[^>]*id="${secao[1]}"`).test(comCapitulos)) {
    throw new Error(`o aria-labelledby aponta para "${secao[1]}", que não existe na página`);
  }
  return `aria-labelledby="${secao[1]}"`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a aba fotos não se explica" : "\n✓ clareza da aba fotos ok");
process.exit(falhou ? 1 : 0);
