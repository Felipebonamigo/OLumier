#!/usr/bin/env node
/**
 * Testa o LEMBRETE DA SENHA DA GALERIA — a senha que o fotógrafo relê.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-lembrete-da-senha.mjs
 *
 * ── DE ONDE VEIO (24/09/2026) ─────────────────────────────────────────────
 *
 * Juan: "ao colocar a senha, ela some e eu não sei mais qual a senha".
 *
 * Era o produto funcionando como projetado: só o hash SHA-256 era guardado, e
 * hash não volta atrás. O projeto é que estava errado — o trabalho do fotógrafo
 * é CONTAR a senha ao casal junto com o link, e relê-la um mês depois quando a
 * mãe da noiva pedir. Esquecer obrigava a TROCAR, e trocar derruba todo mundo
 * que já tinha recebido a antiga.
 *
 * O que este teste prende:
 *   1. o que se cifra é o que se lê de volta — acento, espaço e emoji inclusive;
 *   2. duas galerias com a MESMA senha produzem textos cifrados diferentes,
 *      senão a coluna denunciaria quem usou "anaepedro";
 *   3. texto adulterado no banco NÃO devolve lixo: devolve nada;
 *   4. senha anterior à migração 042 devolve nada, e a tela diz isso;
 *   5. o HASH continua sendo a autoridade, e os dois nunca divergem —
 *      mostrar uma senha que não abre a galeria é pior que não mostrar nada.
 */
import { cifrarSenha, decifrarSenha } from "../src/lib/senha-da-galeria.ts";
import { gerarHashSenhaGaleria, conferirSenhaGaleria } from "../src/lib/galerias-publicas.ts";

let falhou = false;
function etapa(nome, fn) {
  try {
    const detalhe = fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

console.log("o que entra é o que sai");

etapa("ida e volta, com o que gente digita de verdade", () => {
  const senhas = [
    "anaepedro",
    "Júlia & Gustavo 2026",
    "  espaços  nas  pontas  ",
    "acentuação çãõ",
    "emoji 💍",
    "a",
    "x".repeat(200),
  ];
  for (const s of senhas) {
    igual(decifrarSenha(cifrarSenha(s)), s, `ida e volta de ${JSON.stringify(s.slice(0, 20))}`);
  }
  return `${senhas.length} senhas`;
});

etapa("senha vazia não vira lembrete nenhum", () => {
  igual(cifrarSenha(""), null, "vazia");
  igual(decifrarSenha(null), null, "nulo");
  igual(decifrarSenha(undefined), null, "indefinido");
});

/*
 * Sem IV sorteado, duas galerias com "anaepedro" teriam a MESMA coluna — e
 * quem olhasse o banco saberia, sem decifrar nada, quais galerias compartilham
 * senha. É o vazamento clássico de cifra determinística.
 */
etapa("a mesma senha cifra diferente a cada vez", () => {
  const a = cifrarSenha("anaepedro");
  const b = cifrarSenha("anaepedro");
  if (a === b) throw new Error("duas cifragens da mesma senha saíram idênticas");
  igual(decifrarSenha(a), "anaepedro", "primeira");
  igual(decifrarSenha(b), "anaepedro", "segunda");
});

console.log("\no que não pode virar lixo na tela");

etapa("coluna adulterada devolve nada, e não um texto qualquer", () => {
  const bom = cifrarSenha("anaepedro");
  /* Vira um bit do corpo. Com GCM a etiqueta não bate e a decifragem falha —
     sem ela, sairia lixo, e a tela diria "a sua senha é <lixo>". */
  const partes = bom.slice(3).split(".");
  const corpo = Buffer.from(partes[2], "base64url");
  corpo[0] ^= 1;
  partes[2] = corpo.toString("base64url");
  igual(decifrarSenha("v1:" + partes.join(".")), null, "corpo adulterado");

  for (const lixo of ["", "v1:", "v1:aaa", "nada disso", "v2:abc.def.ghi", "v1:a.b"]) {
    igual(decifrarSenha(lixo), null, `lixo ${JSON.stringify(lixo)}`);
  }
  return "1 bit virado + 6 entradas inválidas";
});

etapa("senha anterior à migração 042 devolve nada", () => {
  /* Aquelas galerias têm `senha_hash` e `senha_cifrada` nulo: a tela precisa
     dizer que não dá para mostrar, em vez de estourar. */
  igual(decifrarSenha(null), null, "coluna nula");
});

console.log("\no hash continua mandando");

/*
 * O TESTE QUE IMPEDE A TELA DE MENTIR.
 *
 * `senha_hash` é quem confere quem entra na galeria; `senha_cifrada` é só o
 * lembrete. Se a tela mostrasse uma senha que o hash não aceita, o fotógrafo
 * mandaria ao casal uma senha que não abre — pior que não mostrar nada.
 */
etapa("a senha que a tela mostra é a que abre a galeria", () => {
  const galeriaId = "11111111-1111-4111-8111-111111111111";
  for (const original of ["anaepedro", "Júlia & Gustavo 2026", "emoji 💍"]) {
    const hash = gerarHashSenhaGaleria(original, galeriaId);
    const mostrada = decifrarSenha(cifrarSenha(original));
    if (!conferirSenhaGaleria(mostrada, hash, galeriaId)) {
      throw new Error(`a senha mostrada não abre a galeria: ${JSON.stringify(original)}`);
    }
  }
  return "3 senhas conferidas contra o hash";
});

etapa("senha errada continua sendo recusada", () => {
  const galeriaId = "22222222-2222-4222-8222-222222222222";
  const hash = gerarHashSenhaGaleria("anaepedro", galeriaId);
  for (const errada of ["anaepedr", "Anaepedro", "anaepedro ", ""]) {
    if (conferirSenhaGaleria(errada, hash, galeriaId)) {
      throw new Error(`aceitou a senha errada ${JSON.stringify(errada)}`);
    }
  }
  return "4 recusadas";
});

etapa("o lembrete NÃO é o hash — são colunas de naturezas diferentes", () => {
  const cifrada = cifrarSenha("anaepedro");
  const hash = gerarHashSenhaGaleria("anaepedro", "33333333-3333-4333-8333-333333333333");
  if (cifrada === hash) throw new Error("as duas colunas guardam a mesma coisa");
  if (cifrada.includes("anaepedro")) throw new Error("a senha aparece legível na coluna");
});

console.log(falhou ? "\n✗ o lembrete da senha tem problema\n" : "\n✓ lembrete da senha ok\n");
process.exit(falhou ? 1 : 0);
