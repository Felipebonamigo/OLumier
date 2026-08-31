#!/usr/bin/env node
/**
 * A fonte própria do estúdio. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-fonte.mjs
 *
 * ── O QUE ESTA SUÍTE GUARDA ───────────────────────────────────────────────
 *
 * Fonte é o primeiro arquivo que aceitamos SEM poder confiar no tipo declarado.
 * A logo pôde ser validada por MIME porque navegador nenhum tem dúvida sobre o
 * que é `image/png`; `.ttf` e `.otf` chegam quase sempre como
 * `application/octet-stream` — o mesmo tipo de um .zip enviado por engano.
 *
 * Daí a validação por assinatura, e daí esta suíte: se alguém um dia "melhorar"
 * a checagem trocando-a por extensão ou por MIME, o buraco não aparece na tela.
 * Aparece no dia em que um arquivo qualquer virar `@font-face` na galeria de um
 * casal.
 *
 * A segunda metade é a queda limpa: estúdio que escolheu a fonte e depois a
 * removeu não pode ficar com galeria quebrada.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();
import {
  ASSINATURAS,
  FAMILIA_PROPRIA,
  LIMITE_FONTE,
  formatoDaFonte,
  nomeDaFonte,
  recusaDaFonte,
} from "../src/lib/fonte-estudio.ts";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

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

const bytesDe = (hex) => Uint8Array.from(Buffer.from(hex + "00000000", "hex"));

console.log("o que é fonte e o que não é");

await etapa("as quatro assinaturas são reconhecidas", () => {
  for (const a of ASSINATURAS) {
    const r = formatoDaFonte(bytesDe(a.hex));
    if (r?.formato !== a.formato) throw new Error(`${a.formato} não foi reconhecido`);
  }
  return [...new Set(ASSINATURAS.map((a) => a.formato))].join(", ");
});

/*
 * As três recusas que importam, e por que estas três:
 *   PK    — .zip. É o engano mais comum: a fundição entrega a fonte zipada.
 *   %PDF  — o espécime da fonte, que vem na mesma pasta e tem nome parecido.
 *   <?xml — SVG ou plist. Documento, não fonte; e é o que carrega script.
 */
await etapa("arquivo que não é fonte é recusado", () => {
  const impostores = { zip: "504b0304", pdf: "25504446", xml: "3c3f786d" };
  for (const [nome, hex] of Object.entries(impostores)) {
    if (formatoDaFonte(bytesDe(hex))) throw new Error(`${nome} passou por fonte`);
    if (!recusaDaFonte(1024, bytesDe(hex))) throw new Error(`${nome} não foi recusado`);
  }
  return Object.keys(impostores).join(", ");
});

await etapa("arquivo grande demais é recusado antes de subir", () => {
  if (!recusaDaFonte(LIMITE_FONTE + 1)) throw new Error("passou do teto e foi aceito");
  if (recusaDaFonte(LIMITE_FONTE)) throw new Error("recusou um arquivo do tamanho exato do teto");
  return `teto de ${Math.round(LIMITE_FONTE / 1024 / 1024)} MB`;
});

/*
 * O NOME VAI PARA DENTRO DE UM SELETOR DE CSS na galeria pública. Sem peneira,
 * um nome com aspas ou ponto e vírgula deixa de ser texto e vira regra escolhida
 * por quem enviou o arquivo.
 */
await etapa("o nome da fonte não carrega CSS junto", () => {
  const sujo = nomeDaFonte('minha";}body{display:none}/*.otf');
  if (/["';{}]/.test(sujo)) throw new Error(`sobrou pontuação de CSS: ${sujo}`);
  if (nomeDaFonte("Playfair-Display.woff2") !== "Playfair-Display") {
    throw new Error(`nome normal foi estragado: ${nomeDaFonte("Playfair-Display.woff2")}`);
  }
  if (!nomeDaFonte("....")) throw new Error("nome vazio não ganhou reserva");
  return `"${sujo}"`;
});

console.log("\nna galeria");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const g = await galeriaDaRodada(db, { nome: "fonte", medias: 2, publicada: true });
const url = `${BASE}/g/${g.tslug}/${g.gslug}`;

const comAparencia = async (tipografia) => {
  await db.query("update galerias set aparencia = $1 where id = $2", [
    JSON.stringify({
      capa: "minima",
      tema: "claro",
      tipografia,
      grade: "quadrada",
      densidade: "normal",
      logo: "media",
    }),
    g.id,
  ]);
  return await (await fetch(url, { cache: "no-store" })).text();
};

await etapa("sem fonte enviada, escolher 'propria' não quebra nada", async () => {
  await db.query("update tenants set fonte_chave = null, fonte_nome = null where id = $1", [
    g.estudio.id,
  ]);
  const html = await comAparencia("propria");
  if (html.includes("@font-face")) {
    throw new Error("injetou @font-face sem ter arquivo — o navegador buscaria o nada");
  }
  if (!html.includes(g.titulo)) throw new Error("a galeria não abriu");
  return "cai na serifada de reserva";
});

await etapa("com fonte enviada, a galeria injeta o @font-face", async () => {
  await db.query("update tenants set fonte_chave = $1, fonte_nome = $2 where id = $3", [
    `${g.estudio.id}/marca/fonte-de-teste.fonte`,
    "Fonte De Teste",
    g.estudio.id,
  ]);
  const html = await comAparencia("propria");
  if (!html.includes("@font-face")) throw new Error("não injetou o @font-face");
  if (!html.includes(FAMILIA_PROPRIA)) {
    throw new Error(`o @font-face não declara a família ${FAMILIA_PROPRIA}`);
  }
  return FAMILIA_PROPRIA;
});

/*
 * A fonte é assinada por requisição e custa uma chamada. Injetá-la em galeria
 * que escolheu Bodoni seria pagar por byte que o navegador nem busca — e, pior,
 * publicar o link do arquivo de marca de quem não pediu isso.
 */
await etapa("galeria que escolheu outra fonte não carrega a do estúdio", async () => {
  const html = await comAparencia("bodoni");
  if (html.includes("@font-face")) {
    throw new Error("injetou a fonte do estúdio numa galeria que escolheu Bodoni");
  }
  return "nada injetado";
});

console.log("\na opção só existe para quem enviou");

await etapa("o seletor de fonte esconde 'propria' de quem não tem arquivo", () => {
  const editor = readFileSync(path.join(RAIZ, "src/components/editor-aparencia.tsx"), "utf8");
  const semComentarios = editor.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  if (!/temFontePropria/.test(semComentarios)) {
    throw new Error("o editor não filtra pela existência da fonte — a opção apareceria para todos");
  }
  return "filtra por temFontePropria";
});

/* A rota confere os BYTES, e não a extensão nem o tipo declarado. Se alguém
   trocar isso, o teste acima de assinatura continua verde e o buraco entra. */
await etapa("a rota de envio confere a assinatura do arquivo", () => {
  const rota = readFileSync(path.join(RAIZ, "src/app/api/marca/fonte/route.ts"), "utf8");
  const semComentarios = rota.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  if (!/formatoDaFonte/.test(semComentarios)) {
    throw new Error("a rota não chama `formatoDaFonte` — está confiando no que o navegador disse");
  }
  if (!/range/i.test(semComentarios)) {
    throw new Error("a rota não lê os primeiros bytes do bucket");
  }
  return "lê os primeiros bytes e confere";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a fonte própria tem problema" : "\n✓ fonte própria ok");
process.exitCode = falhou ? 1 : 0;
