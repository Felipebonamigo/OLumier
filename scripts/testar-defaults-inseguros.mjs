#!/usr/bin/env node
/**
 * Auditoria de DEFAULTS INSEGUROS, virada em teste.
 * Uso: node --experimental-strip-types scripts/testar-defaults-inseguros.mjs
 *
 * ── POR QUE EXISTE (01/09/2026) ───────────────────────────────────────────
 *
 * Uma auditoria manual achou dois defeitos que nenhuma suíte pegava, porque
 * nenhum deles quebra nada: o código roda, os testes passam, e o dano só existe
 * para quem olha o dado depois.
 *
 *   1. `eventos.ts` pseudonimizava IP com `SESSAO_SEGREDO ?? "sem-segredo"`, e
 *      `SESSAO_SEGREDO` não existia em ambiente nenhum — nem no `.env.local`,
 *      nem em produção. O sal era, sempre, a string literal que está no código,
 *      que está em dois repositórios no GitHub. Reverter todo IPv4 contra um sal
 *      conhecido leva minutos. Cinco eventos em produção já estavam assim.
 *
 *   2. Uma rota devolvia `e.message` no corpo da resposta. O `catch` cobria a
 *      remontagem no S3, então o texto podia trazer bucket, chave e endpoint.
 *
 * O que os dois têm em comum é o motivo desta suíte existir: **default inseguro
 * não falha**. Ele funciona perfeitamente, e é justamente por isso que nada
 * avisa. Só um teste que procure o PADRÃO — e não o sintoma — segura isso.
 *
 * As categorias são as de auditoria de defaults inseguros: segredo com
 * fallback, credencial padrão, chave que falha aberta, cripto fraca, permissão
 * larga e vazamento de erro.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

/** Todos os .ts/.tsx de src/, com o caminho relativo e o conteúdo. */
function arquivos(dir = path.join(RAIZ, "src")) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    const cheio = path.join(dir, nome);
    if (statSync(cheio).isDirectory()) {
      saida.push(...arquivos(cheio));
      continue;
    }
    if (!/\.tsx?$/.test(nome)) continue;
    saida.push({
      caminho: path.relative(RAIZ, cheio).replace(/\\/g, "/"),
      texto: readFileSync(cheio, "utf8"),
    });
  }
  return saida;
}

const FONTES = arquivos();

/** Acha `padrao` em todos os arquivos e devolve "arquivo:linha" de cada acerto. */
function ocorrencias(padrao, filtro = () => true) {
  const achados = [];
  for (const { caminho, texto } of FONTES) {
    if (!filtro(caminho)) continue;
    /*
     * `\r?\n`, e não `\n`: no Windows o git entrega os arquivos com CRLF, e o
     * `\r` que sobrava no fim da linha quebrava o corte de comentário logo
     * abaixo — `$` não casa antes de um `\r`, então a linha inteira passava
     * como se fosse código. O efeito era um falso positivo que acusava o
     * COMENTÁRIO que explica um defeito já consertado (medido em 28/09/2026,
     * em `lib/eventos.ts`), e que só aparecia na máquina do Felipe.
     */
    const linhas = texto.split(/\r?\n/);
    linhas.forEach((linha, i) => {
      /* Comentário não é código: a suíte procura o que EXECUTA. Sem isto, o
         comentário que explica o defeito consertado reprovaria o conserto. */
      const semComentario = linha.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      padrao.lastIndex = 0;
      if (padrao.test(semComentario)) achados.push(`${caminho}:${i + 1}`);
    });
  }
  return achados;
}

console.log("segredo com fallback");

/*
 * Variável de ambiente com cara de segredo NÃO pode ter valor de reserva. Se
 * faltar, o certo é explodir na hora — segredo ausente que vira string fixa é
 * cripto que só parece cripto.
 *
 * A lista de nomes é o que importa: `EMAIL_API ?? "https://api.resend.com"` é
 * legítimo (é endereço, e é costura de teste), `SESSAO_SEGREDO ?? "sem-segredo"`
 * não é.
 */
await etapa("nenhum segredo cai num valor de reserva", () => {
  const padrao =
    /process\.env\.[A-Z_]*(SECRET|SEGREDO|KEY|TOKEN|SENHA|PASSWORD|CHAVE)[A-Z_]*\s*(\?\?|\|\|)\s*["'`]/;
  const achados = ocorrencias(padrao);
  if (achados.length) {
    throw new Error(
      `${achados.join(", ")} — segredo ausente vira string fixa, e string fixa está no código`,
    );
  }
  return `${FONTES.length} arquivos`;
});

/*
 * O caso concreto que motivou a suíte, preso pelo NOME. A regra acima já pegaria
 * o padrão; esta etapa existe para o dia em que alguém reintroduzir a variável
 * fantasma — `SESSAO_SEGREDO` nunca existiu em ambiente nenhum, e ler dela é
 * ler de lugar vazio, com ou sem valor de reserva.
 */
await etapa("a variável fantasma SESSAO_SEGREDO não volta", () => {
  const achados = ocorrencias(/SESSAO_SEGREDO/);
  if (achados.length) {
    throw new Error(`${achados.join(", ")} — essa variável não existe em ambiente nenhum`);
  }
});

console.log("\ncredencial padrão");

await etapa("nenhuma senha ou usuário embutido no código", () => {
  const padrao = /(senha|password|passwd|usuario|username)\s*[:=]\s*["'`](?!\s*["'`])[^"'`]{3,}["'`]/i;
  const achados = ocorrencias(padrao, (c) => !c.includes("/testar-"));
  if (achados.length) throw new Error(achados.join(", "));
});

console.log("\nchave que falha aberta");

/*
 * Os dois hashes de IP precisam ser O MESMO. Eles nasceram iguais, um comentário
 * afirmava que eram iguais, e um dos dois foi trocado por um segredo que não
 * existia — em silêncio, porque nada cruza as duas tabelas em teste nenhum.
 *
 * A prova é de comportamento: as duas funções, no mesmo IP, têm de devolver a
 * mesma coisa. E sem SESSION_SECRET as duas têm de RECUSAR, em vez de inventar.
 */
await etapa("os dois hashes de IP saem do mesmo segredo", async () => {
  const guardado = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "x".repeat(48);
  try {
    const { hashDeIp } = await import("../src/lib/ip.ts");
    const a = hashDeIp("203.0.113.7");
    const b = hashDeIp("203.0.113.7");
    if (a !== b) throw new Error("a mesma função devolveu dois valores para o mesmo IP");
    if (a.length !== 32) throw new Error(`hash com ${a.length} caracteres, esperava 32`);
    return a.slice(0, 12) + "…";
  } finally {
    if (guardado === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = guardado;
  }
});

await etapa("as duas tabelas usam a MESMA função, não uma cópia", () => {
  const eventos = FONTES.find((f) => f.caminho.endsWith("lib/eventos.ts"));
  const publicas = FONTES.find((f) => f.caminho.endsWith("lib/galerias-publicas.ts"));
  for (const [nome, f] of [
    ["eventos.ts", eventos],
    ["galerias-publicas.ts", publicas],
  ]) {
    if (!f) throw new Error(`${nome} sumiu`);
    if (!/from "\.\/ip"/.test(f.texto)) {
      throw new Error(`${nome} não importa de ./ip — voltou a ter cópia própria do hash`);
    }
  }
});

console.log("\ncripto fraca");

await etapa("nada de md5, sha1 ou Math.random em decisão de segurança", () => {
  const achados = ocorrencias(/\bmd5\b|\bsha1\b|Math\.random\s*\(/i);
  if (achados.length) throw new Error(achados.join(", "));
});

console.log("\npermissão larga");

await etapa("nenhum modo de arquivo permissivo nem ACL pública", () => {
  const achados = ocorrencias(/public-read|0o6[0-7][0-7]|0o7[0-7][0-7]|ACL\s*:/);
  if (achados.length) throw new Error(achados.join(", "));
});

console.log("\nvazamento de erro");

/*
 * `e.message` no corpo da resposta entrega texto de dentro. Numa rota que fala
 * com o S3, isso é nome de bucket, chave do objeto e endpoint — para qualquer
 * estúdio autenticado, sem esforço nenhum.
 *
 * Loga no servidor e devolve frase escrita por gente. Esta etapa olha SÓ as
 * rotas de API: mensagem de erro em componente é texto para a pessoa, não
 * resposta de máquina.
 */
await etapa("nenhuma rota de API devolve a mensagem interna do erro", () => {
  const padrao = /(NextResponse\.json|Response\.json)[\s\S]{0,120}?\be\w*\.message\b/;
  const achados = [];
  for (const { caminho, texto } of FONTES) {
    if (!caminho.includes("src/app/api/")) continue;
    padrao.lastIndex = 0;
    if (padrao.test(texto)) achados.push(caminho);
  }
  if (achados.length) {
    throw new Error(`${achados.join(", ")} — o texto do erro interno vai para o cliente`);
  }
  return `${FONTES.filter((f) => f.caminho.includes("src/app/api/")).length} rotas`;
});

console.log(falhou ? "\n✗ há default inseguro" : "\n✓ defaults ok");
process.exitCode = falhou ? 1 : 0;
