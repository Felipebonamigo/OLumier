#!/usr/bin/env node
/**
 * O RECADO DO CLIENTE. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-recado-do-cliente.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (01/10/2026) ─────────────────────────────────────────────────
 *
 * Juan: "disponibilizar uma área de feedbacks (…) poderá ser ativada ou não
 * para atuar na galeria. Se for ativada, no menu, junto da área das favoritas,
 * vai ter algum símbolo (…) as pessoas poderão adicionar um feedback por
 * escrito, ou preencher um formulário de 0 a 5 estrelas (…) Só o fotógrafo/dono
 * da galeria poderá acessar as respostas."
 *
 * ── AS DUAS REGRAS QUE ESTE ARQUIVO EXISTE PARA PRENDER ───────────────────
 *
 * 1. DESLIGADO É DESLIGADO. As 512 galerias que já estão no ar não ganham
 *    símbolo, não ganham botão e não aceitam recado — nem por rota direta. Um
 *    campo novo numa entrega de casamento que já aconteceu não é melhoria.
 *
 * 2. SÓ O FOTÓGRAFO LÊ, e isso se prova por AUSÊNCIA: o texto de um recado não
 *    pode sair no HTML da galeria pública. A conferência tira os `<script>`
 *    antes de olhar — sem isso o teste passa por sorte, porque o que o React
 *    manda nas props não está na marcação desenhada.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { TETO_DO_RECADO, MAX_PERGUNTAS } from "../src/lib/recados.ts";

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
/* O HTML sem os scripts: só o que o casal vê desenhado. Ver o cabeçalho. */
const desenhado = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "");

const g = await galeriaDaRodada(db, { nome: "recado", medias: 3 });
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);
const paginaPublica = `${BASE}/g/${g.tslug}/${g.gslug}`;
const rota = `${BASE}/api/g/${g.id}/recado`;

/** Identifica uma pessoa na galeria e devolve o cookie dela. */
const identificar = async (email) => {
  const r = await fetch(`${BASE}/api/g/${g.id}/eu`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) throw new Error(`identificar: HTTP ${r.status}`);
  return (r.headers.get("set-cookie") ?? "").split(";")[0];
};

const mandar = (cookie, corpo) =>
  fetch(rota, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(corpo),
  });

const ligar = (extra = {}) =>
  db.query(
    `update galerias
        set recado_ativo = $2, recado_estrelas = $3, recado_convite = $4, recado_perguntas = $5
      where id = $1`,
    [
      g.id,
      extra.ativo ?? true,
      extra.estrelas ?? false,
      extra.convite ?? null,
      JSON.stringify(extra.perguntas ?? []),
    ],
  );

const noiva = await identificar(`noiva-recado-${Date.now()}@exemplo.com`);
const FRASE = "Vocês capturaram exatamente o que esse dia foi para nós";

console.log("O recado do cliente:\n");

/* ── DESLIGADO ──────────────────────────────────────────────────────────── */

await etapa("desligado: a galeria entregue não muda", async () => {
  const html = desenhado(await (await fetch(paginaPublica, { cache: "no-store" })).text());
  if (/[Dd]eixar um recado|[Rr]ecado para/.test(html)) {
    throw new Error("apareceu convite de recado numa galeria que não ligou nada");
  }
  return "sem convite";
});

await etapa("desligado: a rota recusa, mesmo com a pessoa identificada", async () => {
  /* Pela rota direta, que é o caminho de quem tem o link e curiosidade. */
  const r = await mandar(noiva, { texto: FRASE });
  igual(r.status, 409, "status");
  const { rows } = await db.query("select count(*)::int as n from recados where galeria_id = $1", [g.id]);
  igual(rows[0].n, 0, "recados gravados");
});

/* ── LIGADO, TEXTO ESCRITO ──────────────────────────────────────────────── */

await ligar();

await etapa("ligado: o convite aparece na galeria", async () => {
  const html = desenhado(await (await fetch(paginaPublica, { cache: "no-store" })).text());
  if (!/recado/i.test(html)) throw new Error("não achei o convite de recado na página");
  return "convite na página";
});

await etapa("o convite do fotógrafo substitui o texto padrão", async () => {
  const meu = "Conta pra gente como foi receber as fotos";
  await ligar({ convite: meu });
  const html = desenhado(await (await fetch(paginaPublica, { cache: "no-store" })).text());
  if (!html.includes(meu)) throw new Error("o convite escrito pelo fotógrafo não saiu");
  await ligar();
  return "texto do fotógrafo";
});

await etapa("sem dizer quem é, o recado pede identificação (428)", async () => {
  /* Mesmo código das favoritas: não é erro, é "falta um passo". Recado sem
     pessoa seria uma linha anônima que o fotógrafo não pode responder. */
  const r = await mandar("", { texto: FRASE });
  igual(r.status, 428, "status");
});

await etapa("identificada, o recado grava", async () => {
  const r = await mandar(noiva, { texto: FRASE });
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  const { rows } = await db.query(
    "select texto, autoriza_depoimento from recados where galeria_id = $1",
    [g.id],
  );
  igual(rows.length, 1, "linhas");
  igual(rows[0].texto, FRASE, "texto");
  /* A autorização é um SIM explícito: quem não marcou nada não autorizou. */
  igual(rows[0].autoriza_depoimento, false, "autorização sem pedir");
});

await etapa("escrever de novo CORRIGE, não acrescenta", async () => {
  const novo = "Corrigindo: foi o melhor dia da nossa vida";
  const r = await mandar(noiva, { texto: novo });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows } = await db.query("select texto from recados where galeria_id = $1", [g.id]);
  igual(rows.length, 1, "linhas");
  igual(rows[0].texto, novo, "texto");
});

await etapa("duas pessoas, dois recados", async () => {
  const noivo = await identificar(`noivo-recado-${Date.now()}@exemplo.com`);
  const r = await mandar(noivo, { texto: "Assino embaixo" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows } = await db.query("select count(*)::int as n from recados where galeria_id = $1", [g.id]);
  igual(rows[0].n, 2, "recados");
});

await etapa("o texto é aparado no teto do depoimento", async () => {
  const comprido = "z".repeat(TETO_DO_RECADO + 400);
  const r = await mandar(noiva, { texto: comprido });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows } = await db.query(
    "select length(texto) as n from recados where galeria_id = $1 order by atualizado_em desc limit 1",
    [g.id],
  );
  igual(Number(rows[0].n), TETO_DO_RECADO, "tamanho gravado");
});

await etapa("recado vazio não grava nada", async () => {
  /* Linha sem texto e sem nota é um lugar vazio na tela do fotógrafo. */
  const r = await mandar(await identificar(`vazio-${Date.now()}@exemplo.com`), { texto: "   " });
  igual(r.status, 422, "status");
});

/* ── A REGRA DE OURO: SÓ O FOTÓGRAFO LÊ ────────────────────────────────── */

await etapa("o texto do recado NÃO sai na galeria pública", async () => {
  await mandar(noiva, { texto: FRASE });
  const html = desenhado(await (await fetch(paginaPublica, { cache: "no-store" })).text());
  if (html.includes(FRASE)) throw new Error("o recado de alguém apareceu para todo mundo");
  /* E nem pela rota: ela só aceita, nunca devolve lista. */
  const r = await fetch(rota, { headers: { cookie: noiva } });
  if (r.ok) {
    const corpo = await r.text();
    if (corpo.includes(FRASE)) throw new Error("a rota pública devolveu o recado");
  }
  return "ninguém mais lê";
});

await etapa("o dono lê os recados no painel", async () => {
  const r = await fetch(`${BASE}/painel/galerias/${g.id}/recados`, {
    headers: { cookie: cookieDeSessao(g.tenant_id) },
    cache: "no-store",
  });
  igual(r.status, 200, "status");
  const html = await r.text();
  if (!html.includes(FRASE)) throw new Error("o recado não aparece para o dono");
  return "o dono vê";
});

await etapa("outro estúdio NÃO lê", async () => {
  const { segundoEstudioDaRodada } = await import("./fixture-de-teste.mjs");
  const outro = await segundoEstudioDaRodada(db);
  const r = await fetch(`${BASE}/painel/galerias/${g.id}/recados`, {
    headers: { cookie: cookieDeSessao(outro.id) },
    cache: "no-store",
    redirect: "manual",
  });
  if (r.status === 200) {
    const html = await r.text();
    if (html.includes(FRASE)) throw new Error("o recado apareceu para outro estúdio");
    throw new Error("a rota respondeu 200 para outro estúdio");
  }
  return `HTTP ${r.status}`;
});

/* ── AS ESTRELAS ────────────────────────────────────────────────────────── */

await etapa("sem as estrelas ligadas, nota mandada por rota é ignorada", async () => {
  const quem = await identificar(`so-nota-${Date.now()}@exemplo.com`);
  const r = await mandar(quem, { notas: { "Atendimento": 5 } });
  /* Sem texto e sem pergunta válida, não há recado a gravar. */
  igual(r.status, 422, "status");
});

await etapa("com as perguntas do fotógrafo, a nota grava", async () => {
  await ligar({ estrelas: true, perguntas: ["Como foi o atendimento?", "E a entrega?"] });
  const quem = await identificar(`com-nota-${Date.now()}@exemplo.com`);
  const r = await mandar(quem, { notas: { "Como foi o atendimento?": 5, "E a entrega?": 4 } });
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  const { rows } = await db.query(
    `select notas from recados r
       join pessoas_da_galeria p on p.id = r.pessoa_id
      where r.galeria_id = $1 order by r.criado_em desc limit 1`,
    [g.id],
  );
  igual(rows[0].notas["Como foi o atendimento?"], 5, "primeira nota");
  igual(rows[0].notas["E a entrega?"], 4, "segunda nota");
});

await etapa("pergunta que o fotógrafo não fez é descartada", async () => {
  /* As chaves vêm do navegador. Gravar o que vier deixaria qualquer um escrever
     texto livre na tela do fotógrafo por dentro de um campo de nota. */
  const quem = await identificar(`nota-forjada-${Date.now()}@exemplo.com`);
  const r = await mandar(quem, {
    texto: "ok",
    notas: { "Como foi o atendimento?": 3, "<script>alert(1)</script>": 5 },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows } = await db.query(
    "select notas from recados where galeria_id = $1 order by criado_em desc limit 1",
    [g.id],
  );
  const chaves = Object.keys(rows[0].notas);
  igual(chaves.length, 1, "perguntas gravadas");
  igual(chaves[0], "Como foi o atendimento?", "a que sobrou");
});

await etapa("nota fora de 0 a 5 é descartada", async () => {
  const quem = await identificar(`nota-absurda-${Date.now()}@exemplo.com`);
  const r = await mandar(quem, { texto: "ok", notas: { "Como foi o atendimento?": 99 } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows } = await db.query(
    "select notas from recados where galeria_id = $1 order by criado_em desc limit 1",
    [g.id],
  );
  igual(Object.keys(rows[0].notas).length, 0, "notas gravadas");
});

await etapa("só as estrelas: a caixa de escrever não aparece, e texto por rota é ignorado", async () => {
  /*
   * As duas chaves são separadas, e desligar o texto escrito tem de TIRAR a
   * caixa — não só deixar de convidar. A trava existe nos dois lados porque a
   * tela roda no navegador de outra pessoa.
   */
  await ligar({ ativo: false, estrelas: true, perguntas: ["Como foi o atendimento?"] });
  const html = desenhado(await (await fetch(paginaPublica, { cache: "no-store" })).text());
  if (/Seu recado/.test(html)) throw new Error("a caixa de escrever apareceu desligada");

  const quem = await identificar(`so-estrela-${Date.now()}@exemplo.com`);
  const r = await mandar(quem, { texto: "texto que ninguém pediu", notas: { "Como foi o atendimento?": 4 } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows } = await db.query(
    `select texto, notas from recados r
       where r.galeria_id = $1 order by r.criado_em desc limit 1`,
    [g.id],
  );
  igual(rows[0].texto, null, "texto gravado");
  igual(rows[0].notas["Como foi o atendimento?"], 4, "nota gravada");
  return "a nota entra, o texto não";
});

await etapa("a lista de perguntas tem teto", async () => {
  const { lerPerguntas } = await import("../src/lib/recados.ts");
  const demais = Array.from({ length: MAX_PERGUNTAS + 5 }, (_, i) => `Pergunta ${i}`);
  igual(lerPerguntas(demais).length, MAX_PERGUNTAS, "perguntas aceitas");
  /* Lixo no jsonb não derruba a tela do casal. */
  igual(lerPerguntas(null).length, 0, "null");
  igual(lerPerguntas([{ a: 1 }, "", "  ", "Vale"]).length, 1, "só a que é texto");
});

await etapa("o laço é barrado — e esta etapa fica no FIM por isso", async () => {
  /*
   * O freio é por galeria + IP, e a galeria desta rodada é nova: estourar a cota
   * aqui não atrapalha outra execução. Mas estoura a desta — então qualquer
   * etapa nova vai ACIMA desta linha, nunca abaixo.
   *
   * Por que o freio existe: quem tem o link cria identidades à vontade
   * (`pessoaPorEmail` aceita qualquer coisa com arroba) e o índice único por
   * pessoa não segura nada contra isso.
   */
  await ligar();
  let barrou = 0;
  for (let i = 0; i < 25 && !barrou; i++) {
    const quem = await identificar(`laco-${i}-${Date.now()}@exemplo.com`);
    const r = await mandar(quem, { texto: `recado ${i}` });
    if (r.status === 429) barrou = i + 1;
  }
  if (!barrou) throw new Error("25 recados seguidos da mesma origem e nada barrou");
  return `barrou no ${barrou}º`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o recado do cliente não fecha" : "\n✓ o recado do cliente ok");
process.exitCode = falhou ? 1 : 0;
