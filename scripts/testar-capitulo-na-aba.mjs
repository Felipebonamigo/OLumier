#!/usr/bin/env node
/**
 * A ABA DO NAVEGADOR DIZ EM QUE CAPÍTULO A PESSOA ESTÁ. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-capitulo-na-aba.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (01/10/2026) ─────────────────────────────────────────────────
 *
 * Juan: "verificar na galeria que, ao ir para o próximo capítulo, não muda em
 * cima o nome da aba — se está vendo a parte da recepção e vai para festa, ele
 * deveria mudar lá em cima".
 *
 * Estava certo, e o motivo estava escrito no código. A rota do capítulo
 * (`[capitulo]/page.tsx`) chama a metadata da galeria passando
 * `searchParams: {}` DE PROPÓSITO, com a justificativa: "o cartão e o título
 * são os da GALERIA — é ela que a pessoa está compartilhando, e o capítulo é
 * onde ela abriu".
 *
 * ── A JUSTIFICATIVA VALIA PARA METADE ────────────────────────────────────
 *
 * Para o CARTÃO, ela está certa e continua valendo: quando o casal manda o link
 * no WhatsApp, o cartão tem de dizer o casamento, não "Festa". Ninguém
 * compartilha um capítulo achando que está compartilhando um capítulo.
 *
 * Para a ABA, não. O título da aba não é o que se compartilha: é a orientação
 * de quem está lendo AGORA, e é o que aparece quando a pessoa tem seis abas
 * abertas. Ali o capítulo é a informação mais útil que existe.
 *
 * As duas coisas saíam da mesma função, e por isso andavam juntas. Agora o
 * capítulo entra no `<title>` e fica fora do cartão — e as duas metades estão
 * presas aqui, porque separá-las é o tipo de coisa que a próxima sessão
 * reunifica "arrumando".
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

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

const g = await galeriaDaRodada(db, { nome: "cap-na-aba", medias: 6, titulo: "Laísa & Davi" });
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);

const ids = [];
for (const [i, nome] of ["Recepção", "Festa"].entries()) {
  const { rows: [s] } = await db.query(
    "insert into secoes (galeria_id,nome,slug,ordem) values ($1,$2,$3,$4) returning id",
    [g.id, nome, ["recepcao", "festa"][i], i],
  );
  ids.push(s.id);
}
await db.query("update medias set secao_id=$2 where galeria_id=$1 and ordem < 3", [g.id, ids[0]]);
await db.query("update medias set secao_id=$2 where galeria_id=$1 and ordem >= 3", [g.id, ids[1]]);

const base = `${BASE}/g/${g.tslug}/${g.gslug}`;
const pegar = async (caminho) => (await fetch(`${base}${caminho}`, { cache: "no-store" })).text();
/* O HTML escapa `&` como `&amp;`, e "Laísa & Davi" tem um. Sem desfazer isso, a
   comparação falha no nome do casal e acusa o código por um defeito do teste —
   foi o que aconteceu na primeira rodada deste arquivo. */
const texto = (s) =>
  s.replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
const titulo = (html) => texto(html.match(/<title>(.*?)<\/title>/s)?.[1] ?? "");
const cartao = (html) =>
  html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ??
  html.match(/<meta content="([^"]*)" property="og:title"/)?.[1] ??
  "";

console.log("O título da aba:\n");

await etapa("a galeria diz o casamento e o estúdio", async () => {
  const t = titulo(await pegar(""));
  if (!/Laísa & Davi/.test(t)) throw new Error(`a aba diz "${t}"`);
  return t;
});

await etapa("o capítulo aparece na aba", async () => {
  const t = titulo(await pegar("/festa"));
  if (!/Festa/i.test(t)) {
    throw new Error(`a aba continua dizendo "${t}" — é a queixa do Juan`);
  }
  if (!/Laísa & Davi/.test(t)) {
    throw new Error(`o capítulo comeu o nome do casal: "${t}"`);
  }
  return t;
});

await etapa("mudar de capítulo muda a aba", async () => {
  /* A prova de que não é coincidência: dois capítulos, dois títulos. */
  const a = titulo(await pegar("/recepcao"));
  const b = titulo(await pegar("/festa"));
  if (a === b) throw new Error(`Recepção e Festa dão a mesma aba: "${a}"`);
  if (!/Recep/i.test(a)) throw new Error(`a Recepção diz "${a}"`);
  return `${a}  →  ${b}`;
});

await etapa("o cartão de compartilhar continua sendo o da GALERIA", async () => {
  /*
   * A metade que NÃO podia mudar junto, e a razão está escrita na rota do
   * capítulo: quando o casal manda o link no WhatsApp, o cartão tem de dizer o
   * casamento. Ninguém compartilha um capítulo achando que compartilha um
   * capítulo.
   */
  const c = texto(cartao(await pegar("/festa")));
  if (!c) throw new Error("não achei o og:title");
  if (/Festa/i.test(c)) throw new Error(`o cartão vazou o capítulo: "${c}"`);
  if (!/Laísa & Davi/.test(c)) throw new Error(`o cartão não diz o casamento: "${c}"`);
  return c;
});

await etapa("capítulo que não existe não inventa nome na aba", async () => {
  /* Link velho, capítulo renomeado, erro de digitação: a aba volta a ser a da
     galeria em vez de escrever o que veio da URL. */
  const t = titulo(await pegar("/capitulo-que-nao-existe"));
  if (/capitulo-que-nao-existe/i.test(t)) {
    throw new Error(`a aba repetiu o que veio da URL: "${t}"`);
  }
  if (!/Laísa & Davi/.test(t)) throw new Error(`a aba virou "${t}"`);
  return t;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a aba não acompanha o capítulo" : "\n✓ a aba diz o capítulo");
process.exitCode = falhou ? 1 : 0;
