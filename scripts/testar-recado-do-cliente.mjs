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

const EMAIL_DA_NOIVA = `noiva-recado-${Date.now()}@exemplo.com`;
const noiva = await identificar(EMAIL_DA_NOIVA);
const FRASE = "Vocês capturaram exatamente o que esse dia foi para nós";

console.log("O recado do cliente:\n");

/* ── DESLIGADO ──────────────────────────────────────────────────────────── */

await etapa("desligado: a galeria entregue não muda", async () => {
  const bruto = await (await fetch(paginaPublica, { cache: "no-store" })).text();
  const html = desenhado(bruto);
  if (/[Dd]eixar um recado/.test(html)) {
    throw new Error("apareceu convite de recado numa galeria que não ligou nada");
  }
  /*
   * O SÍMBOLO NA BARRA, que é o risco real das 512 galerias entregues: trocar
   * `recado?.ativo ? abrir : null` por `abrir` punha um ícone de recado em todas
   * elas, e a conferência de "convite" não pegava — o rótulo da barra é outro.
   */
  if (/✉s*Recado/.test(html)) {
    throw new Error("o símbolo do recado apareceu na barra de uma galeria desligada");
  }
  /* E as perguntas do fotógrafo não podem viajar nem na carga do React: prop de
     componente de cliente vai serializada no HTML de quem tem o link. */
  await ligar({ ativo: false, estrelas: false, perguntas: ["O preço ficou dentro do esperado?"] });
  const comPergunta = await (await fetch(paginaPublica, { cache: "no-store" })).text();
  if (comPergunta.includes("O preço ficou dentro do esperado?")) {
    throw new Error("a pergunta do fotógrafo vazou no HTML público com o recado desligado");
  }
  await db.query("update galerias set recado_perguntas = '[]'::jsonb where id = $1", [g.id]);
  return "sem convite, sem símbolo, sem pergunta";
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

await etapa("escrever de novo NÃO apaga o anterior", async () => {
  /*
   * A promessa antiga era "voltar e escrever de novo CORRIGE", feita com
   * `on conflict do update`. Era um defeito: a identidade é um e-mail não
   * verificado, então "corrigir" era o verbo errado — quem digitasse o endereço
   * da noiva apagava o texto dela. Migração 060: cada envio é uma linha.
   */
  const novo = "Complementando: foi o melhor dia da nossa vida";
  const r = await mandar(noiva, { texto: novo });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows } = await db.query(
    "select texto from recados where galeria_id = $1 order by criado_em",
    [g.id],
  );
  igual(rows.length, 2, "linhas");
  igual(rows[0].texto, FRASE, "o primeiro texto continua lá");
  igual(rows[1].texto, novo, "o segundo entrou ao lado");
  return "dois recados, nenhum apagado";
});

await etapa("quem digita o e-mail de outra pessoa NÃO apaga o recado dela", async () => {
  /*
   * ── O DEFEITO QUE ESTA ETAPA EXISTE PARA PRENDER ────────────────────────
   *
   * `pessoaPorEmail` devolve a MESMA linha de `pessoas_da_galeria` para quem
   * quer que digite aquele endereço — não há senha nem confirmação, e isso é
   * decisão de produto de 15/09/2026. Com o `do update` que existia, bastava um
   * estranho com o link digitar `ana@`, escrever outro texto e MARCAR "pode usar
   * como depoimento": o texto da Ana desaparecia do banco e o painel mostrava a
   * frase do estranho assinada com o nome e o e-mail dela, autorizada.
   *
   * O teste encena isso com um cookie NOVO para o mesmo e-mail — que é
   * exatamente o que o navegador do estranho faz.
   */
  const { rows: antes } = await db.query(
    "select texto, autoriza_depoimento from recados where galeria_id = $1 order by criado_em",
    [g.id],
  );
  const estranho = await identificar(EMAIL_DA_NOIVA); /* mesmo e-mail, outra sessão */
  const r = await mandar(estranho, { texto: "Não recomendo este fotógrafo", autoriza: true });
  if (!r.ok && r.status !== 409) throw new Error(`HTTP ${r.status}`);

  const { rows: depois } = await db.query(
    "select texto, autoriza_depoimento from recados where galeria_id = $1 order by criado_em",
    [g.id],
  );
  for (const [i, linha] of antes.entries()) {
    igual(depois[i]?.texto, linha.texto, `o texto ${i + 1} continua intacto`);
    igual(
      depois[i]?.autoriza_depoimento,
      linha.autoriza_depoimento,
      `a autorização ${i + 1} continua como estava`,
    );
  }
  return r.status === 409 ? "barrado pelo teto" : "o texto do estranho entrou ao lado, sem apagar nada";
});

await etapa("quem dá só o nome consegue deixar recado", async () => {
  /*
   * A tela diz "Seu e-mail (opcional)" em letra grande. A rota `eu` só aceitava
   * nome quando o motivo era "baixar" — então a Tia Marta escrevia o nome,
   * deixava o e-mail vazio como a tela permite, e levava um 400 de "e-mail
   * inválido" sem ter como passar. Esta etapa anda pelo caminho dela.
   */
  const r = await fetch(`${BASE}/api/g/${g.id}/eu`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: `Tia Marta ${Date.now()}`, email: "", motivo: "recado" }),
  });
  if (!r.ok) throw new Error(`identificar só com nome: HTTP ${r.status}`);
  const cookieDela = (r.headers.get("set-cookie") ?? "").split(";")[0];
  const envio = await mandar(cookieDela, { texto: "Lindas fotos, meus parabéns" });
  if (!envio.ok) throw new Error(`mandar: HTTP ${envio.status}`);
  const { rows } = await db.query(
    `select r.texto, p.nome, p.email from recados r
       join pessoas_da_galeria p on p.id = r.pessoa_id
      where r.galeria_id = $1 and p.nome like 'Tia Marta%'`,
    [g.id],
  );
  igual(rows.length, 1, "recados da Tia Marta");
  igual(rows[0].email, null, "sem e-mail, como ela deixou");
  return "nome basta";
});

await etapa("a mesma identidade tem teto de recados", async () => {
  const { MAX_RECADOS_POR_PESSOA } = await import("../src/lib/recados.ts");
  const quem = await identificar(`teto-${Date.now()}@exemplo.com`);
  let barrou = 0;
  for (let i = 0; i < MAX_RECADOS_POR_PESSOA + 2 && !barrou; i++) {
    const r = await mandar(quem, { texto: `recado ${i}` });
    if (r.status === 409) barrou = i + 1;
  }
  if (!barrou) throw new Error("escreveu sem limite com a mesma identidade");
  return `barrou no ${barrou}º (teto ${MAX_RECADOS_POR_PESSOA})`;
});

await etapa("cada pessoa tem o recado dela", async () => {
  const noivo = await identificar(`noivo-recado-${Date.now()}@exemplo.com`);
  const { rows: antes } = await db.query(
    "select count(*)::int as n from recados where galeria_id = $1",
    [g.id],
  );
  const r = await mandar(noivo, { texto: "Assino embaixo" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows: depois } = await db.query(
    `select count(*)::int as n from recados r
       join pessoas_da_galeria p on p.id = r.pessoa_id
      where r.galeria_id = $1 and p.email like 'noivo-recado-%'`,
    [g.id],
  );
  igual(depois[0].n, 1, "recados do noivo");
  const { rows: total } = await db.query(
    "select count(*)::int as n from recados where galeria_id = $1",
    [g.id],
  );
  igual(total[0].n, antes[0].n + 1, "uma linha nova, e só uma");
});

await etapa("o texto é aparado no teto do depoimento", async () => {
  /* Identidade nova: a noiva já gastou o teto dela nas etapas acima, e um 409
     aqui mediria o teto em vez da aparagem. */
  const quem = await identificar(`aparagem-${Date.now()}@exemplo.com`);
  const comprido = "z".repeat(TETO_DO_RECADO + 400);
  const r = await mandar(quem, { texto: comprido });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows } = await db.query(
    "select length(texto) as n from recados where galeria_id = $1 order by criado_em desc limit 1",
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

await etapa("estrelas DESLIGADAS com pergunta montada: a nota é ignorada", async () => {
  /*
   * A etapa media a coisa errada: sem pergunta nenhuma montada, o 422 vinha de
   * "não há nota válida", e trocar `config.estrelas ? ... : {}` por ignorar a
   * chave `recado_estrelas` por completo deixava tudo verde. Agora a pergunta
   * EXISTE e a chave está desligada — é só a chave que pode recusar a nota.
   */
  await ligar({ ativo: true, estrelas: false, perguntas: ["Como foi o atendimento?"] });
  const quem = await identificar(`sem-estrela-${Date.now()}@exemplo.com`);
  const r = await mandar(quem, { texto: "ok", notas: { "Como foi o atendimento?": 5 } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows } = await db.query(
    "select notas from recados where galeria_id = $1 order by criado_em desc limit 1",
    [g.id],
  );
  igual(Object.keys(rows[0].notas).length, 0, "notas gravadas com a chave desligada");

  /* E sem pergunta nenhuma, nota nem tem onde cair. */
  await ligar({ ativo: true, estrelas: false, perguntas: [] });
  const outro = await identificar(`so-nota-${Date.now()}@exemplo.com`);
  igual((await mandar(outro, { notas: { Atendimento: 5 } })).status, 422, "status sem pergunta");
  return "a chave manda";
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
