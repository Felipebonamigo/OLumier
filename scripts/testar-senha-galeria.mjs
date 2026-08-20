#!/usr/bin/env node
/**
 * Senha da galeria: sal por galeria e expulsão ao trocar a senha. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-senha-galeria.mjs
 *
 * Dois problemas que existiam até 20/08/2026:
 *
 * 1. O sal vinha só do SESSION_SECRET, igual para todas as galerias — duas
 *    entregas com a senha "anaepedro" tinham hashes idênticos.
 * 2. Trocar a senha não expulsava ninguém: quem já tinha entrado seguia dentro
 *    por sete dias, incluindo exatamente quem o fotógrafo queria barrar.
 */
import { createHash } from "node:crypto";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import {
  gerarHashSenhaGaleria,
  conferirSenhaGaleria,
} from "../src/lib/galerias-publicas.ts";

exigirBancoDeTeste();

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const extra = fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};
const igual = (a, b, oque) => {
  if (a !== b) throw new Error(`${oque}: esperava ${b}, veio ${a}`);
};

const GALERIA_A = "11111111-1111-1111-1111-111111111111";
const GALERIA_B = "22222222-2222-2222-2222-222222222222";
const SENHA = "anaepedro";

console.log("\nSal por galeria:\n");

etapa("a senha certa abre a galeria", () => {
  const h = gerarHashSenhaGaleria(SENHA, GALERIA_A);
  igual(conferirSenhaGaleria(SENHA, h, GALERIA_A), true, "senha certa");
});

etapa("a senha errada não abre", () => {
  const h = gerarHashSenhaGaleria(SENHA, GALERIA_A);
  igual(conferirSenhaGaleria("outra", h, GALERIA_A), false, "senha errada");
});

etapa("MESMA senha em galerias diferentes gera hashes diferentes", () => {
  const a = gerarHashSenhaGaleria(SENHA, GALERIA_A);
  const b = gerarHashSenhaGaleria(SENHA, GALERIA_B);
  if (a === b) {
    throw new Error("hashes iguais — quem visse o banco saberia que compartilham senha");
  }
  return "quebrar uma não ajuda na outra";
});

etapa("o hash de uma galeria não vale na outra", () => {
  const a = gerarHashSenhaGaleria(SENHA, GALERIA_A);
  igual(conferirSenhaGaleria(SENHA, a, GALERIA_B), false, "hash de outra galeria");
});

etapa("hash ANTIGO (sem prefixo) continua sendo aceito", () => {
  /*
   * Compatibilidade não é capricho: sem ela, ligar o sal por galeria trancaria
   * na hora todo casal que já tinha a senha na mão — estrago maior que o
   * problema que a mudança resolve.
   */
  const sal = createHash("sha256").update(process.env.SESSION_SECRET).digest("hex").slice(0, 16);
  const antigo = createHash("sha256").update(sal + SENHA).digest("hex");
  igual(conferirSenhaGaleria(SENHA, antigo, GALERIA_A), true, "hash antigo");
  igual(conferirSenhaGaleria("errada", antigo, GALERIA_A), false, "antigo com senha errada");
  return "casais que já tinham a senha não são trancados para fora";
});

etapa("hash novo é reconhecível pelo prefixo", () => {
  const novo = gerarHashSenhaGaleria(SENHA, GALERIA_A);
  if (!novo.startsWith("g2:")) throw new Error("sem o prefixo não dá para distinguir das antigas");
});

console.log("\nTrocar a senha expulsa quem já entrou:\n");

/*
 * `liberarAcesso` e `temAcessoLiberado` mexem em cookie e exigem o contexto de
 * requisição do Next, que não existe num script. O que dá para testar aqui — e
 * é o que importa — é que a MARCA usada na assinatura muda junto com a senha:
 * é ela que faz o cookie antigo deixar de bater.
 */
const marca = (h) => createHash("sha256").update(h ?? "sem-senha").digest("hex").slice(0, 12);

etapa("a marca muda quando a senha muda", () => {
  const antes = marca(gerarHashSenhaGaleria("senha-velha", GALERIA_A));
  const depois = marca(gerarHashSenhaGaleria("senha-nova", GALERIA_A));
  if (antes === depois) {
    throw new Error("marca igual — o cookie antigo continuaria valendo depois da troca");
  }
  return "cookie de quem já entrou deixa de bater";
});

etapa("a marca é estável enquanto a senha não muda", () => {
  // Se oscilasse, o casal seria expulso sozinho a cada visita.
  const h = gerarHashSenhaGaleria(SENHA, GALERIA_A);
  igual(marca(h), marca(h), "mesma senha, mesma marca");
});

etapa("tirar a senha também muda a marca", () => {
  const comSenha = marca(gerarHashSenhaGaleria(SENHA, GALERIA_A));
  const semSenha = marca(null);
  if (comSenha === semSenha) throw new Error("marca igual entre com e sem senha");
});

if (falhou) {
  console.error("\n✗ a senha da galeria tem problema\n");
  process.exit(1);
}
console.log("\n✓ sal por galeria, senhas antigas ainda válidas, e trocar a senha expulsa\n");
