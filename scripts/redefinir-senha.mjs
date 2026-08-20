#!/usr/bin/env node
/**
 * Define uma senha nova para um estúdio que perdeu a dele.
 *
 *   node --env-file=.env.production --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/redefinir-senha.mjs email@do.estudio
 *
 * POR QUE ISTO EXISTE: não há "esqueci minha senha" no app. Quem perde a senha
 * fica trancado para fora das próprias entregas, sem nenhum caminho de volta —
 * e isso vai acontecer com o primeiro fotógrafo que trocar de celular.
 *
 * O fluxo self-service (link por e-mail) depende de um remetente verificado no
 * Resend para fotonio.com.br, que ainda não existe: mandar "redefina sua senha
 * do Fotônio" de um endereço @atomatiza.com.br pareceria golpe, e ensinar
 * cliente a confiar em e-mail assim é pior que não ter o recurso. Enquanto
 * isso, isto resolve de verdade — só exige que você rode.
 *
 * A senha nova é sorteada aqui e mostrada UMA vez. Não guardamos em lugar
 * nenhum além do hash: passe para a pessoa por um canal que vocês já usam e
 * peça para ela trocar depois.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { gerarHashSenha } from "../src/lib/auth.ts";

const email = process.argv[2];
if (!email) {
  console.error("uso: ... scripts/redefinir-senha.mjs email@do.estudio");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const { rows } = await db.query(
    "select id, nome_estudio, email from tenants where lower(email) = lower($1)",
    [email],
  );
  if (rows.length === 0) {
    console.error(`\n✗ nenhum estúdio com o e-mail "${email}"\n`);
    process.exit(1);
  }
  const t = rows[0];

  // Sem caracteres ambíguos (0/O, 1/l/I): esta senha vai ser ditada ou digitada
  // à mão, e "não consigo entrar" por causa de um zero lido como ó é frustração
  // desnecessária.
  const alfabeto = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  const nova = [...bytes].map((b) => alfabeto[b % alfabeto.length]).join("");

  await db.query("update tenants set senha_hash = $1, atualizado_em = now() where id = $2", [
    await gerarHashSenha(nova),
    t.id,
  ]);

  console.log(`\n✓ senha redefinida para ${t.nome_estudio} (${t.email})\n`);
  console.log(`    ${nova}\n`);
  console.log("  Passe por um canal que vocês já usam e peça para trocar depois.");
  console.log("  Ela não fica guardada em lugar nenhum — se perder, rode de novo.\n");
} finally {
  await db.end();
}
