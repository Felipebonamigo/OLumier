#!/usr/bin/env node
/**
 * A galeria que não cabe num documento só. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-galeria-grande.mjs
 *
 * ── O DEFEITO ─────────────────────────────────────────────────────────────
 *
 * 11/09/2026: a Carol abriu no iPhone a galeria "Casamento Ana & Kaio" (2108
 * fotos) e o Safari respondeu "Um problema ocorreu repetidamente" — a tela de
 * aba estourada de memória. Medido em produção, o peso do documento é linear:
 * 97 fotos dão 0,31 MB, 220 dão 0,69 MB, 2108 dão 6,35 MB. ~3,2 KB por foto.
 *
 * Este arquivo prende as duas metades da correção, e as duas importam:
 *
 *   1. galeria GRANDE sai fatiada — o documento encolhe de verdade, e o corte
 *      é no servidor. Conferir só a contagem de `<img>` não bastaria: dá para
 *      esconder no cliente e continuar mandando 6 MB.
 *
 *   2. galeria PEQUENA não muda NADA — mesma contagem de fotos, âncoras de
 *      capítulo no lugar. É a metade que costuma quebrar sem ninguém ver,
 *      porque o olho vai todo para o caso grande.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

import { FOTOS_POR_TELA, fatiarGaleria } from "../src/config/fatia-galeria.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let falhou = false;
const ok = (m, extra) => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ""}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

console.log("A regra do corte, sem servidor\n");

/* O teto escrito à mão: sai de OPCOES nenhum, porque uma tabela lida da
   própria fonte concorda com qualquer mudança e não confere nada. Mudar este
   número muda quanto o celular do convidado baixa, e tem de doer aqui. */
if (FOTOS_POR_TELA === 600) ok("o teto é 600 fotos por tela");
else erro(`o teto virou ${FOTOS_POR_TELA} — 600 é o que mantém o documento abaixo de 2 MB`);

{
  const foto = (i, secao) => ({ id: `f${i}`, secao_id: secao });
  const pequena = Array.from({ length: 97 }, (_, i) => foto(i, "a"));
  const r = fatiarGaleria(pequena);
  if (!r.fatiada && r.itens.length === 97) ok("galeria de 97 fotos passa inteira, sem fatiar");
  else erro(`galeria pequena veio fatiada=${r.fatiada} com ${r.itens.length} fotos`);

  /* Exatamente no teto ainda é "cabe": o corte começa acima dele. */
  const noTeto = Array.from({ length: FOTOS_POR_TELA }, (_, i) => foto(i, "a"));
  if (!fatiarGaleria(noTeto).fatiada) ok(`exatamente ${FOTOS_POR_TELA} fotos ainda passa inteira`);
  else erro(`${FOTOS_POR_TELA} fotos foi fatiada — o teto é inclusivo`);

  /* A galeria da Ana & Kaio, nas proporções reais dela. */
  const grande = [
    ...Array.from({ length: 243 }, (_, i) => foto(`mk-${i}`, "making")),
    ...Array.from({ length: 511 }, (_, i) => foto(`ce-${i}`, "cerimonia")),
    ...Array.from({ length: 345 }, (_, i) => foto(`fe-${i}`, "festa")),
    ...Array.from({ length: 30 }, (_, i) => foto(`so-${i}`, null)),
  ];
  const inteira = fatiarGaleria(grande);
  if (inteira.fatiada && inteira.itens.length === FOTOS_POR_TELA) {
    ok(`galeria de ${grande.length} fotos sai fatiada em ${FOTOS_POR_TELA}`);
  } else {
    erro(`galeria grande veio com ${inteira.itens.length} fotos (fatiada=${inteira.fatiada})`);
  }
  if (inteira.total === grande.length) ok("e o total continua sendo o total de verdade");
  else erro(`o total veio ${inteira.total}, esperava ${grande.length}`);

  const festa = fatiarGaleria(grande, "festa");
  const soDaFesta = festa.itens.every((m) => m.secao_id === "festa");
  if (soDaFesta && festa.itens.length === 345) ok("escolher um capítulo traz só as fotos dele", "345");
  else erro(`o capítulo trouxe ${festa.itens.length} fotos, e só-da-festa=${soDaFesta}`);

  const soltas = fatiarGaleria(grande, "sem-capitulo");
  if (soltas.itens.length === 30 && soltas.itens.every((m) => !m.secao_id)) {
    ok('"sem-capitulo" traz as fotos que não estão em capítulo nenhum', "30");
  } else {
    erro(`as soltas vieram ${soltas.itens.length}`);
  }

  /* O buraco do tamanho do defeito original: capítulo maior que o teto. */
  const capituloEnorme = Array.from({ length: 1500 }, (_, i) => foto(`x${i}`, "unico"));
  const corte = fatiarGaleria(capituloEnorme, "unico");
  if (corte.itens.length === FOTOS_POR_TELA && corte.restantes === 1500 - FOTOS_POR_TELA) {
    ok("capítulo maior que o teto também é cortado", `${corte.restantes} ficaram de fora`);
  } else {
    erro(`capítulo de 1500 trouxe ${corte.itens.length} fotos e diz ${corte.restantes} restantes`);
  }

  /* Capítulo que não existe não pode devolver a galeria inteira por engano. */
  const inventado = fatiarGaleria(grande, "nao-existe");
  if (inventado.itens.length === 0) ok("capítulo inventado não devolve a galeria inteira");
  else erro(`capítulo inexistente trouxe ${inventado.itens.length} fotos`);
}

console.log("\nO documento que sai pela rede\n");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

/*
 * Uma bancada GRANDE. As mídias entram num INSERT só: o laço da fixture faz
 * uma ida ao banco por foto, e mil idas por um túnel SSH é um teste que
 * ninguém espera terminar.
 */
const g = await galeriaDaRodada(db, { nome: "grande", medias: 1, publicada: true });
const EXTRAS = 650;

try {
  const { rows: secoes } = await db.query(
    `insert into secoes (galeria_id, nome, ordem)
          values ($1, 'Cerimônia', 0), ($1, 'Festa', 1)
       returning id, nome`,
    [g.id],
  );
  const cerimonia = secoes.find((s) => s.nome === "Cerimônia").id;
  const festa = secoes.find((s) => s.nome === "Festa").id;

  await db.query(
    `insert into medias (galeria_id, tenant_id, chave, chave_thumb, chave_preview,
                         nome_original, mime, bytes, ordem, tipo, pronto, secao_id)
     select $1, $2,
            $3 || i || '.jpg', $3 || i || '_thumb.webp', $3 || i || '_prev.webp',
            'foto-' || i || '.jpg', 'image/jpeg', 1024, i + 10, 'foto', true,
            case when i < $5 then $6::uuid else $7::uuid end
       from generate_series(1, $4) as i`,
    [g.id, g.estudio.id, `${g.estudio.id}/${g.id}/grande-`, EXTRAS, EXTRAS / 2, cerimonia, festa],
  );

  const url = `${BASE}/g/${g.tslug}/${g.gslug}`;
  const pegar = async (endereco) => {
    const r = await fetch(endereco, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${endereco}`);
    const html = await r.text();
    return {
      html,
      mb: html.length / 1024 / 1024,
      imgs: [...html.matchAll(/<img\b/g)].length,
      assinadas: [...html.matchAll(/X-Amz-Signature/g)].length,
    };
  };

  const total = EXTRAS + 1;
  const cheia = await pegar(url);
  if (cheia.imgs <= FOTOS_POR_TELA + 5) {
    ok(`galeria de ${total} fotos manda ${cheia.imgs} imagens`, `${cheia.mb.toFixed(2)} MB`);
  } else {
    erro(`a galeria mandou ${cheia.imgs} imagens de ${total} — o corte não aconteceu no servidor`);
  }

  /* A prova de que o corte é no SERVIDOR, e não um `display:none`: o número de
     URLs assinadas cai junto. Elas são 37% do documento — se continuassem
     todas ali, o iPhone continuaria estourando com a tela "certa". */
  /* Duas assinaturas por foto — uma no `<img>`, outra nos dados de
     hidratação — mais um punhado para capa e logo. O que esta etapa persegue é
     a diferença entre "assina o que manda" e "assina a galeria inteira": com o
     corte, o número acompanha as imagens desenhadas. */
  if (cheia.assinadas <= cheia.imgs * 2 + 20) {
    ok("e assina só o que manda", `${cheia.assinadas} assinaturas`);
  } else {
    erro(`assinou ${cheia.assinadas} URLs — está mandando a galeria inteira escondida`);
  }

  if (cheia.mb < 2) ok("o documento fica abaixo de 2 MB", `${cheia.mb.toFixed(2)} MB`);
  else erro(`o documento tem ${cheia.mb.toFixed(2)} MB — acima do que um iPhone aguenta`);

  const soFesta = await pegar(`${url}?cap=${festa}`);
  if (soFesta.imgs > 0 && soFesta.imgs <= EXTRAS / 2 + 5) {
    ok("escolher um capítulo carrega só ele", `${soFesta.imgs} imagens`);
  } else {
    erro(`o capítulo trouxe ${soFesta.imgs} imagens`);
  }

  /* Capítulo inventado não pode virar erro nem galeria inteira. */
  const torto = await pegar(`${url}?cap=nao-existe-mesmo`);
  if (torto.imgs <= FOTOS_POR_TELA + 5) ok("capítulo inventado não derruba nem escancara a galeria");
  else erro(`capítulo inventado trouxe ${torto.imgs} imagens`);

  /*
   * ── A BUSCA POR ROSTO NÃO PODE VIRAR MENTIRA ────────────────────────────
   *
   * O servidor procura no acervo INTEIRO e responde "você aparece em 37
   * fotos". Se a página só soubesse filtrar a fatia carregada, mostraria as
   * nove que por acaso estão nela — embaixo de um texto dizendo 37. Por isso
   * as encontradas viajam por id no endereço, e vêm de qualquer capítulo.
   */
  const { rows: espalhadas } = await db.query(
    `select id from medias where galeria_id = $1 and secao_id = $2 order by ordem desc limit 3`,
    [g.id, festa],
  );
  const ids = espalhadas.map((r) => r.id);
  const porId = await pegar(`${url}?fotos=${ids.join(",")}`);
  if (porId.imgs >= ids.length && porId.imgs <= ids.length + 5) {
    ok("as fotos encontradas vêm pelo endereço, de qualquer capítulo", `${porId.imgs} imagens`);
  } else {
    erro(`pedi ${ids.length} fotos por id e vieram ${porId.imgs} imagens`);
  }

  /* Id inventado no meio não pode derrubar nem escancarar a galeria. */
  const comLixo = await pegar(`${url}?fotos=${ids[0]},nao-existe,${ids[1]}`);
  if (comLixo.imgs <= ids.length + 5) ok("id inventado no meio da lista é ignorado");
  else erro(`a lista com lixo trouxe ${comLixo.imgs} imagens`);

  /* ── A METADE QUE COSTUMA QUEBRAR SEM NINGUÉM VER ────────────────────── */
  const pequena = await galeriaDaRodada(db, { nome: "pequena", medias: 6, publicada: true });
  const p = await pegar(`${BASE}/g/${pequena.tslug}/${pequena.gslug}`);
  if (p.imgs >= 6) ok("galeria pequena continua mandando todas as fotos", `${p.imgs} imagens`);
  else erro(`a galeria de 6 fotos mandou ${p.imgs} imagens — o corte vazou para as pequenas`);
} finally {
  /*
   * As mídias desta bancada saem por SQL, e antes da limpeza comum.
   *
   * `limparRodada` apaga três objetos do bucket por mídia, uma chamada de rede
   * cada. Para as 650 daqui isso são ~1950 idas ao Cloudflare por causa de
   * chaves que nunca existiram — dez minutos de suíte para apagar nada. As
   * poucas mídias que a fixture criou continuam pelo caminho normal, que é o
   * que garante não deixar objeto pago para trás.
   */
  await db.query("delete from medias where galeria_id = $1 and chave like '%/grande-%'", [g.id]);
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ a galeria grande tem problema");
  process.exit(1);
}
console.log("\n✓ galeria grande cabe no celular");
