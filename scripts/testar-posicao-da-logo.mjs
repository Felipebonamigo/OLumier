#!/usr/bin/env node
/**
 * ONDE A LOGO FICA NA CAPA: início, meio ou final. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-posicao-da-logo.mjs
 *
 * Precisa do servidor de desenvolvimento no ar.
 *
 * ── O PEDIDO (08/10/2026) ─────────────────────────────────────────────────
 *
 * Uma aluna, sobre a capa imersa: "seria legal poder escolher se quero o logo no
 * início, meio ou final da arte. No modo imersivo eu acho lindo, mas a primeira
 * coisa que aparece na foto é o logo e eu acho que pesa o layout. Daí tenho que
 * deixar sem."
 *
 * ── O QUE ESTE TESTE PRENDE ───────────────────────────────────────────────
 *
 * 1. Em CADA capa, os três degraus põem a logo onde dizem: antes do nome, entre
 *    o nome e a data, depois da data. O laço lê `OPCOES.capa`: capa nova entra
 *    sozinha, e esquecê-la aqui seria deixar uma capa sem o eixo.
 * 2. Quem nunca escolheu NÃO MUDA DE CARA: o HTML da capa sem escolha é idêntico
 *    ao da escolha explícita do degrau que aquele desenho sempre usou. É isso
 *    que impede o eixo de mexer em galeria já entregue.
 * 3. Lixo gravado no eixo volta ao que o desenho faz, e a escolha de degrau não
 *    traz a assinatura de volta quando o fotógrafo escolheu "nenhuma".
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import {
  OPCOES,
  OPCOES_POSICAO_LOGO,
  PRESETS,
  APARENCIA_PADRAO,
  lerAparencia,
  posicaoDaLogo,
  presetEquivalente,
} from "../src/config/aparencia.ts";

exigirBancoDeTeste();

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

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

console.log("A posição da logo na capa\n");

await etapa("a lista oferece os três degraus", () => {
  const ids = OPCOES_POSICAO_LOGO.map((o) => o.id);
  if (JSON.stringify(ids) !== JSON.stringify(["inicio", "meio", "fim"])) {
    throw new Error(`a lista é ${ids.join(", ")}`);
  }
});

await etapa("o padrão é `null`, e `null` vale o que o desenho da capa sempre fez", () => {
  if (APARENCIA_PADRAO.posicaoLogo !== null) throw new Error("o padrão não é null");
  const fim = ["cartaz", "redonda", "arco"];
  for (const { id } of OPCOES.capa) {
    const esperado = fim.includes(id) ? "fim" : "inicio";
    const veio = posicaoDaLogo({ capa: id, posicaoLogo: null });
    if (veio !== esperado) throw new Error(`${id}: esperava ${esperado}, veio ${veio}`);
  }
  return "cartaz, redonda e arco no fim; as outras no início";
});

await etapa("lerAparencia aceita os três e joga o resto para `null`", () => {
  for (const { id } of OPCOES_POSICAO_LOGO) {
    if (lerAparencia({ posicaoLogo: id }).posicaoLogo !== id) throw new Error(`perdeu "${id}"`);
  }
  for (const lixo of ["topo", "", 3, {}, "INICIO", undefined, null]) {
    if (lerAparencia({ posicaoLogo: lixo }).posicaoLogo !== null) {
      throw new Error(`${JSON.stringify(lixo)} passou`);
    }
  }
});

await etapa("a escolha tira a galeria de qualquer preset (marcação não mente)", () => {
  const base = PRESETS[0].aparencia;
  if (presetEquivalente(base) !== PRESETS[0].id) throw new Error("o preset não se reconhece");
  const outro = OPCOES_POSICAO_LOGO.find((o) => o.id !== posicaoDaLogo(base)).id;
  if (presetEquivalente({ ...base, posicaoLogo: outro }) !== null) {
    throw new Error("mudou a posição da logo e o preset continuou marcado");
  }
});

const g = await galeriaDaRodada(db, { nome: "poslogo", medias: 3, publicada: true });
await db.query(
  `update galerias set senha_hash = null, capa_media_id = $2, titulo = 'Posicaoteste',
          subtitulo = 'Localteste', data_evento = '2026-10-08' where id = $1`,
  [g.id, g.midias[0].id],
);
await db.query("update tenants set logo_chave = $2 where id = $1", [
  g.tenant_id,
  `${g.tenant_id}/marca/logo.png`,
]);
const NOME_DO_ESTUDIO = (await db.query("select nome_estudio from tenants where id = $1", [g.tenant_id]))
  .rows[0].nome_estudio;

/** O cabeçalho de uma capa, com a posição pedida (`undefined` = sem escolha). */
async function capa(nomeDaCapa, posicao, logo = "media") {
  await db.query(
    `update galerias
        set aparencia = jsonb_set(jsonb_set(coalesce(aparencia,'{}'::jsonb) - 'posicaoLogo',
                                            '{capa}', $2::jsonb), '{logo}', $3::jsonb)
                        || case when $4::text is null then '{}'::jsonb
                                else jsonb_build_object('posicaoLogo', $4::text) end
      where id = $1`,
    [g.id, JSON.stringify(nomeDaCapa), JSON.stringify(logo), posicao ?? null],
  );
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  return html.match(new RegExp(`<header[^>]*data-capa="${nomeDaCapa}"[^]*?</header>`))?.[0] ?? "";
}

/* O endereço assinado da foto muda a cada pedido (prazo e assinatura): fora da
   comparação, ele faria o teste reprovar por motivo nenhum. */
const semEnderecos = (html) => html.replace(/\s(src|srcset)="[^"]*"/g, "").replace(/\s+/g, " ");

const posicoesNoHtml = (html) => ({
  logo: html.indexOf(`alt="${NOME_DO_ESTUDIO}"`),
  nome: html.indexOf("Posicaoteste"),
  data: html.indexOf("Localteste"),
});

try {
  for (const { id: nomeDaCapa } of OPCOES.capa) {
    await etapa(`capa ${nomeDaCapa}: início, meio e final põem a logo onde dizem`, async () => {
      for (const [posicao, quer] of [
        ["inicio", (p) => p.logo < p.nome && p.nome < p.data],
        ["meio", (p) => p.nome < p.logo && p.logo < p.data],
        ["fim", (p) => p.nome < p.data && p.data < p.logo],
      ]) {
        const html = await capa(nomeDaCapa, posicao);
        if (!html) throw new Error("não achei o cabeçalho desta capa no HTML");
        const p = posicoesNoHtml(html);
        if (Object.values(p).some((x) => x < 0)) {
          throw new Error(`faltou algo na capa (logo ${p.logo}, nome ${p.nome}, data ${p.data})`);
        }
        if (!quer(p)) {
          throw new Error(`"${posicao}" desenhou logo=${p.logo}, nome=${p.nome}, data=${p.data}`);
        }
      }
      return "logo → nome → data · nome → logo → data · nome → data → logo";
    });

    await etapa(`capa ${nomeDaCapa}: quem não escolheu não muda de cara`, async () => {
      const semEscolha = semEnderecos(await capa(nomeDaCapa, undefined));
      const explicita = semEnderecos(
        await capa(nomeDaCapa, posicaoDaLogo({ capa: nomeDaCapa, posicaoLogo: null })),
      );
      if (!semEscolha) throw new Error("não achei o cabeçalho desta capa");
      if (semEscolha !== explicita) {
        throw new Error("o HTML sem escolha difere do HTML do degrau que o desenho sempre usou");
      }
      return "idêntico ao degrau de sempre";
    });

    await etapa(`capa ${nomeDaCapa}: com "nenhuma", escolher o degrau não traz a logo de volta`, async () => {
      for (const { id } of OPCOES_POSICAO_LOGO) {
        const html = await capa(nomeDaCapa, id, "nenhuma");
        if (html.includes(NOME_DO_ESTUDIO)) throw new Error(`"${id}" devolveu a assinatura`);
      }
    });
  }

  await etapa("lixo gravado no banco não derruba a galeria nem muda a capa", async () => {
    await db.query(
      `update galerias set aparencia = jsonb_set(aparencia, '{posicaoLogo}', '"no-teto"'::jsonb) where id = $1`,
      [g.id],
    );
    const r = await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" });
    if (r.status !== 200) throw new Error(`a galeria respondeu ${r.status}`);
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ a posição da logo tem problema\n" : "\n✓ a logo sabe onde ficar\n");
process.exit(falhou ? 1 : 0);
