#!/usr/bin/env node
/**
 * O NOME DO GRUPO DAS FOTOS SEM CAPÍTULO É DO FOTÓGRAFO. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-nome-do-grupo-solto.mjs
 *
 * ── DE ONDE VEIO (18/09/2026, migração 037) ───────────────────────────────
 *
 * Juan, com a foto da barra de capítulos da galeria dele: "aqui fica
 * aparecendo 'outras fotos', pelo que eu vi é todas as fotos juntas, não tem
 * como trocar pra esse nome. Tipo galeria completa ou algo assim. Ou eu não sei
 * se foi eu que fiz algo de errado kkkk, mas não criei nenhuma pasta com esse
 * nome."
 *
 * Ele não criou: desde 04/09/2026 a PÁGINA inventava "Outras fotos" para o que
 * sobrava, porque a alternativa era uma pastilha sem texto. O nome resolveu a
 * pastilha e criou este defeito — uma pasta que o dono da galeria não escreveu
 * e não conseguia trocar.
 *
 * ── O QUE ESTA SUÍTE PRENDE ───────────────────────────────────────────────
 *
 * Que o nome escolhido chegue nos TRÊS lugares em que ele aparece, porque eles
 * são calculados em arquivos diferentes e já divergiram antes:
 *
 *   a barra de capítulos    `g/[estudio]/[galeria]/page.tsx`
 *   o nome do arquivo       `lib/entrega-da-galeria.ts` (celular e computador)
 *   a tela do painel        `components/editor-secoes.tsx`
 *
 * E que o padrão continue sendo "Outras fotos" para as galerias que nunca
 * escreveram nada — que são todas as que existiam antes de hoje.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada, segundoEstudioDaRodada } from "./fixture-de-teste.mjs";
import { nomeDoGrupoSolto, GRUPO_SEM_CAPITULO } from "../src/lib/nome-de-arquivo.ts";
import { renomearGrupoSolto } from "../src/lib/secoes.ts";

exigirBancoDeTeste();

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const fonte = (p) => readFileSync(path.join(RAIZ, p), "utf8");

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

/* ── 1. O PADRÃO, sem tocar em banco nem em servidor ───────────────────── */

await etapa("sem nome escolhido, o grupo continua sendo “Outras fotos”", () => {
  for (const vazio of [null, undefined, "", "   ", "\n\t "]) {
    const saiu = nomeDoGrupoSolto(vazio);
    if (saiu !== GRUPO_SEM_CAPITULO) {
      throw new Error(`${JSON.stringify(vazio)} virou ${JSON.stringify(saiu)}`);
    }
  }
  return GRUPO_SEM_CAPITULO;
});

await etapa("o nome escolhido vale, sem espaço sobrando nas pontas", () => {
  if (nomeDoGrupoSolto("  Galeria completa  ") !== "Galeria completa") {
    throw new Error(nomeDoGrupoSolto("  Galeria completa  "));
  }
  return "Galeria completa";
});

await etapa("nome comprido é cortado no mesmo tamanho de um capítulo", () => {
  /* 60 é o limite de `renomearSecao`. Os dois viram prefixo de arquivo pelo
     mesmo caminho, então têm de caber igual — senão o nome do arquivo de uma
     foto solta passa do que o Windows aceita e o da Cerimônia não. */
  const cortado = nomeDoGrupoSolto("x".repeat(200));
  if (cortado.length !== 60) throw new Error(`ficou com ${cortado.length}`);
  return "60 caracteres";
});

/* ── 2. A gravação, e a tranca do estúdio ──────────────────────────────── */

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const lido = async (id) => {
  const { rows } = await db.query("select grupo_solto from galerias where id = $1", [id]);
  return rows[0]?.grupo_solto ?? null;
};

try {
  /* Três fotos: duas na Cerimônia, uma solta. Com um capítulo e o grupo das
     soltas a barra tem DUAS pastilhas — é o mínimo para ela ser desenhada, e é
     exatamente a galeria do print do Juan. */
  const g = await galeriaDaRodada(db, { nome: "grupo-solto", medias: 3, publicada: true });
  const {
    rows: [cerimonia],
  } = await db.query(
    "insert into secoes (galeria_id, nome, ordem, slug) values ($1,'Cerimônia',0,'cerimonia') returning id",
    [g.id],
  );
  await db.query("update medias set secao_id = $1 where id = any($2::uuid[])", [
    cerimonia.id,
    [g.midias[0].id, g.midias[1].id],
  ]);
  const url = `${BASE}/g/${g.tslug}/${g.gslug}`;
  const solta = g.midias[2];

  await etapa("o fotógrafo grava o nome dele", async () => {
    await renomearGrupoSolto(g.id, g.estudio.id, "  Galeria completa  ");
    const gravado = await lido(g.id);
    if (gravado !== "Galeria completa") throw new Error(`gravou ${JSON.stringify(gravado)}`);
    return gravado;
  });

  await etapa("o estúdio vizinho não renomeia a galeria de ninguém", async () => {
    const outro = await segundoEstudioDaRodada(db);
    await renomearGrupoSolto(g.id, outro.id, "Invasão");
    const gravado = await lido(g.id);
    if (gravado !== "Galeria completa") throw new Error(`o vizinho gravou ${JSON.stringify(gravado)}`);
    return "continua “Galeria completa”";
  });

  /* ── 3. Onde o cliente vê ────────────────────────────────────────────── */

  await etapa("a barra de capítulos mostra o nome escolhido", async () => {
    const html = await (await fetch(url, { cache: "no-store" })).text();
    if (!html.includes("Galeria completa")) throw new Error("o nome escolhido não apareceu");
    if (html.includes(GRUPO_SEM_CAPITULO)) {
      throw new Error("a galeria continua dizendo “Outras fotos” em algum lugar");
    }
    return "“Galeria completa” na pastilha";
  });

  await etapa("o nome do arquivo da foto solta leva o nome escolhido", async () => {
    /* O que o cliente ESCOLHE no menu e o que ele RECEBE no nome do arquivo têm
       de ser a mesma palavra — ver `lib/nome-de-arquivo.ts`. Esta rota é a
       lista do celular; o `Content-Disposition` do computador sai da mesma
       `nomeNaEntrega`. */
    const r = await fetch(`${BASE}/api/g/${g.id}/lista`, { cache: "no-store" });
    const corpo = await r.json();
    const dela = (corpo.fotos ?? []).find((f) => f.id === solta.id);
    if (dela?.nome !== `Galeria completa - ${solta.nome_original}`) {
      throw new Error(`saiu ${JSON.stringify(dela?.nome)}`);
    }
    return dela.nome;
  });

  await etapa("baixar essa pasta sozinha também leva o nome escolhido", async () => {
    const r = await fetch(`${BASE}/api/g/${g.id}/lista?cap=sem-capitulo`, { cache: "no-store" });
    const corpo = await r.json();
    if (corpo?.fotos?.length !== 1) throw new Error(`vieram ${corpo?.fotos?.length} fotos`);
    if (corpo.fotos[0].nome !== `Galeria completa - ${solta.nome_original}`) {
      throw new Error(`saiu ${JSON.stringify(corpo.fotos[0].nome)}`);
    }
    return "1 foto";
  });

  /* ── 4. Apagar o campo volta ao nome de fábrica ──────────────────────── */

  await etapa("campo vazio volta para “Outras fotos”, e não para pastilha sem letra", async () => {
    await renomearGrupoSolto(g.id, g.estudio.id, "   ");
    if ((await lido(g.id)) !== null) throw new Error("ficou texto gravado");
    const html = await (await fetch(url, { cache: "no-store" })).text();
    if (!html.includes(GRUPO_SEM_CAPITULO)) throw new Error("a pastilha voltou sem nome");
    if (html.includes("Galeria completa")) throw new Error("o nome antigo continua na tela");
    return GRUPO_SEM_CAPITULO;
  });

  /* ── 5. A COSTURA — onde eu já errei antes ───────────────────────────── */

  /*
   * As três etapas acima passariam com o painel MUDO: o nome viaja, mas
   * ninguém consegue escrevê-lo. Foi assim que a rolagem infinita quebrou em
   * 17/09/2026 — as duas metades testadas em separado, e o defeito no meio.
   * Estas conferem a costura entre a tela do painel e a coluna.
   */
  await etapa("o painel manda o nome gravado para a tela dos capítulos", () => {
    const pagina = fonte("src/app/painel/galerias/[id]/fotos/page.tsx");
    if (!/grupoSolto=\{galeria\.grupo_solto\}/.test(pagina)) {
      throw new Error("a aba Fotos não passa `grupoSolto` para o EditorSecoes");
    }
    return "grupoSolto={galeria.grupo_solto}";
  });

  await etapa("a tela dos capítulos oferece renomear o grupo das soltas", () => {
    const tela = fonte("src/components/editor-secoes.tsx");
    if (!tela.includes("renomearGrupoSoltoAction")) {
      throw new Error("a tela não chama a ação de renomear");
    }
    if (!tela.includes("nomeDoGrupoSolto(grupoSolto)")) {
      throw new Error("a tela não mostra o nome gravado");
    }
    /* O texto fixo de antes: a linha ANUNCIAVA "Outras fotos" em negrito e não
       dava como trocar. Se ele voltar, voltou o defeito do Juan. */
    if (/>\s*Outras fotos\s*</.test(tela)) {
      throw new Error("a tela voltou a escrever “Outras fotos” à mão");
    }
    return "renomear + o nome gravado";
  });

  await etapa("a galeria do cliente não tem mais o nome escrito à mão", () => {
    const pagina = fonte("src/app/g/[estudio]/[galeria]/page.tsx");
    if (/nome: temCapitulo \? "Outras fotos"/.test(pagina)) {
      throw new Error("o nome do grupo voltou a ser uma constante da página");
    }
    if (!pagina.includes("nomeDoGrupoSolto(galeria.grupo_solto)")) {
      throw new Error("a página não lê o nome da galeria");
    }
    return "nomeDoGrupoSolto(galeria.grupo_solto)";
  });
} finally {
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ o nome do grupo das fotos sem capítulo tem problema");
  process.exit(1);
}
console.log("\n✓ o grupo das fotos sem capítulo se chama o que o fotógrafo quiser");
