#!/usr/bin/env node
/**
 * A LIXEIRA APARECE MESMO VAZIA, E DIZ O QUE GUARDA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-lixeira-visivel.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (29/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe: "não tá aparecendo a LIXEIRA para a usuária storymaker. Ela estava
 * testando, apagou, mas os GB não liberaram. Ela não consegue visualizar a
 * lixeira." E, quando eu respondi que a lixeira estava vazia: "mas tem q
 * permitir o usuário ver a lixeira, por que ela não está vendo a lixeira?".
 *
 * ── O QUE OS DADOS DISSERAM ───────────────────────────────────────────────
 *
 * Na conta dela, em produção: quatro eventos `media.apagada`, nenhum
 * `galeria.apagada`. Ou seja, ela apagou FOTOS — e apagar foto não tem lixeira,
 * de propósito (`apagarMedia`: some na hora, porque quem descarta foto ruim no
 * meio da seleção não quer duzentas descartadas numa lista depois).
 *
 * A lixeira guarda só GALERIA. A dela estava vazia de verdade, e vazia ela não
 * era desenhada — por uma decisão que estava escrita: "uma seção vazia
 * permanente ensinaria o fotógrafo a ignorar aquele canto da tela".
 *
 * O raciocínio tem lógica e o custo apareceu: ela apagou coisas, foi procurar a
 * lixeira, não achou nem a PALAVRA, e concluiu que estava quebrado. O produto
 * não disse nem que ela existe, nem que foto não passa por lá.
 *
 * Então a seção passa a aparecer sempre — e vazia ela explica as duas coisas.
 * O que o comentário antigo temia (virar mobília ignorada) continua endereçado:
 * vazia ela é uma linha de texto, não um bloco com borda e título grande.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

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

const g = await galeriaDaRodada(db, { nome: "lixeira-visivel", medias: 2 });
const cookie = cookieDeSessao(g.tenant_id);
const painel = async () =>
  (await fetch(`${BASE}/painel`, { headers: { cookie }, cache: "no-store" })).text();

const semTags = (h) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

/**
 * O texto DENTRO da seção da lixeira.
 *
 * Procurar a partir da primeira ocorrência da palavra não serve: ela aparece
 * antes, no texto de confirmação do cartão da galeria ("vai para a lixeira,
 * onde fica 30 dias"). Duas etapas deste arquivo passaram por causa disso, em
 * cima do trecho errado — verde sobre coisa nenhuma.
 */
const secaoDaLixeira = (html) => {
  const cabecalho = html.search(/<h[23][^>]*>\s*Lixeira\s*<\/h[23]>/i);
  return cabecalho === -1 ? "" : semTags(html.slice(cabecalho, cabecalho + 700));
};

console.log("A lixeira no painel:\n");

const vazia = await painel();

await etapa("com a lixeira VAZIA, a SEÇÃO aparece mesmo assim", () => {
  /*
   * Procurar a palavra solta não serve: ela já aparecia no texto de confirmação
   * do cartão da galeria ("vai para a lixeira, onde fica 30 dias"), e a primeira
   * versão deste teste passou por causa disso — dizendo verde sobre uma seção
   * que não existia. O que se procura é um CABEÇALHO.
   */
  const cabecalhos = [...vazia.matchAll(/<h[23][^>]*>(.*?)<\/h[23]>/gs)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").trim(),
  );
  if (!cabecalhos.some((t) => /lixeira/i.test(t))) {
    throw new Error(
      `nenhum cabeçalho de Lixeira; achei: ${cabecalhos.join(" | ") || "nenhum"}`,
    );
  }
  return "seção presente";
});

await etapa("vazia, ela diz que guarda GALERIA apagada", () => {
  /*
   * A metade que responde "o que é isso?". Sem ela a seção vazia é um título
   * solto, e o fotógrafo continua sem saber se o que ele apagou deveria estar
   * ali.
   */
  if (!/galeria/i.test(secaoDaLixeira(vazia))) {
    throw new Error("não diz que o que vai para a lixeira é galeria");
  }
  return "explica o que guarda";
});

await etapa("vazia, ela avisa que FOTO apagada não passa por lá", () => {
  /*
   * A metade que responde "cadê o que eu apaguei?". É a frase que faltava na
   * conta da storymaker: ela apagou quatro fotos e foi procurá-las na lixeira.
   * Apagar foto é irreversível — dizer isso onde a pessoa procura é o mínimo.
   */
  if (!/foto/i.test(secaoDaLixeira(vazia))) {
    throw new Error("não avisa que foto apagada de dentro da galeria não vem para cá");
  }
  return "avisa sobre as fotos";
});

await etapa("com galeria na lixeira, ela lista o que está lá", async () => {
  await db.query(
    "update galerias set estado = 'lixeira', apagada_em = now() where id = $1",
    [g.id],
  );
  const cheia = await painel();
  if (!cheia.includes(g.titulo)) {
    throw new Error("a galeria apagada não aparece na lixeira");
  }
  /* E o prazo, que é a informação que decide se dá tempo de voltar atrás. */
  if (!/\bdias?\b/i.test(secaoDaLixeira(cheia))) {
    throw new Error("não diz por quantos dias a galeria fica guardada");
  }
  return "lista e diz o prazo";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a lixeira não se explica" : "\n✓ lixeira visível e explicada");
process.exitCode = falhou ? 1 : 0;
