#!/usr/bin/env node
/**
 * A regra da senha nova, e as três telas que a usam. Uso:
 *
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-senha-nova.mjs
 *
 * ── O QUE ISTO FECHA ──────────────────────────────────────────────────────
 *
 * Digitar a senha uma vez só, escondida, e descobrir o erro de digitação
 * DEPOIS — na hora de entrar — é o jeito mais barato de perder uma conta recém
 * criada. Pior no cadastro que em qualquer outro lugar: a pessoa ainda não tem
 * "esqueci minha senha" configurado na cabeça, acabou de conhecer o produto, e
 * a conclusão dela é que o sistema quebrou.
 *
 * A confirmação já existia na troca de senha do painel (`trocarSenha`, caso
 * `diferentes`), e NÃO existia no cadastro nem na recuperação. Mesma regra,
 * três telas, duas sem ela — é assim que regra vira folclore.
 *
 * `conferirSenhaNova` é a regra pura, num lugar só. As três ações a chamam.
 *
 * O mínimo também estava escrito duas vezes: `MINIMO_SENHA` na recuperação e um
 * `8` cravado no cadastro. Dois números para a mesma regra é um deles ficar para
 * trás no dia em que mudar.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { MINIMO_SENHA, conferirSenhaNova } from "../src/lib/senha.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");
const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const ler = (p) => readFileSync(path.join(RAIZ, p), "utf8");

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

console.log("A senha nova:\n");

/* ── a regra ─────────────────────────────────────────────────────────────── */

await etapa("senha curta é recusada", () => {
  const curta = "a".repeat(MINIMO_SENHA - 1);
  if (conferirSenhaNova(curta, curta) !== "curta") throw new Error("passou senha curta demais");
});

await etapa("senha no tamanho exato passa", () => {
  const certa = "a".repeat(MINIMO_SENHA);
  if (conferirSenhaNova(certa, certa) !== null) throw new Error("recusou o tamanho mínimo");
  return `${MINIMO_SENHA} caracteres`;
});

await etapa("confirmação diferente é recusada", () => {
  if (conferirSenhaNova("senhaboa123", "senhabao123") !== "diferentes") {
    throw new Error("aceitou senha e confirmação diferentes — é o erro de digitação passando");
  }
});

await etapa("o tamanho é conferido ANTES da diferença", () => {
  /* Duas senhas curtas E diferentes têm dois problemas. Dizer "não conferem"
   * primeiro faria a pessoa corrigir a digitação e tomar OUTRO erro em seguida.
   * O primeiro recado tem de ser o que ela precisa resolver primeiro. */
  if (conferirSenhaNova("abc", "xyz") !== "curta") {
    throw new Error("reclamou da diferença antes do tamanho");
  }
});

await etapa("espaço no fim conta como diferença", () => {
  /* Não dá para aparar: espaço é caractere válido de senha, e aparar mudaria a
   * senha que a pessoa escolheu. Se ela digitou espaço num campo e não no
   * outro, são senhas diferentes mesmo — e é melhor descobrir agora. */
  if (conferirSenhaNova("senhaboa123", "senhaboa123 ") !== "diferentes") {
    throw new Error("tratou como iguais duas senhas que não são");
  }
});

/* ── a fiação: as três ações usam a regra ────────────────────────────────── */

await etapa("cadastro, recuperação e troca passam pela MESMA regra", () => {
  const auth = ler("src/app/(auth)/actions.ts");
  const painel = ler("src/app/painel/actions.ts");
  const lib = ler("src/lib/senha.ts");

  if (/senha\.length\s*<\s*8\b/.test(auth)) {
    throw new Error("o cadastro ainda tem o 8 cravado à mão, fora da regra");
  }
  const chamadas = (auth.match(/conferirSenhaNova\(/g) ?? []).length;
  if (chamadas < 2) {
    throw new Error(`(auth) chama a regra ${chamadas}x — cadastro e recuperação precisam das duas`);
  }
  if (!lib.includes("conferirSenhaNova(")) {
    throw new Error("trocarSenha não usa a regra — a terceira tela ficou com uma cópia dela");
  }
  if (!painel.includes("MINIMO_SENHA")) throw new Error("o painel perdeu o mínimo compartilhado");
  return "3 telas, 1 regra";
});

await etapa("o formulário de cadastro tem os dois campos", () => {
  const form = ler("src/app/(auth)/cadastrar/form.tsx");
  if (!/name="senha"/.test(form)) throw new Error("sumiu o campo de senha");
  if (!/name="senha_confirmacao"/.test(form)) {
    throw new Error("não há campo de confirmação — a regra existe e ninguém a alimenta");
  }
});

/* ── a tela, de verdade ──────────────────────────────────────────────────── */

await etapa("a página /cadastrar entrega os dois campos e o botão de ver", async () => {
  const html = await fetch(`${BASE}/cadastrar`).then((r) => r.text());
  if (!html.includes('name="senha"')) throw new Error("a página não tem o campo de senha");
  if (!html.includes('name="senha_confirmacao"')) {
    throw new Error("a página não tem o campo de confirmação");
  }
  if (!/mostrar a senha|ver a senha|Mostrar senha/i.test(html)) {
    throw new Error(
      "não há como ver a senha digitada — sem isso, confirmar duas vezes só dobra o trabalho " +
        "de quem já errou uma vez",
    );
  }
  return "dois campos e o olho";
});

console.log(falhou ? "\n✗ a senha nova tem problema" : "\n✓ senha nova ok");
process.exitCode = falhou ? 1 : 0;
