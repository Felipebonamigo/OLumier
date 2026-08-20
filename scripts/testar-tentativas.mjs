#!/usr/bin/env node
/**
 * Prova que senha errada não pode ser tentada infinitamente. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-tentativas.mjs
 *
 * O caso que importa é a senha da GALERIA: costuma ser curta ("anaepedro"), o
 * link circula em grupo de WhatsApp, e sem freio um script tenta milhares por
 * minuto até abrir o casamento inteiro.
 */
import {
  podeTentar,
  registrarErro,
  limparTentativas,
  emPalavras,
} from "../src/lib/tentativas.ts";

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
const igual = (a, b, oque) => {
  if (a !== b) throw new Error(`${oque}: esperava ${b}, veio ${a}`);
};

console.log("\nFreio de tentativas:\n");

await etapa("chave nova pode tentar", () => {
  igual(podeTentar("teste:nova").permitido, true, "primeira tentativa");
});

await etapa("erra sete vezes e ainda pode tentar", () => {
  const c = "teste:sete";
  for (let i = 0; i < 7; i++) {
    const r = registrarErro(c);
    if (!r.permitido) throw new Error(`travou cedo demais, na tentativa ${i + 1}`);
  }
  igual(podeTentar(c).permitido, true, "depois de 7 erros");
  return "limite ainda não estourou";
});

await etapa("na oitava, trava", () => {
  const c = "teste:oito";
  let ultimo;
  for (let i = 0; i < 8; i++) ultimo = registrarErro(c);
  igual(ultimo.permitido, false, "oitavo erro");
  if (!ultimo.esperarSeg || ultimo.esperarSeg < 60) {
    throw new Error(`espera curta demais: ${ultimo.esperarSeg}s`);
  }
  return `travado por ${emPalavras(ultimo.esperarSeg)}`;
});

await etapa("depois de travado, nem chega a conferir a senha", () => {
  const c = "teste:travado";
  for (let i = 0; i < 8; i++) registrarErro(c);
  const r = podeTentar(c);
  igual(r.permitido, false, "tentativa durante o castigo");
  if (!r.esperarSeg) throw new Error("não disse quanto falta");
  return "porta fechada antes do trabalho de conferir";
});

await etapa("acertar a senha limpa o histórico", () => {
  const c = "teste:acertou";
  for (let i = 0; i < 5; i++) registrarErro(c);
  limparTentativas(c);
  igual(podeTentar(c).permitido, true, "depois de acertar");
  // Importante: quem acertou não deve carregar o histórico de erros de antes,
  // senão errar cinco vezes e acertar deixaria a conta meio travada.
  for (let i = 0; i < 7; i++) {
    if (!registrarErro(c).permitido) throw new Error(`histórico não foi zerado (parou em ${i + 1})`);
  }
  return "contagem zerada";
});

await etapa("uma galeria travada NÃO trava as outras", () => {
  // Se o freio fosse global, um ataque a uma galeria derrubaria a entrega de
  // todos os outros casais do estúdio.
  const a = "galeria:aaa";
  const b = "galeria:bbb";
  for (let i = 0; i < 8; i++) registrarErro(a);
  igual(podeTentar(a).permitido, false, "a travada");
  igual(podeTentar(b).permitido, true, "b livre");
  return "isolamento por galeria";
});

await etapa("login e galeria não compartilham contagem", () => {
  const login = "login:alguem@exemplo.com";
  const galeria = "galeria:ccc";
  for (let i = 0; i < 8; i++) registrarErro(login);
  igual(podeTentar(login).permitido, false, "login travado");
  igual(podeTentar(galeria).permitido, true, "galeria livre");
});

await etapa("o recado fala em minutos, não em segundos", () => {
  igual(emPalavras(30), "um minuto", "30s");
  igual(emPalavras(900), "15 minutos", "900s");
});

if (falhou) {
  console.error("\n✗ o freio de tentativas tem problema\n");
  process.exit(1);
}
console.log("\n✓ senha errada trava depois de 8 tentativas, por galeria e por conta\n");
