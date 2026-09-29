#!/usr/bin/env node
/**
 * A carência depois do trial vencido. Uso:
 *
 *   node --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-carencia-pos-trial.mjs
 *
 * Regra pura mais conferência de fiação — não precisa de servidor nem de banco.
 *
 * ── A REGRA ───────────────────────────────────────────────────────────────
 * Até 27/08/2026 o trial vencido travava o ENVIO e as galerias publicadas
 * ficavam no ar para sempre. O teto de 10 GB limita quanto cada trial
 * abandonado custa, mas não limita POR QUANTO TEMPO — e "para sempre" não tem
 * teto nenhum.
 *
 * Agora o estúdio tem 15 dias depois do fim do teste. Depois disso a galeria sai
 * do ar para o visitante.
 *
 * O que a regra NÃO faz, e é metade do desenho:
 *
 *  - não apaga nada. Os arquivos ficam; pagar devolve a galeria na hora. A
 *    diferença entre "sai do ar" e "foi apagado" é a diferença entre um cliente
 *    irritado e um processo.
 *  - não alcança `cancelado` nem `inadimplente`. Os recados desses dois estados
 *    PROMETEM, em texto, que as galerias publicadas continuam no ar. Estender a
 *    carência a eles de carona transformaria uma promessa escrita em mentira
 *    sem ninguém decidir isso.
 *  - não é estado: nada é gravado. É `trial_ate` mais 15 dias, lido na hora. No
 *    dia em que o pagamento confirma, `status` vira `ativo` e a regra para de
 *    valer sozinha — sem webhook precisar desfazer nada.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { CARENCIA_POS_TRIAL_DIAS } from "../src/config/trial.ts";
import { galeriasNoAr } from "../src/lib/assinatura.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");

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

/* Os casos abaixo são os da cobrança LIGADA — é quando a carência vale. O caso
 * desligado tem etapa própria, mais abaixo. */
const LIGADA = true;

const DIA = 24 * 60 * 60 * 1000;
const haDias = (n) => new Date(Date.now() - n * DIA);
const emDias = (n) => new Date(Date.now() + n * DIA);

console.log("A carência depois do trial:\n");

etapa("a carência é de 15 dias", () => {
  if (CARENCIA_POS_TRIAL_DIAS !== 15) {
    throw new Error(`está em ${CARENCIA_POS_TRIAL_DIAS} dias`);
  }
});

etapa("trial em dia: galerias no ar", () => {
  if (!galeriasNoAr({ status: "trial", trial_ate: emDias(3) }, LIGADA)) {
    throw new Error("derrubou quem ainda está testando");
  }
});

etapa("trial vencido há 1 dia: ainda no ar", () => {
  if (!galeriasNoAr({ status: "trial", trial_ate: haDias(1) }, LIGADA)) {
    throw new Error("derrubou no dia seguinte ao fim do teste, sem carência nenhuma");
  }
  return "a carência existe";
});

etapa("trial vencido há 14 dias: ainda no ar", () => {
  if (!galeriasNoAr({ status: "trial", trial_ate: haDias(14) }, LIGADA)) {
    throw new Error("caiu um dia antes da hora");
  }
});

etapa("trial vencido há 16 dias: FORA do ar", () => {
  if (galeriasNoAr({ status: "trial", trial_ate: haDias(16) }, LIGADA)) {
    throw new Error("a carência não termina nunca — é o 'para sempre' de antes");
  }
  return "sai do ar depois de 15 dias";
});

etapa("quem PAGOU volta ao ar, mesmo com trial_ate velho", () => {
  /* O webhook põe `status = 'ativo'` e zera `trial_ate`, mas um estúdio antigo
   * pode ter os dois preenchidos. Se a regra olhasse só a data, quem pagou
   * continuaria fora do ar — a pior falha possível desta função. */
  if (!galeriasNoAr({ status: "ativo", trial_ate: haDias(90) }, LIGADA)) {
    throw new Error("estúdio pagante fora do ar por causa de uma data velha");
  }
});

etapa("cancelado NÃO é alcançado pela carência", () => {
  /* O recado de `cancelado` promete, em texto, que as galerias continuam no ar.
   * A carência é a régua do TRIAL. */
  if (!galeriasNoAr({ status: "cancelado", trial_ate: haDias(90) }, LIGADA)) {
    throw new Error("estendeu a carência ao cancelado e desmentiu o recado da tela");
  }
});

etapa("inadimplente NÃO é alcançado pela carência", () => {
  if (!galeriasNoAr({ status: "inadimplente", trial_ate: haDias(90) }, LIGADA)) {
    throw new Error("boleto atrasado tirou a galeria do casal do ar");
  }
});

etapa("status desconhecido fica no ar", () => {
  /* Mesma regra do portão de cobrança e do teto: um estado que ninguém previu
   * não pode derrubar a entrega de quem está pagando. */
  if (!galeriasNoAr({ status: "seja-la-o-que-for", trial_ate: haDias(90) }, LIGADA)) {
    throw new Error("status novo virou galeria fora do ar");
  }
});

etapa("trial sem data nenhuma fica no ar", () => {
  if (!galeriasNoAr({ status: "trial", trial_ate: null }, LIGADA)) {
    throw new Error("sem data para contar, a regra derrubou por via das dúvidas");
  }
});

/*
 * COBRANÇA DESLIGADA — 29/09/2026.
 *
 * O teste vencido não pode derrubar a entrega quando não existe como pagar. Foi
 * o que acontecia: a Conta dizia "o uso segue liberado", e a galeria do cliente
 * saía do ar 15 dias depois do fim do teste, com a cobrança desligada no
 * servidor e nenhuma porta para o fotógrafo resolver.
 */
etapa("com a cobrança desligada, nenhuma galeria sai do ar", () => {
  for (const dias of [16, 60, 400]) {
    if (!galeriasNoAr({ status: "trial", trial_ate: haDias(dias) }, false)) {
      throw new Error(`teste vencido há ${dias} dias derrubou a galeria sem haver como pagar`);
    }
  }
});

etapa("todos os chamadores dizem se a cobrança está ligada", () => {
  const arquivos = [
    "src/app/g/[estudio]/[galeria]/page.tsx",
    "src/app/api/g/[id]/urls/route.ts",
    "src/app/api/g/[id]/mais/route.ts",
    "src/lib/entrega-da-galeria.ts",
    // Os dois da ponte com o Atomatiza. Entram aqui pelo mesmo motivo dos de
    // cima, e por um a mais: o que eles respondem vira frase na tela de quem
    // vende ("as fotos estão no ar"). Divergir da régua da página pública
    // seria o contrato afirmar o contrário do que o link faz.
    "src/lib/avisos.ts",
    "src/app/api/galerias/[id]/route.ts",
  ];
  for (const p of arquivos) {
    const fonte = readFileSync(path.join(RAIZ, p), "utf8");
    const chamadas = fonte.match(/galeriasNoAr\([^;]*\)/g) ?? [];
    if (chamadas.length === 0) throw new Error(`${p} não chama a regra`);
    for (const c of chamadas) {
      if (!c.includes("asaasConfigurado()")) throw new Error(`${p} chama a regra sem dizer se a cobrança está ligada`);
    }
  }
});

/* ── fiação ──────────────────────────────────────────────────────────────── */

etapa("a galeria pública consulta a regra", () => {
  const p = "src/app/g/[estudio]/[galeria]/page.tsx";
  const fonte = readFileSync(path.join(RAIZ, p), "utf8");
  if (!fonte.includes("galeriasNoAr")) {
    throw new Error(`${p} não chama a regra — ela existe e não protege nada`);
  }
});

etapa("a consulta pública traz status e trial_ate do estúdio", () => {
  /* Sem estas duas colunas no SELECT a regra recebe `undefined` e devolve "no
   * ar" para todo mundo — falha silenciosa, do tipo que nenhuma tela denuncia. */
  const fonte = readFileSync(path.join(RAIZ, "src/lib/galerias-publicas.ts"), "utf8");
  for (const coluna of ["t.status", "t.trial_ate"]) {
    if (!fonte.includes(coluna)) throw new Error(`o SELECT público não traz ${coluna}`);
  }
});

etapa("o recado de trial vencido não promete mais galeria no ar para sempre", () => {
  /* O texto dizia "as galerias já publicadas continuam no ar". Com a carência
   * isso virou mentira com prazo. */
  const fonte = readFileSync(path.join(RAIZ, "src/lib/assinatura.ts"), "utf8");
  const recado = fonte.slice(fonte.indexOf("trial_vencido:"), fonte.indexOf("inadimplente:"));
  if (recado.includes("continuam no ar")) {
    throw new Error("o recado ainda promete o que a carência tirou");
  }
  if (!/\b15\b/.test(recado)) throw new Error("o recado não diz de quantos dias é o prazo");
});

console.log(falhou ? "\n✗ a carência pós-trial tem problema" : "\n✓ carência pós-trial ok");
process.exitCode = falhou ? 1 : 0;
