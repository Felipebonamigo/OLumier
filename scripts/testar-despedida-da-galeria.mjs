#!/usr/bin/env node
/**
 * A DESPEDIDA NO FIM DA GALERIA, E A VOLTA AO INÍCIO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-despedida-da-galeria.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── OS DOIS PEDIDOS (01/10/2026) ──────────────────────────────────────────
 *
 * Juan: "no final da galeria uma frase editável, por exemplo 'obrigado por
 * escolher o nosso olhar para esse dia inesquecível' — algo onde consiga editar
 * com a frase que queremos e fonte. Acho que vai mostrar um cuidado a mais."
 * Felipe: "isso eu acho bom".
 *
 * E: "no fim da galeria ter um botão 'volte ao início'". Felipe: "esse tb".
 * Juan: "eu não colocaria, mas entendo quem goste" — e é por isso que ele é
 * uma ESCOLHA, e não uma decisão nossa sobre a galeria de todo mundo.
 *
 * ── POR QUE NÃO HÁ MIGRAÇÃO ───────────────────────────────────────────────
 *
 * `galerias.aparencia` é jsonb e já guarda texto livre do fotógrafo: o `rotulo`
 * da capa e o nome do grupo das fotos soltas. A despedida é a mesma natureza —
 * texto que ele escreve e o casal lê —, então entra pelo mesmo caminho, com o
 * mesmo teto e a mesma aparagem. `lerAparencia` valida campo a campo, então
 * galeria antiga (sem o campo) continua desenhando como antes.
 *
 * ── A FONTE, SEM EIXO NOVO ────────────────────────────────────────────────
 *
 * Ele pediu para escolher a fonte. O produto já tem duas famílias escolhidas na
 * galeria — a do título e a do texto — e um eixo que escolhe entre elas para as
 * letrinhas da capa (`fonteDetalhe`). A despedida usa a mesma forma: ou a do
 * nome do casal, ou a do corpo. Uma terceira fonte só para uma frase seria um
 * eixo novo para ninguém.
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

const g = await galeriaDaRodada(db, { nome: "despedida", medias: 4 });
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);
const url = `${BASE}/g/${g.tslug}/${g.gslug}`;

const BASE_AP = { capa: "minima", tema: "claro", tipografia: "bodoni", grade: "colunas" };
/*
 * O HTML SEM OS SCRIPTS — e é a diferença entre medir e se enganar.
 *
 * A página manda duas cópias de tudo: a marcação desenhada e a carga do React
 * (os `self.__next_f.push`), que leva as props do componente — `aparencia`
 * inteira, com a despedida dentro, e a lista das fotos. Na primeira rodada
 * deste arquivo o teste "a despedida vem depois das fotos" acusou o código por
 * causa dessa segunda cópia: a última menção da foto estava na carga, no fim do
 * documento, depois da frase desenhada no meio. E o teste da fonte PASSOU por
 * sorte, achando "bodoni" na carga e não no `font-family` da frase.
 *
 * Tirar os `<script>` deixa só o que o casal vê.
 */
const desenhado = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "");

const comAparencia = async (extra) => {
  await db.query("update galerias set aparencia = $1 where id = $2", [
    JSON.stringify({ ...BASE_AP, ...extra }),
    g.id,
  ]);
  return desenhado(await (await fetch(url, { cache: "no-store" })).text());
};

const FRASE = "Obrigado por escolher o nosso olhar para esse dia inesquecível";

console.log("O fim da galeria:\n");

await etapa("sem despedida, nada aparece — galeria entregue não muda", async () => {
  const html = await comAparencia({});
  if (html.includes(FRASE)) throw new Error("apareceu uma despedida que ninguém escreveu");
  /* E o botão também não: quem não ligou não ganha nada novo no fim. */
  if (/volt[ae] ao in[íi]cio/i.test(html)) {
    throw new Error("o botão de voltar apareceu sem ninguém pedir");
  }
  return "fim limpo";
});

await etapa("com a frase escrita, ela aparece no fim", async () => {
  const html = await comAparencia({ despedida: FRASE });
  if (!html.includes(FRASE)) throw new Error("a despedida não saiu na página");
  return "aparece";
});

await etapa("a despedida vem DEPOIS das fotos, não antes", async () => {
  /*
   * É uma despedida: antes das fotos ela seria um aviso. A conferência é por
   * posição no documento — a última foto tem de vir antes dela.
   */
  const html = await comAparencia({ despedida: FRASE });
  const ultimaFoto = html.lastIndexOf("despedida-3.jpg");
  const frase = html.indexOf(FRASE);
  if (ultimaFoto === -1) throw new Error("não achei a última foto na página");
  if (frase < ultimaFoto) throw new Error("a despedida veio antes das fotos");
  return "depois das fotos";
});

await etapa("a despedida sai na fonte escolhida", async () => {
  const comTitulo = await comAparencia({ despedida: FRASE, despedidaFonte: "titulo" });
  const comTexto = await comAparencia({ despedida: FRASE, despedidaFonte: "texto" });
  const trecho = (html) => {
    const i = html.indexOf(FRASE);
    return i === -1 ? "" : html.slice(Math.max(0, i - 300), i);
  };
  const a = trecho(comTitulo);
  const b = trecho(comTexto);
  if (!a || !b) throw new Error("não achei a despedida nos dois");
  if (a === b) throw new Error("as duas fontes desenham igual — o eixo é enfeite");
  if (!/[Bb]odoni/.test(a)) throw new Error("a opção 'título' não usou a fonte do título");
  return "título ≠ texto";
});

await etapa("o botão de voltar ao início só aparece quando ligado", async () => {
  const ligado = await comAparencia({ voltarAoInicio: "sim" });
  if (!/volt[ae] ao in[íi]cio/i.test(ligado)) throw new Error("liguei e não apareceu");
  const desligado = await comAparencia({ voltarAoInicio: "nao" });
  if (/volt[ae] ao in[íi]cio/i.test(desligado)) throw new Error("desliguei e continuou lá");
  return "liga e desliga";
});

await etapa("texto comprido é aparado, como o rótulo", async () => {
  /*
   * Teto pela mesma razão do `rotulo`: é texto livre que vai para a tela do
   * casal, e um parágrafo inteiro no fim da galeria vira outra coisa. Aparar é
   * melhor do que recusar — quem colou demais não perde o que escreveu.
   */
  /* O teto é 160 (`textoLivre(o.despedida, 160)`), e a conferência tem de ser
     NESSE número: medir "menos de 300" deixava passar um teto de 280, que é
     exatamente o parágrafo no fim da galeria que esta etapa diz querer evitar. */
  const TETO = 160;
  const comprido = "x".repeat(TETO + 240);
  const html = await comAparencia({ despedida: comprido });
  const maior = (html.match(/x{20,}/g) ?? []).reduce((n, t) => Math.max(n, t.length), 0);
  if (maior === 0) throw new Error("a frase comprida não saiu na página");
  if (maior > TETO) throw new Error(`não aparou no teto: saíram ${maior} caracteres`);
  return `aparado em ${maior}`;
});

await etapa("HTML na frase não vira marcação", async () => {
  /*
   * O texto é do fotógrafo, mas quem lê é o casal — e um dia alguém cola algo
   * de um editor. O React escapa por padrão; isto prende o padrão.
   */
  const html = await comAparencia({ despedida: '<img src=x onerror="alert(1)">' });
  if (/<img src=x onerror=/.test(html)) throw new Error("a frase virou marcação de verdade");
  return "escapado";
});

await etapa("o fotógrafo acha os controles no Design", async () => {
  /*
   * O eixo existir no banco não serve se ninguém consegue ligá-lo: este passo é
   * o que separa "implementado" de "entregue".
   *
   * Por que o teste desce até o JAVASCRIPT da página: os controles do Design
   * moram atrás de abas (`grupo === "fim"`), e aba fechada não existe no HTML
   * que o servidor manda — procurar a caixa da frase ali daria vermelho para
   * sempre, mesmo com o controle pronto. Então a conferência é em duas partes:
   * a ABA aparece no HTML, e os três controles aparecem no código que a página
   * carrega. Não é clicar com o dedo, mas prova o que importa — que eles foram
   * para o navegador de quem abre essa tela.
   */
  const r = await fetch(`${BASE}/painel/galerias/${g.id}/design`, {
    headers: { cookie: cookieDeSessao(g.estudio.id) },
    cache: "no-store",
  });
  if (r.status !== 200) throw new Error(`a aba Design respondeu ${r.status}`);
  const html = await r.text();
  if (!/>Fim</.test(desenhado(html))) throw new Error("não achei a aba Fim no Design");

  const chunks = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  if (chunks.length === 0) throw new Error("a página do Design não trouxe nenhum script");
  const codigo = (
    await Promise.all(
      chunks.map(async (src) => {
        const u = src.startsWith("http") ? src : `${BASE}${src}`;
        const resp = await fetch(u, { cache: "no-store" });
        return resp.ok ? resp.text() : "";
      }),
    )
  ).join(";");

  for (const [oque, acha] of [
    ["a caixa da frase", /Frase de despedida/],
    ["a escolha da fonte", /Fonte da despedida/],
    ["o botão de voltar", /Volte ao in[íi]cio/],
  ]) {
    if (!acha.test(codigo)) throw new Error(`não achei ${oque} no código do Design`);
  }
  return `aba Fim + 3 controles em ${chunks.length} scripts`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o fim da galeria não fecha" : "\n✓ despedida e volta ao início ok");
process.exitCode = falhou ? 1 : 0;
