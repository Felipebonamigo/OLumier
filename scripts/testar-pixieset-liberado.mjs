#!/usr/bin/env node
/**
 * O botão "Permitir Pixieset" do admin (migração 051). Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-pixieset-liberado.mjs
 *
 * Felipe, 30/09/2026: "deixa desabilitado o botão de logar no pixieset por
 * enquanto, para todos, só vamos habilitar para os usuários que eu apontar" —
 * e depois: "crie essa opção, para liberar, lá no admin".
 *
 * O que prende:
 *
 *   1. Ninguém nasce liberado.
 *   2. Liberar grava o carimbo e deixa rastro na auditoria, com quem fez.
 *   3. Apertar de novo (página atrasada) não mexe no carimbo nem repete o
 *      evento.
 *   4. Bloquear volta ao nulo, também com rastro.
 *   5. A ação confere o admin ANTES de escrever — `"use server"` é endpoint
 *      aberto a qualquer sessão, e o portão da página não protege a ação.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";

const { definirPixiesetLiberado } = await import("../src/lib/acesso-pixieset.ts");
const { loginDoPixiesetLiberado } = await import("../src/config/pixieset.ts");
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

console.log("Permitir Pixieset no admin:\n");

const estudio = await estudioDaRodada(db);
const ler = async () =>
  (await db.query("select pixieset_liberado_em from tenants where id = $1", [estudio.id])).rows[0];
const eventos = async (acao) =>
  (
    await db.query("select detalhe from eventos where tenant_id = $1 and acao = $2", [
      estudio.id,
      acao,
    ])
  ).rows;

await etapa("ninguém nasce liberado", async () => {
  const linha = await ler();
  if (linha.pixieset_liberado_em !== null) throw new Error("estúdio novo já veio liberado");
  if (loginDoPixiesetLiberado(linha)) throw new Error("a regra liberou um nulo");
});

let carimbo;
await etapa("liberar grava o carimbo e registra quem fez", async () => {
  const r = await definirPixiesetLiberado(estudio.id, true, ADMIN);
  if (r !== "liberado") throw new Error(`respondeu ${r}`);
  const linha = await ler();
  if (!linha.pixieset_liberado_em) throw new Error("não gravou o carimbo");
  if (!loginDoPixiesetLiberado(linha)) throw new Error("a regra não reconheceu");
  carimbo = linha.pixieset_liberado_em.getTime();
  const ev = await eventos("pixieset.liberado");
  /* O e-mail do admin vai em hash, nunca cru: o registro é imutável. */
  if (ev.length !== 1 || ev[0].detalhe?.por_hash !== hashDeEmail(ADMIN.email) || ev[0].detalhe?.por) {
    throw new Error(`auditoria: ${JSON.stringify(ev)}`);
  }
  return `por ${ev[0].detalhe.adminId}`;
});

await etapa("apertar de novo não mexe no carimbo nem repete o evento", async () => {
  const r = await definirPixiesetLiberado(estudio.id, true, ADMIN);
  if (r !== "sem-mudanca") throw new Error(`respondeu ${r}`);
  if ((await ler()).pixieset_liberado_em.getTime() !== carimbo) throw new Error("o carimbo mudou");
  if ((await eventos("pixieset.liberado")).length !== 1) throw new Error("evento repetido");
});

await etapa("bloquear volta ao nulo, com rastro", async () => {
  const r = await definirPixiesetLiberado(estudio.id, false, ADMIN);
  if (r !== "bloqueado") throw new Error(`respondeu ${r}`);
  if ((await ler()).pixieset_liberado_em !== null) throw new Error("continuou liberado");
  if ((await eventos("pixieset.bloqueado")).length !== 1) throw new Error("sem evento de bloqueio");
});

await etapa("estúdio que não existe não vira linha nova", async () => {
  const r = await definirPixiesetLiberado("11111111-1111-1111-1111-111111111111", true, ADMIN);
  if (r !== "nao-existe") throw new Error(`respondeu ${r}`);
});

await etapa("a ação confere o admin antes de escrever", () => {
  const fonte = readFileSync(
    new URL("../src/app/painel/admin/estudios/[id]/actions.ts", import.meta.url),
    "utf8",
  );
  const portao = fonte.indexOf("adminDaRequisicao()");
  const escrita = fonte.indexOf("definirPixiesetLiberado(");
  if (portao < 0) throw new Error("a ação não chama o portão do admin");
  if (escrita < 0 || escrita < portao) throw new Error("a escrita vem antes do portão");
  if (!/if \(!admin\) notFound\(\)/.test(fonte)) throw new Error("quem não é admin não recebe 404");
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o botão do Pixieset tem problema" : "\n✓ só o admin libera, e fica registrado");
process.exit(falhou ? 1 : 0);
