#!/usr/bin/env node
/**
 * Prende o isolamento entre execuções da suíte.
 *
 * ── O DEFEITO QUE ISTO EXISTE PARA MATAR ──────────────────────────────────
 * Em 26/08/2026 duas sessões dispararam o portão de deploy com 9 segundos de
 * diferença. As duas reprovaram, e reprovaram em arquivos DIFERENTES a cada
 * rodada. Rodados isolados depois, os mesmos testes passavam. Não havia defeito
 * nenhum no código.
 *
 * A causa: vinte e um testes escolhiam a fixture com
 *
 *     select ... from galerias g ... order by g.criado_em limit 1
 *
 * ou seja, "a galeria mais antiga do banco" — a MESMA linha para todo mundo.
 * Duas execuções mexiam nas mesmas linhas, e o `limpar()` de uma apagava o
 * estado que a outra acabara de criar.
 *
 * O sintoma vale guardar: **vermelho que muda de arquivo a cada rodada é
 * ambiente, nunca código.** Quem estiver depurando um teste que falha em lugar
 * diferente a cada vez deve parar de olhar para o código.
 *
 * ── AS TRÊS PARTES, E NENHUMA DELAS É CORRIDA ─────────────────────────────
 * 1. ESTÁTICA — lê o código dos testes e recusa quem escolhe fixture global.
 *    É ela que impede o defeito de voltar por esquecimento.
 * 2. BANCADAS DISJUNTAS — duas execuções criam bancada e nenhuma linha se
 *    repete entre elas.
 * 3. LIMPEZA ESTREITA — uma execução limpa e a bancada da outra sobrevive
 *    inteira. É o defeito exato que derrubou dois deploys.
 *
 * As três são determinísticas de propósito. A primeira versão da parte dinâmica
 * rodava o mesmo teste duas vezes em paralelo esperando vermelho, e foi
 * descartada: com o defeito REPOSTO de propósito ela passou 3 de 3, porque a
 * colisão depende de as execuções se cruzarem no milissegundo certo. Teste que
 * passa com e sem o defeito não é teste — é confiança falsa.
 */
import { readFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * O padrão proibido.
 *
 * Qualquer `order by ... limit N` sobre galerias/tenants dentro de um teste é
 * escolha de fixture global — não importa como esteja escrito. Quem precisa de
 * galeria pede à `fixture-de-teste.mjs`, que cria a sua.
 *
 * Fica deliberadamente largo: é melhor recusar um SELECT inocente (e o autor
 * move duas linhas) do que deixar passar um que colide de madrugada.
 *
 * ── POR QUE `\d+` E NÃO `1` ───────────────────────────────────────────────
 * Porque foi `1` até 29/08/2026, e o defeito voltou uma linha adiante. Três
 * testes — api-galerias, chave-api e dominio-proprio — pediam DOIS estúdios:
 *
 *     select ... from tenants order by criado_em limit 2
 *
 * O varredor passou por eles sem ver. Custou uma bancada compartilhada nos três
 * (o dominio-proprio chegava a APAGAR o domínio próprio dos dois estúdios que
 * encontrasse) e a primeira execução do CI deste repositório, que terminou
 * 59 · 3 com os três desistindo em banco novo: "preciso de dois estúdios no
 * banco de teste". Guarda que casa com o número exato do dia guarda o exemplo,
 * não a regra.
 */
const ORDENA_PELO_MAIS_ANTIGO = /order\s+by\s+[\w.]*criado_em[^;`'"]*\blimit\s+\d+/gi;

/**
 * A janela em volta do acerto, para julgar o SELECT inteiro e não a linha.
 *
 * Só é fixture global se o alvo for `tenants` ou `galerias` E não houver
 * parâmetro (`$1`) filtrando. Com `$1` o teste está buscando dentro de algo que
 * já tem na mão — tipicamente a própria bancada — e isso é legítimo.
 *
 * O caso que obrigou esta distinção: `testar-recuperacao.mjs` faz
 * `select token_hash from recuperacoes where tenant_id = $1 order by criado_em
 * desc limit 1`. É o token do estúdio dele, não a linha mais antiga do mundo.
 */
const JANELA = 400;
function ehFixtureGlobal(codigo, indice) {
  const trecho = codigo.slice(Math.max(0, indice - JANELA), indice + 80);
  const daBancada = /\bfrom\s+(tenants|galerias)\b/i.test(trecho);
  const filtrado = /\$\d/.test(trecho);
  return daBancada && !filtrado;
}

/**
 * Testes que podem ler "a mais antiga" com razão.
 *
 * `testar-tudo.mjs` é o corredor, não um teste. Este arquivo cita o padrão no
 * comentário e na constante acima, de propósito.
 */
const DISPENSADOS = new Set(["testar-tudo.mjs", "testar-isolamento.mjs"]);

let falhou = false;

const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome}\n    ${e.message}`);
    falhou = true;
  }
};

console.log("\nIsolamento entre execuções:\n");

await etapa("nenhum teste escolhe fixture global", () => {
  const arquivos = readdirSync(AQUI).filter(
    (f) => f.startsWith("testar-") && f.endsWith(".mjs") && !DISPENSADOS.has(f),
  );
  if (arquivos.length === 0) throw new Error("nenhum teste encontrado — o varredor está cego");

  const culpados = [];
  for (const f of arquivos) {
    const texto = readFileSync(join(AQUI, f), "utf8");
    /* Comentário não conta: o defeito está no que roda, e explicar o padrão
     * proibido dentro de um comentário é exatamente o que este arquivo faz. */
    const codigo = texto
      .replace(/^\s*\*.*$/gm, "")
      .replace(/^\s*\/\/.*$/gm, "");
    ORDENA_PELO_MAIS_ANTIGO.lastIndex = 0;
    for (let m; (m = ORDENA_PELO_MAIS_ANTIGO.exec(codigo)); ) {
      if (ehFixtureGlobal(codigo, m.index)) {
        culpados.push(f);
        break;
      }
    }
  }

  if (culpados.length > 0) {
    throw new Error(
      `${culpados.length} teste(s) pegam a linha mais antiga do banco em vez de criar a sua:\n` +
        culpados.map((c) => `      ${c}`).join("\n") +
        `\n    Troque por galeriaDaRodada() / estudioDaRodada() / segundoEstudioDaRodada()` +
        `\n    de fixture-de-teste.mjs.`,
    );
  }
  return `${arquivos.length} arquivo(s) conferidos`;
});

/**
 * ── POR QUE NÃO CORRIDA DE DOIS PROCESSOS ─────────────────────────────────
 * A primeira versão desta parte rodava o mesmo teste duas vezes em paralelo e
 * exigia verde nas duas. Foi descartada por não servir como portão: com o
 * defeito REPOSTO de propósito (identificador de visitante global de novo), ela
 * passou 3 de 3. A colisão depende de as duas execuções se cruzarem no
 * milissegundo certo, e isso não acontece sob demanda.
 *
 * Teste que passa com e sem o defeito não é teste — é ruído que dá confiança
 * falsa. O que ficou no lugar mede a PROPRIEDADE, não o sintoma: duas bancadas
 * não compartilham linha, e a limpeza de uma não encosta na outra. Determinístico,
 * sem corrida, e reprova na hora se o isolamento quebrar.
 */
const CRIAR_BANCADA = `
import pg from "pg";
import { galeriaDaRodada, limparRodada } from ${JSON.stringify(pathToFileURL(join(AQUI, "fixture-de-teste.mjs")).href)};
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const g = await galeriaDaRodada(db, { medias: 2 });
console.log(JSON.stringify({ estudio: g.estudio.id, galeria: g.id, midias: g.midias.map((m) => m.id) }));
if (process.env.LIMPAR === "1") await limparRodada(db);
await db.end();
`;

function criarBancada(limpar) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      ["--experimental-strip-types", "--import", pathToFileURL(join(AQUI, "registrar-ts.mjs")).href,
       "--input-type=module", "-e", CRIAR_BANCADA],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LIMPAR: limpar ? "1" : "0" } },
    );
    let saida = "", erro = "";
    p.stdout.on("data", (d) => (saida += d));
    p.stderr.on("data", (d) => (erro += d));
    p.on("close", (c) => {
      const linha = saida.split("\n").find((l) => l.trim().startsWith("{"));
      if (c !== 0 || !linha) return reject(new Error(`bancada não nasceu (código ${c}): ${erro.trim().slice(-300)}`));
      resolve(JSON.parse(linha));
    });
  });
}

await etapa("duas bancadas não compartilham nenhuma linha", async () => {
  const [a, b] = await Promise.all([criarBancada(true), criarBancada(true)]);
  if (a.estudio === b.estudio) throw new Error("as duas execuções pegaram o MESMO estúdio");
  if (a.galeria === b.galeria) throw new Error("as duas execuções pegaram a MESMA galeria");
  const juntas = new Set([...a.midias, ...b.midias]);
  if (juntas.size !== a.midias.length + b.midias.length) {
    throw new Error("mídias repetidas entre as duas bancadas");
  }
  return `${a.midias.length} + ${b.midias.length} mídias, nenhuma em comum`;
});

await etapa("a limpeza de uma execução não apaga a bancada da outra", async () => {
  /* A nasce e NÃO limpa; B nasce e limpa. Se a limpeza de B for larga demais
   * (por marca compartilhada, por `like`, por "tudo que é de teste"), a bancada
   * de A some — e é exatamente esse o defeito que derrubou dois deploys. */
  const a = await criarBancada(false);
  await criarBancada(true);

  const pg = (await import("pg")).default;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select (select count(*) from tenants where id = $1)::int estudio,
              (select count(*) from galerias where id = $2)::int galeria,
              (select count(*) from medias where galeria_id = $2)::int midias`,
      [a.estudio, a.galeria],
    );
    const r = rows[0];
    if (r.estudio !== 1 || r.galeria !== 1 || r.midias !== a.midias.length) {
      throw new Error(
        `a bancada de A foi mutilada: estúdio=${r.estudio} galeria=${r.galeria} mídias=${r.midias}/${a.midias.length}`,
      );
    }
    await db.query("delete from tenants where id = $1", [a.estudio]);
    return "A sobreviveu inteira à limpeza de B";
  } finally {
    await db.end();
  }
});

if (falhou) {
  console.error("\n✗ isolamento quebrado — duas execuções da suíte vão brigar\n");
  process.exit(1);
}
console.log("\n✓ isolamento ok — duas execuções não se atrapalham\n");
