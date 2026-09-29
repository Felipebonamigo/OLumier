#!/usr/bin/env node
/**
 * A CAPA CARTAZ — foto grande, sem véu, texto embaixo. Uso:
 *   node --env-file=.env.local scripts/testar-capa-cartaz.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (29/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe, repassando: "adicionar outra de capa grande, tipo a imersa, mas sem
 * degradê" e "sugeriram de adicionar uma opção de capa grande, mas sem o
 * degradê".
 *
 * ── POR QUE NÃO FOI SÓ APAGAR O DEGRADÊ ───────────────────────────────────
 *
 * Porque o degradê da imersa não é enfeite: é o que torna o nome legível. Na
 * imersa o título fica SOBRE a foto, e nenhum dos cinco elementos dela tem
 * sombra, contorno ou fundo próprio (`galeria-capa.tsx`). Com os tokens do tema
 * noite — o dos presets Átomo e Cerimônia — o título branco sobre uma foto
 * clara dá 1,13:1 de contraste sobre vestido ao sol, 1,39:1 sobre pele clara e
 * 1,62:1 sobre céu. O mínimo da WCAG para texto grande é 3:1. O nome do casal
 * simplesmente some.
 *
 * Sobre o fundo do tema, os MESMOS tokens dão 17,69:1 no noite, 16,77:1 no
 * claro e 10,16:1 no creme. Então a resposta certa não é tirar o véu de cima do
 * texto: é tirar o texto de cima da foto. É uma capa nova, e a imersa fica
 * exatamente como está — quem escolheu uma não quer a outra.
 *
 * ── A DOBRA ───────────────────────────────────────────────────────────────
 *
 * Com o texto embaixo, a conta do celular muda: 390×844 com `alturaCapa: cheia`
 * são 658 px de foto, e o bloco de texto pede ~276 px com a logo média. O nome
 * cairia abaixo da dobra — o contrário de "capa grande com o nome à vista".
 *
 * Por isso `--g-capa-h` mede o CABEÇALHO INTEIRO no cartaz, e a foto ocupa o
 * que sobra (`flex-1`). O eixo "altura da capa" continua querendo dizer a mesma
 * coisa que nas outras seis capas — quanto da tela a capa ocupa — em vez de
 * ganhar um multiplicador que só vale aqui.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

import { OPCOES } from "../src/config/aparencia.ts";

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

const g = await galeriaDaRodada(db, { nome: "cartaz", medias: 3 });
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);

const comCapa = async (capa) => {
  await db.query(
    `update galerias
        set aparencia = jsonb_set(coalesce(aparencia,'{}'::jsonb), '{capa}', $2::jsonb)
      where id = $1`,
    [g.id, JSON.stringify(capa)],
  );
  return (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
};

const bloco = (html, nome) =>
  html.match(new RegExp(`<header[^>]*data-capa="${nome}"[^]*?</header>`))?.[0] ?? "";

console.log("A capa cartaz:\n");

await etapa("entra na lista de escolhas", () => {
  const ids = OPCOES.capa.map((c) => c.id);
  if (!ids.includes("cartaz")) throw new Error('"cartaz" não está em OPCOES.capa');
  return ids.join(", ");
});

const html = await comCapa("cartaz");
const b = bloco(html, "cartaz");

await etapa("desenha a foto e respeita o ponto focal", () => {
  if (!b) throw new Error('não achei <header data-capa="cartaz">');
  if (!/<img/.test(b)) throw new Error("desenhou sem foto");
  /* Nasceu depois do ponto focal; ignorá-lo seria entregar uma capa em que o
     enquadramento volta a ser automático. */
  if (!/object-position/.test(b)) throw new Error("ignora o ponto focal");
  return "foto + ponto focal";
});

await etapa("não tem véu nenhum por cima da foto", () => {
  /*
   * A pergunta do pedido, feita direto: sobrou gradiente no bloco? Vale para
   * qualquer forma dele — `linear-gradient`, `radial-gradient`, ou uma camada
   * chapada de cor por cima.
   */
  if (/gradient/i.test(b)) {
    throw new Error("ainda há gradiente na capa cartaz — era isso que tinha de sair");
  }
  return "sem gradiente";
});

await etapa("o texto fica FORA da foto, e não por cima dela", () => {
  /*
   * A asserção que separa o cartaz da imersa mecanicamente: na imersa a `<img>`
   * é `absolute inset-0` e o texto flutua sobre ela; no cartaz a foto é um
   * irmão em fluxo, e o texto vem depois.
   *
   * Comparar a POSIÇÃO do título com a da foto na string seria frágil — uma
   * `div` aninhada a mais e a conta muda. Já "a foto não é absoluta" não
   * depende de ordem nenhuma: sem `absolute` não existe texto por cima.
   */
  const img = b.match(/<img[^>]*>/)?.[0] ?? "";
  if (!img) throw new Error("não achei a <img> do cartaz");
  if (/\babsolute\b/.test(img)) {
    throw new Error("a foto é absoluta — o texto volta a flutuar sobre ela, como na imersa");
  }
  if (/absolute inset-0/.test(b)) {
    throw new Error("há uma camada absoluta cobrindo a foto");
  }
  return "foto em fluxo, texto depois";
});

await etapa("a altura sai do eixo, e não de um número cravado", () => {
  /*
   * Mesma regra de `testar-eixos-forma.mjs`: altura escolhida no painel viaja
   * por variável, porque o Tailwind gera classe LENDO o código — `h-[64vh]`
   * não existe se ninguém escreveu. E o multiplicador é o erro fácil aqui: um
   * `calc(var(--g-capa-h)*0.82)` faria "cheia" dizer 78vh no painel e desenhar
   * 64vh na tela, só nesta capa.
   */
  const cabecalho = b.match(/<header[^>]*>/)?.[0] ?? "";
  if (!/var\(--g-capa-h/.test(cabecalho)) {
    throw new Error("o cabeçalho do cartaz não lê --g-capa-h");
  }
  const multiplicador = cabecalho.match(/--g-capa-h[^)]*\)\s*\*\s*[\d.]+/);
  if (multiplicador) {
    throw new Error(`a altura tem multiplicador (${multiplicador[0]}) — o eixo mente nesta capa`);
  }
  const img = b.match(/<img[^>]*>/)?.[0] ?? "";
  if (/\bh-\[\d+vh\]/.test(img)) throw new Error("a foto crava a altura em vh");
  return "o cabeçalho inteiro mede --g-capa-h";
});

await etapa("sem foto nenhuma, cai na mínima em vez de quebrar", async () => {
  await db.query("update medias set pronto = false where galeria_id = $1", [g.id]);
  const semFoto = await comCapa("cartaz");
  await db.query("update medias set pronto = true where galeria_id = $1", [g.id]);
  if (!/data-capa="minima"/.test(semFoto)) {
    throw new Error("galeria sem foto não caiu na mínima");
  }
  return "reserva ok";
});

await etapa("a imersa continua com o degradê dela", async () => {
  /*
   * O cartaz é uma ALTERNATIVA, não uma reforma da imersa. Quem escolheu a
   * imersa quer o título sobre a foto — e sem o véu ele sai em 1,13:1.
   */
  const bImersa = bloco(await comCapa("imersa"), "imersa");
  if (!bImersa) throw new Error('não achei <header data-capa="imersa">');
  if (!/linear-gradient\(to top/.test(bImersa)) {
    throw new Error("a imersa perdeu o degradê — o título dela fica ilegível sobre foto clara");
  }
  return "degradê intacto";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a capa cartaz não fecha" : "\n✓ capa cartaz ok");
process.exit(falhou ? 1 : 0);
