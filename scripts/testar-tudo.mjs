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

/**
 * Quais suítes precisam das CREDENCIAIS DO ARMAZÉM — deduzido do arquivo, pelo
 * mesmo motivo da lista acima: lista escrita à mão envelhece, e a que envelhece
 * mente.
 *
 * Existe porque estas três falhavam de VERMELHO em toda máquina sem as chaves
 * do R2 — inclusive numa recém-clonada, e no CI. Vermelho por credencial que
 * ninguém prometeu ter não é defeito encontrado: é ruído, e ruído treina a
 * gente a ignorar a cor que importa. Puladas, elas contam como "não rodou", que
 * é a verdade, e o `--exigir-tudo` continua cobrando quem for publicar.
 *
 * O marcador é o nome das variáveis, e não a palavra "R2": esta última aparece
 * em comentário de meia dúzia de arquivos que não tocam no bucket. É o mesmo
 * cuidado que o bloco anterior documenta sobre `DATABASE_URL` conter `BASE_URL`.
 */
const PRECISAM_DO_ARMAZEM = new Set(
  suites.filter((nome) => {
    const fonte = readFileSync(path.join(AQUI, `${nome}.mjs`), "utf8");
    return fonte.includes("R2_ACCOUNT_ID") || fonte.includes("R2_BUCKET");
  }),
);

/* As suítes recebem o ambiente por `--env-file=.env.local`; este corredor, não.
 * Então ele lê o mesmo arquivo para saber o que elas vão encontrar — sem isso,
 * ele decidiria "não tem armazém" numa máquina que tem. */
function doAmbiente(chave) {
  if (process.env[chave]) return process.env[chave];
  try {
    const arquivo = readFileSync(path.resolve(AQUI, "..", ".env.local"), "utf8");
    const linha = arquivo.split("\n").find((l) => l.trimStart().startsWith(`${chave}=`));
    return linha ? linha.slice(linha.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

/* `R2_ENDPOINT` conta no lugar de `R2_ACCOUNT_ID`: a conta só existe para
 * MONTAR o endereço do R2, e quem já tem o endereço (o MinIO do CI, um armazém
 * local) não precisa dela. */
const temArmazem =
  Boolean(doAmbiente("R2_ACCOUNT_ID") || doAmbiente("R2_ENDPOINT")) &&
  ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"].every((chave) => doAmbiente(chave));

/*
 * ── O PORTÃO CONTINUA SENDO O `ok` INTEIRO DO healthz ─────────────────────
 *
 * Tentei afrouxá-lo para "respondeu e o banco está de pé", achando que as
 * suítes de HTTP que não tocam no bucket poderiam rodar sem as chaves do R2.
 * MEDIDO: com o servidor de pé e sem armazém, treze delas ficam VERMELHAS —
 * upload, derivadas, multipart, cofre, seleção, teto do trial… Elas não citam
 * `R2_` em lugar nenhum (por isso o eixo acima não as pega): passam por ROTAS
 * que precisam do bucket, e o 503 sai de dentro do app.
 *
 * Trocar trinta e dois "pulados" por treze vermelhos é o pior negócio possível:
 * vermelho que não é defeito ensina a ignorar a cor que importa. Sem armazém o
 * servidor está mesmo meio quebrado, e o healthz — que é a rota do vigia — está
 * certo em dizer isso.
 *
 * O caminho para cobrir tudo NÃO é afrouxar aqui: é dar um armazém de verdade a
 * quem roda a suíte. O CI faz isso com um MinIO ao lado (ver
 * `.github/workflows/verificar.yml`).
 */
let servidorNoAr = false;
try {
  const r = await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(5000) });
  servidorNoAr = r.ok;
} catch {
  servidorNoAr = false;
}

if (!servidorNoAr) {
  console.log(`⚠ servidor de desenvolvimento fora do ar, ou sem banco/armazém (${BASE})`);
  console.log("  as suítes que dependem dele serão puladas — rode `npm run dev` para cobrir tudo\n");
}

if (!temArmazem) {
  console.log("⚠ sem credenciais do armazém (R2_*)");
  console.log("  as suítes que mexem no bucket serão puladas\n");
}

const verdes = [];
const vermelhas = [];
const pulados = [];

for (const nome of suites) {
  if (PRECISAM_DO_SERVIDOR.has(nome) && !servidorNoAr) {
    pulados.push(nome);
    console.log(`  – ${nome} (pulado: sem servidor)`);
    continue;
  }

  if (PRECISAM_DO_ARMAZEM.has(nome) && !temArmazem) {
    pulados.push(nome);
    console.log(`  – ${nome} (pulado: sem armazém)`);
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
  }`,
);

if (vermelhas.length) console.error(`\n✗ ${vermelhas.join(", ")}\n`);

if (pulados.length) {
  console.log(
    EXIGIR_TUDO
      ? "\n✗ cobertura parcial, e esta execução exige tudo — suba o servidor (e as chaves) e rode de novo\n"
      : "\n⚠ cobertura parcial — suba o servidor (e as chaves) e rode de novo antes de publicar\n",
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
