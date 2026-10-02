#!/usr/bin/env node
/**
 * Os botões "Permitir Pixieset" e "Permitir Pixellu" do admin (migrações 051 e
 * 053). Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-login-liberado.mjs
 *
 * Felipe, 30/09/2026: "deixa desabilitado o botão de logar no pixieset por
 * enquanto, para todos, só vamos habilitar para os usuários que eu apontar";
 * "crie essa opção, para liberar, lá no admin"; e "crie a opção Login com a
 * conta do Pixellu, igual foi feito para o pixieset, só eu posso habilitar
 * pelo menu admin".
 *
 * O que prende, para CADA plataforma da lista:
 *
 *   1. Ninguém nasce liberado.
 *   2. Liberar grava o carimbo e deixa rastro na auditoria, com quem fez — e
 *      só na coluna daquela plataforma.
 *   3. Apertar de novo (página atrasada) não mexe no carimbo nem repete o
 *      evento.
 *   4. Bloquear volta ao nulo, também com rastro.
 *   5. A ação confere o admin ANTES de escrever — `"use server"` é endpoint
 *      aberto a qualquer sessão — e confere a plataforma contra a lista, porque
 *      ela vira nome de coluna no SQL.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";

const { definirLoginLiberado } = await import("../src/lib/acesso-plataforma.ts");
const { PLATAFORMAS, loginLiberado } = await import("../src/config/plataformas-de-origem.ts");
const { hashDeEmail } = await import("../src/lib/ip.ts");

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

const ADMIN = { id: "00000000-0000-0000-0000-000000000000", email: "admin@teste.local" };

const estudio = await estudioDaRodada(db);
const ler = async () =>
  (
    await db.query("select pixieset_liberado_em, pixellu_liberado_em from tenants where id = $1", [
      estudio.id,
    ])
  ).rows[0];
const eventos = async (acao) =>
  (
    await db.query("select detalhe from eventos where tenant_id = $1 and acao = $2", [
      estudio.id,
      acao,
    ])
  ).rows;

for (const p of PLATAFORMAS) {
  console.log(`\nPermitir ${p.nome} no admin:\n`);
  const outra = PLATAFORMAS.find((x) => x.id !== p.id);

  await etapa("ninguém nasce liberado", async () => {
    const linha = await ler();
    if (linha[p.coluna] !== null) throw new Error("estúdio novo já veio liberado");
    if (loginLiberado(linha, p.id)) throw new Error("a regra liberou um nulo");
  });

  let carimbo;
  await etapa("liberar grava o carimbo e registra quem fez", async () => {
    const r = await definirLoginLiberado(estudio.id, p.id, true, ADMIN);
    if (r !== "liberado") throw new Error(`respondeu ${r}`);
    const linha = await ler();
    if (!linha[p.coluna]) throw new Error("não gravou o carimbo");
    if (!loginLiberado(linha, p.id)) throw new Error("a regra não reconheceu");
    if (outra && linha[outra.coluna] !== null) throw new Error(`liberou o ${outra.nome} junto`);
    carimbo = linha[p.coluna].getTime();
    const ev = await eventos(`${p.id}.liberado`);
    /* O e-mail do admin vai em hash, nunca cru: o registro é imutável. */
    if (
      ev.length !== 1 ||
      ev[0].detalhe?.por_hash !== hashDeEmail(ADMIN.email) ||
      ev[0].detalhe?.por ||
      ev[0].detalhe?.plataforma !== p.id
    ) {
      throw new Error(`auditoria: ${JSON.stringify(ev)}`);
    }
    return `por ${ev[0].detalhe.adminId}`;
  });

  await etapa("apertar de novo não mexe no carimbo nem repete o evento", async () => {
    const r = await definirLoginLiberado(estudio.id, p.id, true, ADMIN);
    if (r !== "sem-mudanca") throw new Error(`respondeu ${r}`);
    if ((await ler())[p.coluna].getTime() !== carimbo) throw new Error("o carimbo mudou");
    if ((await eventos(`${p.id}.liberado`)).length !== 1) throw new Error("evento repetido");
  });

  await etapa("bloquear volta ao nulo, com rastro", async () => {
    const r = await definirLoginLiberado(estudio.id, p.id, false, ADMIN);
    if (r !== "bloqueado") throw new Error(`respondeu ${r}`);
    if ((await ler())[p.coluna] !== null) throw new Error("continuou liberado");
    if ((await eventos(`${p.id}.bloqueado`)).length !== 1) throw new Error("sem evento de bloqueio");
  });

  await etapa("estúdio que não existe não vira linha nova", async () => {
    const r = await definirLoginLiberado("11111111-1111-1111-1111-111111111111", p.id, true, ADMIN);
    if (r !== "nao-existe") throw new Error(`respondeu ${r}`);
  });
}

console.log("\nA porta:\n");

await etapa("plataforma fora da lista não chega ao banco", async () => {
  const r = await definirLoginLiberado(estudio.id, "email = null, senha_hash", true, ADMIN);
  if (r !== "nao-existe") throw new Error(`respondeu ${r}`);
});

await etapa("a ação confere o admin e a plataforma antes de escrever", () => {
  const fonte = readFileSync(
    new URL("../src/app/painel/admin/estudios/[id]/actions.ts", import.meta.url),
    "utf8",
  );
  const portao = fonte.indexOf("adminDaRequisicao()");
  const lista = fonte.indexOf("plataformaPorId(");
  const escrita = fonte.indexOf("definirLoginLiberado(");
  if (portao < 0) throw new Error("a ação não chama o portão do admin");
  if (lista < 0) throw new Error("a ação não confere a plataforma contra a lista");
  if (escrita < 0 || escrita < portao || escrita < lista) {
    throw new Error("a escrita vem antes do portão ou da lista");
  }
  if (!/if \(!admin\) notFound\(\)/.test(fonte)) throw new Error("quem não é admin não recebe 404");
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ os botões de login têm problema" : "\n✓ só o admin libera, cada plataforma na sua, e fica registrado");
process.exit(falhou ? 1 : 0);
