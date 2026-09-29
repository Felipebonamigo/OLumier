#!/usr/bin/env node
/**
 * QUANDO O FOTÓGRAFO ENTROU PELA ÚLTIMA VEZ. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-ultimo-acesso-do-estudio.mjs
 *
 * Precisa do banco. Não precisa do servidor: chama `marcarAcessoDoEstudio`
 * direto, que é onde a regra mora.
 *
 * ── O PEDIDO (29/09/2026) ─────────────────────────────────────────────────
 *
 * A tabela do admin ganhou uma coluna "Último acesso" que mostra quando o
 * CLIENTE abriu a galeria. Eu avisei que o acesso do FOTÓGRAFO não existia no
 * banco — não há carimbo de login em lugar nenhum — e que criá-lo seria uma
 * migração mais uma escrita a cada requisição autenticada. Felipe: "pode fazer
 * também".
 *
 * ── A TRAVA DE TEMPO É O DESENHO INTEIRO ──────────────────────────────────
 *
 * Sem ela, cada página do painel gravaria uma linha em `tenants` — e são várias
 * requisições por minuto de quem está trabalhando, todas escrevendo a mesma
 * informação com um segundo de diferença. Com a trava de 15 minutos, quem passa
 * a tarde inteira montando uma galeria gera no máximo 4 escritas por hora.
 *
 * E a trava vive NO `where` DO UPDATE, não num `select` antes dele. Ler para
 * depois decidir abre uma corrida: duas requisições simultâneas leem a mesma
 * marca velha e as duas gravam. No `where`, o banco resolve — a segunda casa
 * zero linhas e não faz nada. É a mesma razão pela qual `criarSecao` confere
 * repetido dentro da consulta.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { marcarAcessoDoEstudio, JANELA_DE_ACESSO_MIN } from "../src/lib/acesso-do-estudio.ts";

exigirBancoDeTeste();

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

const t = await estudioDaRodada(db, { nome: "acesso-do-estudio" });
const marca = async () => {
  const { rows } = await db.query("select ultimo_acesso_em from tenants where id = $1", [t.id]);
  return rows[0]?.ultimo_acesso_em ?? null;
};

console.log("O carimbo de acesso do estúdio\n");

await etapa("a coluna existe e nasce vazia", async () => {
  const { rows } = await db.query(
    `select column_name, data_type from information_schema.columns
      where table_name = 'tenants' and column_name = 'ultimo_acesso_em'`,
  );
  if (rows.length === 0) throw new Error("tenants.ultimo_acesso_em não existe — falta a migração");
  if (!/timestamp/.test(rows[0].data_type)) {
    throw new Error(`a coluna é ${rows[0].data_type}, e não um timestamp`);
  }
  if ((await marca()) !== null) throw new Error("estúdio novo já nasceu com acesso marcado");
  return rows[0].data_type;
});

await etapa("a primeira passagem grava a marca", async () => {
  await marcarAcessoDoEstudio(t.id);
  const m = await marca();
  if (!m) throw new Error("nada foi gravado");
  const idade = Date.now() - new Date(m).getTime();
  if (idade > 60_000) throw new Error(`a marca veio velha (${Math.round(idade / 1000)}s)`);
  return "agora";
});

await etapa("dentro da janela, NÃO grava de novo", async () => {
  /*
   * É o ponto do desenho: se gravasse, seria uma escrita por requisição —
   * exatamente o custo que fez isto não ser feito por conta própria.
   */
  const antes = await marca();
  await marcarAcessoDoEstudio(t.id);
  await marcarAcessoDoEstudio(t.id);
  await marcarAcessoDoEstudio(t.id);
  const depois = await marca();
  if (new Date(antes).getTime() !== new Date(depois).getTime()) {
    throw new Error("três passagens seguidas gravaram — a trava de tempo não está no where");
  }
  return `${JANELA_DE_ACESSO_MIN} min de trava`;
});

await etapa("passada a janela, grava de novo", async () => {
  /* Envelhecer a marca à mão é o único jeito de testar isto sem esperar 15
     minutos — e é honesto, porque o que se está conferindo é o `where`. */
  await db.query(
    `update tenants set ultimo_acesso_em = now() - ($2 || ' minutes')::interval where id = $1`,
    [t.id, JANELA_DE_ACESSO_MIN + 1],
  );
  const antes = await marca();
  await marcarAcessoDoEstudio(t.id);
  const depois = await marca();
  if (new Date(depois).getTime() <= new Date(antes).getTime()) {
    throw new Error("a marca velha não foi atualizada");
  }
  return "atualizou";
});

await etapa("id que não existe não quebra nem cria linha", async () => {
  /* A sessão pode apontar para uma conta apagada no meio do caminho — e isso
     não pode virar exceção numa página que só queria se desenhar. */
  const { rows: antes } = await db.query("select count(*)::int n from tenants");
  await marcarAcessoDoEstudio("00000000-0000-0000-0000-000000000000");
  const { rows: depois } = await db.query("select count(*)::int n from tenants");
  if (antes[0].n !== depois[0].n) throw new Error("criou linha para um id inexistente");
  return "no-op";
});

await etapa("o panorama do admin devolve a marca", async () => {
  const { panoramaDosEstudios } = await import("../src/lib/admin.ts");
  const linhas = await panoramaDosEstudios();
  const linha = linhas.find((l) => l.id === t.id);
  if (!linha) throw new Error("o estúdio da bancada não apareceu no panorama");
  if (!("ultimo_acesso_estudio" in linha)) {
    throw new Error("o panorama não traz `ultimo_acesso_estudio` — a coluna do admin ficaria vazia");
  }
  if (!linha.ultimo_acesso_estudio) throw new Error("veio nula, e a marca foi gravada acima");
  return "presente";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o acesso do estúdio não fecha" : "\n✓ acesso do estúdio ok");
process.exitCode = falhou ? 1 : 0;
