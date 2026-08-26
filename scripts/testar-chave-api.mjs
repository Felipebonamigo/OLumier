#!/usr/bin/env node
/**
 * Testa a chave de API por estúdio. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-chave-api.mjs
 *
 * A chave é credencial de LONGA DURAÇÃO: diferente da sessão, ela não expira
 * sozinha e vive num arquivo de configuração na máquina do fotógrafo. Isso muda
 * o que precisa ficar preso aqui:
 *
 *   - o segredo NUNCA volta do banco. Se um dump virar acesso às galerias de
 *     alguém, a promessa da página de segurança cai junto;
 *   - chave de um estúdio não abre o de outro. É a única coisa que separa dois
 *     clientes no mesmo servidor;
 *   - revogar tem efeito IMEDIATO. Revogação que demora é revogação que não
 *     serve — quem revoga já sabe que a chave vazou;
 *   - escopo é conferido na conferência, não na rota. Se cada rota lembrar
 *     sozinha, uma vai esquecer.
 *
 * Ver docs/chave-de-api.md.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import {
  PREFIXO,
  gerarChave,
  conferirChave,
  listarChaves,
  revogarChave,
} from "../src/lib/chaves-api.ts";

await exigirBancoDeTeste();

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
async function etapa(nome, fn) {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

/* Dois estúdios: o teste de isolamento entre contas é o que mais importa aqui,
 * e ele precisa de um segundo tenant de verdade, não de um id inventado. */
const { rows: ts } = await db.query("select id, nome_estudio from tenants order by criado_em limit 2");
if (ts.length < 2) {
  console.error("✗ preciso de dois estúdios no banco de teste — crie outra conta em /cadastrar");
  process.exit(1);
}
const [estudio, outro] = ts;

console.log(`\nChave de API — estúdio: ${estudio.nome_estudio}\n`);

const criadas = [];
const novaChave = async (nome, escopo) => {
  const c = await gerarChave(estudio.id, nome, escopo);
  criadas.push(c.id);
  return c;
};

await etapa("a chave nasce com o prefixo da marca", async () => {
  const c = await novaChave("Lightroom do notebook", "envio");
  if (!c.segredo.startsWith(PREFIXO)) {
    throw new Error(`segredo não começa com ${PREFIXO}: ${c.segredo.slice(0, 12)}…`);
  }
  igual(c.prefixo.startsWith(PREFIXO), true, "prefixo guardado");
  return c.prefixo;
});

await etapa("o segredo não volta do banco — só o hash", async () => {
  const c = await novaChave("só hash", "envio");
  const { rows } = await db.query("select * from chaves_api where id = $1", [c.id]);
  const linha = rows[0];
  for (const [coluna, valor] of Object.entries(linha)) {
    if (typeof valor === "string" && valor.includes(c.segredo)) {
      throw new Error(`o segredo inteiro está na coluna ${coluna}`);
    }
  }
  /* A parte aleatória é o que não pode aparecer. O prefixo aparece de propósito:
   * é por ele que a linha é encontrada. */
  const aleatoria = c.segredo.slice(c.prefixo.length + 1);
  if (JSON.stringify(linha).includes(aleatoria)) throw new Error("a parte secreta está no banco");
  return "nenhuma coluna contém o segredo";
});

await etapa("a chave gerada confere e devolve o estúdio certo", async () => {
  const c = await novaChave("confere", "envio");
  const r = await conferirChave(c.segredo);
  if (!r) throw new Error("conferirChave devolveu null para chave válida");
  igual(r.tenantId, estudio.id, "tenant");
  igual(r.escopo, "envio", "escopo");
});

await etapa("chave de um estúdio não vira acesso ao outro", async () => {
  const c = await novaChave("isolamento", "envio");
  const r = await conferirChave(c.segredo);
  if (r.tenantId === outro.id) throw new Error("a chave abriu o estúdio errado");
  igual(r.tenantId, estudio.id, "tenant");
});

await etapa("um caractere trocado não confere", async () => {
  const c = await novaChave("adulterada", "envio");
  const ultimo = c.segredo.slice(-1);
  const trocado = c.segredo.slice(0, -1) + (ultimo === "a" ? "b" : "a");
  igual(await conferirChave(trocado), null, "chave adulterada");
});

await etapa("prefixo que não existe não confere e não estoura", async () => {
  igual(await conferirChave(`${PREFIXO}zzzzzz_naoexiste`), null, "prefixo inventado");
});

await etapa("lixo não confere", async () => {
  for (const v of ["", "   ", "Bearer", "ga_", "sem-prefixo-nenhum", null, undefined]) {
    igual(await conferirChave(v), null, `valor ${JSON.stringify(v)}`);
  }
});

await etapa("o escopo volta como foi gravado", async () => {
  const c = await novaChave("só leitura", "leitura");
  igual((await conferirChave(c.segredo)).escopo, "leitura", "escopo");
});

await etapa("conferir marca o último uso", async () => {
  const c = await novaChave("último uso", "envio");
  const antes = await db.query("select ultimo_uso_em from chaves_api where id = $1", [c.id]);
  igual(antes.rows[0].ultimo_uso_em, null, "antes do primeiro uso");
  await conferirChave(c.segredo);
  const depois = await db.query("select ultimo_uso_em from chaves_api where id = $1", [c.id]);
  if (!depois.rows[0].ultimo_uso_em) throw new Error("ultimo_uso_em continuou nulo");
  return "nasce nulo e é marcado no primeiro uso";
});

await etapa("revogada não confere mais", async () => {
  const c = await novaChave("revogar", "envio");
  if (!(await conferirChave(c.segredo))) throw new Error("não conferiu antes de revogar");
  igual(await revogarChave(c.id, estudio.id), true, "revogar");
  igual(await conferirChave(c.segredo), null, "depois de revogar");
});

await etapa("um estúdio não revoga a chave do outro", async () => {
  const c = await novaChave("alheia", "envio");
  igual(await revogarChave(c.id, outro.id), false, "revogar com o tenant errado");
  if (!(await conferirChave(c.segredo))) throw new Error("a chave foi revogada por quem não podia");
});

await etapa("listar mostra as ativas e esconde o segredo", async () => {
  const lista = await listarChaves(estudio.id);
  if (lista.length === 0) throw new Error("lista vazia");
  /* Conferir as COLUNAS devolvidas, não procurar a palavra "hash" no JSON: o
   * nome da chave é texto do fotógrafo e pode conter qualquer coisa — este
   * teste já se enganou sozinho com uma chave chamada "só hash". */
  const permitidas = ["id", "nome", "prefixo", "escopo", "criada_em", "ultimo_uso_em"];
  for (const c of lista) {
    const extras = Object.keys(c).filter((k) => !permitidas.includes(k));
    if (extras.length > 0) throw new Error(`a lista devolve coluna a mais: ${extras.join(", ")}`);
    if (!c.prefixo?.startsWith(PREFIXO)) throw new Error(`prefixo estranho: ${c.prefixo}`);
  }
  return `${lista.length} ativa(s), só as colunas públicas`;
});

/* Limpa só o que este teste criou. Chave de outra sessão fica onde está. */
if (criadas.length > 0) {
  await db.query("delete from chaves_api where id = any($1::uuid[])", [criadas]);
}
await db.end();

console.log(falhou ? "\n✗ chave de API com falha\n" : "\n✓ chave de API ok\n");
process.exit(falhou ? 1 : 0);
