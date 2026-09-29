#!/usr/bin/env node
/**
 * TODA DATA NA TELA É HORÁRIO DE BRASÍLIA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-fuso-do-brasil.mjs
 *
 * Suíte PURA: sem banco, sem servidor.
 *
 * ── O DEFEITO (29/09/2026) ────────────────────────────────────────────────
 *
 * Felipe, olhando os "Últimos eventos" do admin: "esse horário está errado,
 * ainda são 18:50 aqui". A tela dizia 21:16.
 *
 * Três horas exatas: o VPS roda em `Etc/UTC` (conferido — `timedatectl` diz
 * "Time zone: Etc/UTC") e o serviço não define `TZ`. Como a página é desenhada
 * NO SERVIDOR, `toLocaleString("pt-BR")` usa o fuso do processo, não o de quem
 * lê — e "pt-BR" escolhe o idioma, nunca o fuso. O formato saía brasileiro e a
 * hora, inglesa.
 *
 * ── E O PIOR NÃO É A HORA ─────────────────────────────────────────────────
 *
 * É a DATA. Entre 21:00 e 00:00 de Brasília já é o dia seguinte em UTC, então
 * toda data desenhada nessa faixa saía um dia à frente. Isso alcança o prazo da
 * galeria ("expira em"), o vencimento do teste e a data do último pagamento —
 * lugares onde um dia de diferença é uma conversa com cliente.
 *
 * ── POR QUE NÃO ARRUMAR O `TZ` DO SERVIÇO ─────────────────────────────────
 *
 * Porque trocaria o fuso do processo INTEIRO — logs, `new Date()`, e toda conta
 * de data que hoje assume UTC. O que se quer é menor e mais honesto: a hora é
 * gravada em UTC (`timestamptz`) e EXIBIDA em Brasília. Dizer isso na hora de
 * formatar é a mudança que não mexe em mais nada.
 *
 * O código já tinha decidido assim em cinco lugares — `troca-de-plano`,
 * `testes-abandonados`, `caixa-dos-socios` — onde alguém tropeçou antes e
 * consertou só onde doía. Isto termina o serviço.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { FUSO } from "../src/config/fuso.ts";
import { data, dataHora } from "../src/lib/data-na-tela.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const extra = fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    falhou = true;
    console.error(`  ✗ ${nome} — ${e.message}`);
  }
};

console.log("As datas na tela:\n");

etapa("o fuso é o de Brasília, escrito num lugar só", () => {
  if (FUSO !== "America/Sao_Paulo") throw new Error(`FUSO é "${FUSO}"`);
  return FUSO;
});

/*
 * O instante escolhido é o do defeito: 23:30 UTC de 29/09 é 20:30 de 29/09 em
 * Brasília. Ele prova as duas metades de uma vez — a hora certa E o dia certo,
 * porque em UTC esse instante ainda é dia 29, mas às 00:30 UTC já seria 30.
 */
const noite = new Date("2026-09-29T23:30:00Z");
const madrugada = new Date("2026-09-30T02:15:00Z"); // 23:15 de 29/09 em Brasília

etapa("a hora sai em Brasília, não em UTC", () => {
  const texto = dataHora(noite);
  if (!texto.includes("20:30")) throw new Error(`saiu "${texto}", esperava 20:30`);
  return texto;
});

etapa("a data NÃO adianta um dia depois das 21h", () => {
  /* A metade cara do defeito: em UTC, 02:15 do dia 30 é "30 de set."; em
     Brasília ainda é 29. É o que faria um prazo de entrega aparecer um dia à
     frente para o casal. */
  const texto = data(madrugada);
  if (!/29/.test(texto)) throw new Error(`saiu "${texto}", esperava 29 de set.`);
  return texto;
});

etapa("a hora da madrugada também", () => {
  const texto = dataHora(madrugada);
  if (!texto.includes("23:15")) throw new Error(`saiu "${texto}", esperava 23:15`);
  return texto;
});

/* ── O guarda que impede o próximo esquecimento ──────────────────────────── */
function arquivos(dir) {
  const achados = [];
  for (const nome of readdirSync(dir)) {
    const cheio = path.join(dir, nome);
    if (statSync(cheio).isDirectory()) achados.push(...arquivos(cheio));
    else if (/\.(ts|tsx)$/.test(nome)) achados.push(cheio);
  }
  return achados;
}

etapa("nenhum formatador de data esqueceu o fuso", () => {
  /*
   * Este é o guarda que importa. Consertar os 38 de hoje não impede o 39º de
   * nascer sem fuso amanhã — e ele nasceria certo na máquina de quem escreve
   * (que está em Brasília) e errado em produção, que é o jeito mais caro de um
   * defeito existir.
   *
   * A conferência é por CHAMADA, e olha a linha e a seguinte: as opções às
   * vezes quebram em duas linhas.
   */
  const semFuso = [];
  for (const arq of arquivos(path.join(RAIZ, "src"))) {
    const linhas = readFileSync(arq, "utf8").replace(/\r\n/g, "\n").split("\n");
    for (let i = 0; i < linhas.length; i++) {
      if (!/toLocale(Date|Time)?String\(/.test(linhas[i])) continue;
      /* Sem argumento de opções nenhum é número puro (`(1234).toLocaleString`),
         que não tem fuso para errar. */
      /* Oito linhas, e não quatro: as opções às vezes ocupam seis, e uma janela
         curta acusaria de esquecido justamente o formatador escrito com mais
         cuidado — foi o que aconteceu na primeira rodada. */
      const trecho = linhas.slice(i, i + 8).join(" ");
      if (/timeZone/.test(trecho)) continue;
      /*
       * NÚMERO não tem fuso para errar, e `toLocaleString` formata os dois.
       * Quem passa só a etiqueta de idioma — `(1234).toLocaleString("pt-BR")` —
       * está separando milhar; data sem opção nenhuma não existe neste código,
       * porque toda data da tela quer dia e mês por extenso.
       */
      if (/toLocale(Date|Time)?String\(\s*"pt-BR"\s*\)/.test(linhas[i])) continue;
      if (/style:\s*"currency"|maximumFractionDigits|minimumFractionDigits/.test(trecho)) continue;
      semFuso.push(`${path.relative(RAIZ, arq)}:${i + 1}`);
    }
  }
  if (semFuso.length) {
    throw new Error(
      `${semFuso.length} formatador(es) sem timeZone: ${semFuso.slice(0, 6).join(", ")}` +
        (semFuso.length > 6 ? ` e mais ${semFuso.length - 6}` : ""),
    );
  }
  return "todos com fuso";
});

console.log(falhou ? "\n✗ há data saindo em UTC" : "\n✓ datas em horário de Brasília");
process.exitCode = falhou ? 1 : 0;
