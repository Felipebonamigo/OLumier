#!/usr/bin/env node
/**
 * Roda a suíte inteira. Uso:
 *   npm test
 *
 * Antes eram 15 scripts soltos, cada um com sua linha de comando cheia de
 * flags — na prática ninguém rodava todos, e um teste que ninguém roda é um
 * teste que não existe.
 *
 * As que precisam do servidor de desenvolvimento no ar são marcadas: sem ele,
 * o resultado é "pulado" em vez de vermelho, para não confundir "não rodou"
 * com "quebrou".
 *
 * ── SE VOCÊ ESTÁ ESCREVENDO UM TESTE, LEIA ISTO ───────────────────────────
 *
 * **Crie a sua própria galeria. Não pegue a primeira que aparecer.**
 *
 * O atalho natural é este, e em 26/08/2026 ele estava em 20 dos 47 arquivos:
 *
 *     select ... from galerias where estado = 'online' order by criado_em limit 1
 *
 * Todos caem na MESMA linha. E dois testes limpam a bancada inteira dela:
 *
 *     testar-favoritas.mjs   delete from favoritas where galeria_id = $1
 *     testar-selecao.mjs     delete from favoritas where galeria_id = $1
 *
 * Numa rodada sequencial eles não se cruzam. Basta um segundo `npm test` no
 * mesmo banco — outra sessão, outro terminal, um portão de deploy — para um
 * apagar o que o outro acabou de criar.
 *
 * O sintoma é reconhecível e engana: **o vermelho muda de arquivo a cada
 * rodada**. Vermelho que anda é ambiente, nunca código. Se você está depurando
 * um teste que falha em lugar diferente cada vez, pare de olhar o seu código.
 *
 * O custo real não é o tempo perdido. Em 26/08/2026 isso reprovou um deploy
 * fazendo o passo "a favorita sobreviveu" acusar PERDA DE DADO que o produto
 * não tinha. Falso positivo em teste de perda de dado custa duas vezes: o
 * deploy, e a confiança em quem grita — no dia em que a perda for real, aquele
 * vermelho já vai ter virado ruído aceito.
 *
 * O molde (ver `testar-republicar.mjs` e `testar-derivadas-formato.mjs`):
 *
 *     const { rows: [galeria] } = await db.query(
 *       `insert into galerias (tenant_id, slug, titulo, estado, publicada)
 *             values ($1, $2, 'Meu teste', 'online', false)
 *          returning id, tenant_id`,
 *       [tenantId, `meu-teste-${Date.now()}`],
 *     );
 *
 * E na limpeza, **a ORDEM importa**:
 *
 *     1º  a mídia, pelo DELETE da API   → tira os objetos do bucket
 *     2º  a linha da galeria
 *
 * Ao contrário, a cascata do banco leva a linha da mídia e deixa o objeto pago
 * no bucket — órfão que ninguém mais consegue relacionar a nada, e que só
 * aparece na fatura. É o que `varrer-orfaos.mjs` sai caçando depois.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { codigoDeSaida } from "./resultado-suite.mjs";

const AQUI = import.meta.dirname;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

/*
 * `--exigir-tudo` transforma "pulado" em reprovação. É o modo que o `deploy.sh`
 * usa: no dia a dia pular as suítes de HTTP sem servidor no ar é aceitável, na
 * hora de publicar não é. Ver `resultado-suite.mjs`.
 */
const EXIGIR_TUDO = process.argv.includes("--exigir-tudo");

const suites = readdirSync(AQUI)
  .filter((f) => f.startsWith("testar-") && f.endsWith(".mjs") && f !== "testar-tudo.mjs")
  .map((f) => f.replace(/\.mjs$/, ""))
  .sort();

/**
 * Quais suítes batem em rotas HTTP — DEDUZIDO do próprio arquivo.
 *
 * Isto era uma lista escrita à mão, e a lista envelheceu: em 25/08/2026 nove
 * suítes usavam BASE_URL e só três estavam nela. O efeito é o pior possível num
 * arranjo de testes — com o servidor no ar, tudo verde; sem ele, três suítes
 * VERMELHAS por "fetch failed" e as outras seis puladas. A mesma ausência do
 * servidor produzia duas cores diferentes, e a vermelha acusava um problema que
 * não existia.
 *
 * Deduzir do conteúdo elimina a lista: suíte nova que fale HTTP entra sozinha, e
 * ninguém precisa lembrar de nada.
 */
/*
 * `process.env.BASE_URL` e não `BASE_URL` solto: **`DATABASE_URL` contém
 * `BASE_URL`**.
 *
 * Com a busca solta, todo teste que apenas MENCIONAVA a variável do banco —
 * numa mensagem, num comentário, no nome de uma etapa — era classificado como
 * dependente de HTTP. Em 26/08/2026 eram DEZ dos 51: auditoria, chave-api,
 * dominio-proprio, isolamento, limpeza, lixeira, purga-espelho, quota,
 * troca-plano e varredura. (A suíte purga-espelho saiu em 27/08/2026, com o
 * espelho; o episódio continua valendo como aviso.)
 *
 * O efeito é o pior tipo: com o servidor de desenvolvimento fora, esses dez
 * eram PULADOS em silêncio. Passavam de "não rodou" a "não conta", e a suíte
 * dizia 17 de 50 sem que nada acusasse que dez deles rodariam bem. Foi assim
 * que apareceu: o `testar-varredura`, que não fala HTTP nenhum, saiu como
 * pulado porque tem uma etapa chamada "sem DATABASE_URL é RECUSADO".
 *
 * Os dois marcadores continuam sendo os certos, porque todo teste que fala com
 * o servidor abre com `process.env.BASE_URL ?? "http://localhost:3040"` — os
 * dois aparecem juntos nele. Conferido nos dez: oito não têm URL nenhuma no
 * arquivo, e os outros dois usam endereço de mentira para montar objeto
 * (`new Request("http://localhost/api/qualquer")`) ou para testar normalização
 * de domínio. Nenhum abre conexão.
 */
const PRECISAM_DO_SERVIDOR = new Set(
  suites.filter((nome) => {
    const fonte = readFileSync(path.join(AQUI, `${nome}.mjs`), "utf8");
    return fonte.includes("process.env.BASE_URL") || fonte.includes("localhost:3040");
  }),
);

let servidorNoAr = false;
try {
  const r = await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(5000) });
  servidorNoAr = r.ok;
} catch {
  servidorNoAr = false;
}

if (!servidorNoAr) {
  console.log(`⚠ servidor de desenvolvimento fora do ar (${BASE})`);
  console.log("  as suítes que dependem dele serão puladas — rode `npm run dev` para cobrir tudo\n");
}

/*
 * ── AS QUE CONFEREM O BUCKET DE VERDADE, E SÓ ELE (17/09/2026) ────────────
 *
 * Estas duas não testam código: testam se o BUCKET lá fora está configurado.
 * `testar-cors-arquivos` chama `GetBucketCors` no bucket dos originais, e o
 * `testar-cors` faz um preflight contra o endereço do armazém. Contra um
 * servidor de mentira elas respondem sobre o servidor de mentira — e o próprio
 * `deploy.sh` já diz isso, no bloco que roda a conferência de CORS NO VPS
 * depois de publicar: "em dev o B2 não está configurado e a suíte se pula
 * sozinha. Foi assim que o bucket ficou SEM CORS NENHUM com a bateria inteira
 * verde".
 *
 * Na máquina do Felipe elas rodam e valem, porque lá o armazém é o de verdade.
 * Numa bancada de mentira — a do CI, com `R2_ENDPOINT` apontando para outro
 * lugar — elas NÃO SE APLICAM, e isso é diferente de "pulada": pulada quer
 * dizer "dava para rodar e ninguém rodou", que é o que o `--exigir-tudo`
 * existe para punir.
 *
 * A lista é curta e fechada de propósito. Se ela crescer, a pergunta a fazer é
 * se a bancada não deveria ser de verdade — e não se cabe mais uma exceção.
 */
const SO_CONTRA_ARMAZEM_DE_VERDADE = new Set(["testar-cors", "testar-cors-arquivos"]);
const armazemDeMentira = Boolean(process.env.R2_ENDPOINT);

const verdes = [];
const vermelhas = [];
const pulados = [];
const naoSeAplicam = [];

for (const nome of suites) {
  if (armazemDeMentira && SO_CONTRA_ARMAZEM_DE_VERDADE.has(nome)) {
    naoSeAplicam.push(nome);
    console.log(`  · ${nome} (não se aplica: o armazém desta bancada não é o de verdade)`);
    continue;
  }

  if (PRECISAM_DO_SERVIDOR.has(nome) && !servidorNoAr) {
    pulados.push(nome);
    console.log(`  – ${nome} (pulado)`);
    continue;
  }

  const r = spawnSync(
    process.execPath,
    [
      "--env-file=.env.local",
      /* A mesma condição que o Next usa no servidor. Sem ela, `server-only`
       * resolve para o módulo que estoura de propósito, e toda suíte que toca
       * uma peça de `src/lib` morre na importação — foi o que aconteceu com
       * `testar-asaas.mjs`. Ligada, o resolvedor enxerga o que a aplicação
       * enxerga; é a suíte ficar mais parecida com produção, não menos. */
      "--conditions=react-server",
      "--experimental-strip-types",
      "--import",
      "./scripts/registrar-ts.mjs",
      path.join("scripts", `${nome}.mjs`),
    ],
    { encoding: "utf8", cwd: path.resolve(AQUI, "..") },
  );

  const saida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status === 0) {
    verdes.push(nome);
    console.log(`  ✓ ${nome}`);
  } else {
    vermelhas.push(nome);
    console.log(`  ✗ ${nome}`);
    // Só as linhas de falha: despejar a saída inteira de 15 suítes esconderia
    // justamente o que interessa.
    for (const linha of saida.split("\n").filter((l) => l.includes("✗"))) {
      console.log(`      ${linha.trim()}`);
    }
  }
}

console.log(
  `\n${verdes.length} passaram · ${vermelhas.length} falharam${
    pulados.length ? ` · ${pulados.length} pulados` : ""
  }${naoSeAplicam.length ? ` · ${naoSeAplicam.length} não se aplicam a esta bancada` : ""}`,
);

/* Alto, e não em nota de rodapé: quem lê "verde" precisa saber o que ficou de
   fora, ou a bancada de mentira vira uma promessa que ninguém fez. */
if (naoSeAplicam.length) {
  console.log(
    `\n· ${naoSeAplicam.join(", ")} — só valem contra o armazém de verdade.\n` +
      `  O deploy.sh confere o CORS no VPS depois de publicar; ver o bloco final dele.`,
  );
}

if (vermelhas.length) console.error(`\n✗ ${vermelhas.join(", ")}\n`);

if (pulados.length) {
  console.log(
    EXIGIR_TUDO
      ? "\n✗ cobertura parcial, e esta execução exige tudo — suba o servidor e rode de novo\n"
      : "\n⚠ cobertura parcial — suba o servidor e rode de novo antes de publicar\n",
  );
} else if (!vermelhas.length) {
  console.log("\n✓ suíte inteira verde\n");
}

process.exit(
  codigoDeSaida({
    vermelhas: vermelhas.length,
    pulados: pulados.length,
    exigirTudo: EXIGIR_TUDO,
  }),
);
