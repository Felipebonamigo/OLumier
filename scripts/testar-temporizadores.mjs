#!/usr/bin/env node
/**
 * Testa os temporizadores do servidor contra os scripts que eles chamam. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-temporizadores.mjs
 *
 * Por que existe: em 26/08/2026 o `arquivar-vencidas.mjs` deixou de ter SQL
 * próprio e passou a chamar `src/lib/cofre.ts` — e o `ExecStart` do
 * `fotonio-cofre.service` chamava o script com `node --env-file=... script.mjs`,
 * sem as bandeiras de TypeScript. Rodaria uma vez, falharia por extensão
 * desconhecida, e ninguém veria: o job é oneshot, de madrugada, e um `Type=oneshot`
 * com dois `ExecStart` aborta o SEGUNDO quando o primeiro falha. Duas tarefas
 * parariam de uma vez, em silêncio.
 *
 * A regra que este teste prende é simples e mecânica: script chamado por
 * temporizador que importa `.ts` PRECISA das bandeiras. É o tipo de acoplamento
 * que nenhuma pessoa lembra de conferir, porque as duas pontas moram em
 * arquivos que ninguém abre junto.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const AQUI = import.meta.dirname;
const RAIZ = path.resolve(AQUI, "..");
const OPS = path.join(RAIZ, "ops");

let falhou = false;
function etapa(nome, fn) {
  try {
    const d = fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

/** ExecStart pode vir quebrado em várias linhas com `\` no fim. */
function execStarts(conteudo) {
  const juntas = conteudo.replace(/\\\r?\n\s*/g, " ");
  return juntas
    .split(/\r?\n/)
    .filter((l) => l.startsWith("ExecStart="))
    .map((l) => l.slice("ExecStart=".length).trim());
}

const servicos = existsSync(OPS)
  ? readdirSync(OPS).filter((f) => f.endsWith(".service"))
  : [];

console.log(`temporizadores em ops/ (${servicos.length} serviço(s))`);

etapa("existe pelo menos um serviço versionado", () => {
  if (servicos.length === 0) throw new Error("nenhum .service em ops/ — os temporizadores não estão no git");
});

for (const arquivo of servicos) {
  const conteudo = readFileSync(path.join(OPS, arquivo), "utf8");

  for (const [i, linha] of execStarts(conteudo).entries()) {
    /*
     * O ALVO é o último script da linha, não o primeiro: quem já tem as
     * bandeiras cita `--import .../registrar-ts.mjs` ANTES do script de
     * verdade. Mirar no primeiro faria o teste conferir o carregador contra
     * ele mesmo e passar sempre — verde por olhar para o lugar errado.
     */
    const citados = [...linha.matchAll(/scripts\/([a-z0-9-]+)\.mjs/g)].map((m) => m[1]);
    const alvo = citados.filter((n) => n !== "registrar-ts").at(-1);
    if (!alvo) continue;

    const nomeScript = `${alvo}.mjs`;
    const caminho = path.join(AQUI, nomeScript);

    etapa(`${arquivo}[${i}] chama um script que existe: ${nomeScript}`, () => {
      if (!existsSync(caminho)) {
        throw new Error(`o serviço chama scripts/${nomeScript}, que não está no repositório`);
      }
    });
    if (!existsSync(caminho)) continue;

    /*
     * A pergunta que importa: este script importa TypeScript? Se importa, o
     * node precisa das duas bandeiras — sem elas ele morre na primeira linha de
     * import, e o log só diz "Unknown file extension .ts".
     */
    const fonte = readFileSync(caminho, "utf8");
    const importaTs = /from\s+["'][^"']+\.ts["']/.test(fonte);
    if (!importaTs) continue;

    etapa(`${arquivo}[${i}] roda ${nomeScript} com as bandeiras de TypeScript`, () => {
      if (!linha.includes("--experimental-strip-types")) {
        throw new Error(
          `${nomeScript} importa .ts e o ExecStart não tem --experimental-strip-types`,
        );
      }
      if (!linha.includes("registrar-ts.mjs")) {
        throw new Error(`${nomeScript} importa .ts e o ExecStart não carrega o registrar-ts.mjs`);
      }
      return "bandeiras presentes";
    });
  }
}

console.log(falhou ? "\n✗ os temporizadores têm problema\n" : "\n✓ temporizadores e scripts batem\n");
process.exit(falhou ? 1 : 0);
