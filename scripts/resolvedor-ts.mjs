/**
 * Ensina o Node a resolver `./db` como `./db.ts`.
 *
 * Por que precisa existir: o código do app usa imports sem extensão
 * (`from "./db"`), que é o que o TypeScript e o Next esperam. O Node, rodando
 * TypeScript direto com --experimental-strip-types, exige a extensão — então
 * importar `src/lib/tenants.ts` de um script de teste explodia com
 * ERR_MODULE_NOT_FOUND na primeira dependência interna.
 *
 * Sem isto, qualquer teste que quisesse chamar uma função de verdade tinha de
 * ir por HTTP ou reimplementar a lógica — e o que é difícil de testar acaba
 * não sendo testado.
 *
 * Só age quando a resolução normal FALHA e o especificador é relativo e sem
 * extensão: pacote do node_modules e caminho já resolvido passam intactos.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

// O "@/..." do tsconfig aponta para src/. O Node não conhece esse apelido, e
// sem traduzi-lo qualquer módulo que use o atalho fica fora de alcance do teste.
const RAIZ_SRC = path.resolve(import.meta.dirname, "..", "src");

const VAZIO = pathToFileURL(path.join(import.meta.dirname, "modulo-vazio.mjs")).href;

export async function resolve(especificador, contexto, proximo) {
  // Ver scripts/modulo-vazio.mjs.
  if (especificador === "server-only" || especificador === "client-only") {
    return { url: VAZIO, shortCircuit: true };
  }

  if (especificador.startsWith("@/")) {
    const alvo = path.join(RAIZ_SRC, especificador.slice(2));
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
      try {
        return await proximo(pathToFileURL(alvo + ext).href, contexto);
      } catch {
        // tenta a próxima
      }
    }
  }

  try {
    return await proximo(especificador, contexto);
  } catch (erro) {
    const relativo = especificador.startsWith("./") || especificador.startsWith("../");
    const semExtensao = !/\.[cm]?[jt]sx?$|\.json$/.test(especificador);
    if (!semExtensao) throw erro;

    // Relativo: é código nosso, escrito em TypeScript.
    // Pacote (ex.: "next/headers"): o subcaminho existe como .js, mas o Node só
    // acha com a extensão explícita fora do ambiente do bundler.
    const tentativas = relativo ? [".ts", ".tsx", "/index.ts"] : [".js"];
    for (const ext of tentativas) {
      try {
        return await proximo(especificador + ext, contexto);
      } catch {
        // tenta a próxima
      }
    }
    throw erro;
  }
}
