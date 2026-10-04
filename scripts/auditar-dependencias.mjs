#!/usr/bin/env node
/**
 * O PORTÃO DE VULNERABILIDADE DAS DEPENDÊNCIAS. Uso (é o que o Verificar roda):
 *   node scripts/auditar-dependencias.mjs
 *
 * Era `npm audit --audit-level=high`, direto no workflow. Em 03/10/2026 saiu um
 * alerta alto para o `braces` (GHSA-vfj7-8cjw-p6xm) que vale para TODAS as
 * versões publicadas — a 3.0.3, que temos, é a última. Ele só entra pelo ESLint
 * (eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch →
 * braces), que não vai para o servidor, e o único "conserto" que o npm oferece é
 * rebaixar o eslint-config-next para a 14. Com o portão antigo, todo PR ficaria
 * vermelho até alguém publicar uma versão nova do braces — e portão que fica
 * vermelho por motivo que ninguém pode resolver treina a gente a ignorar o
 * vermelho, que é o que o comentário do workflow já temia.
 *
 * A régua continua a mesma (alto e crítico barram; moderado e baixo não), com
 * UMA saída, estreita e escrita: `.github/excecoes-do-audit.json`. Um alerta
 * dessa lista só deixa de barrar quando as três coisas são verdade:
 *
 *   1. ele está na lista, pelo identificador (GHSA-…), com o motivo escrito;
 *   2. ele NÃO aparece na auditoria só de produção (`--omit=dev`) — o que vai
 *      para o servidor nunca tem exceção;
 *   3. a data de revisão da exceção ainda não passou — vencida, barra de novo,
 *      e alguém tem de olhar se já saiu correção.
 *
 * Qualquer outro alerta alto continua barrando, inclusive em ferramenta de
 * desenvolvimento que TENHA correção. Se o `npm audit` não responder (sem rede,
 * registro fora), o portão fecha: não saber não é o mesmo que estar limpo.
 *
 * A decisão (`avaliar`) é pura e mora aqui para ser testada sem rede:
 * `scripts/testar-portao-de-vulnerabilidade.mjs`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GRAVES = new Set(["high", "critical"]);

/** O identificador do alerta, tirado do endereço (…/advisories/GHSA-xxxx). */
function idDoAlerta(via) {
  return /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(via.url ?? "")?.[0] ?? `${via.name}#${via.source}`;
}

/** Os alertas de verdade (não as heranças "este pacote depende de um vulnerável"). */
function alertasGraves(relatorio) {
  const achados = new Map();
  for (const v of Object.values(relatorio?.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via !== "object" || !GRAVES.has(via.severity)) continue;
      achados.set(idDoAlerta(via), { id: idDoAlerta(via), pacote: via.name, titulo: via.title, gravidade: via.severity });
    }
  }
  return [...achados.values()];
}

/**
 * @param relatorio   `npm audit --json` da árvore inteira
 * @param producao    `npm audit --omit=dev --json`
 * @param excecoes    a lista de `.github/excecoes-do-audit.json`
 * @param hoje        "AAAA-MM-DD"
 * @returns {{ barram: object[], aceitos: object[] }}
 */
export function avaliar(relatorio, producao, excecoes, hoje) {
  const naProducao = new Set(alertasGraves(producao).map((a) => a.id));
  const barram = [];
  const aceitos = [];
  for (const alerta of alertasGraves(relatorio)) {
    const excecao = excecoes.find((e) => e.alerta === alerta.id);
    if (!excecao) {
      barram.push({ ...alerta, porque: "não está na lista de exceções" });
    } else if (naProducao.has(alerta.id)) {
      barram.push({ ...alerta, porque: "aparece no que vai para produção — exceção não vale para produção" });
    } else if (!excecao.revisar_ate || excecao.revisar_ate < hoje) {
      barram.push({ ...alerta, porque: `a exceção venceu em ${excecao.revisar_ate} — veja se já saiu correção` });
    } else {
      aceitos.push({ ...alerta, revisar_ate: excecao.revisar_ate });
    }
  }
  return { barram, aceitos };
}

function auditar(argumentos) {
  const r = spawnSync("npm", ["audit", "--json", ...argumentos], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    throw new Error(`o npm audit não devolveu um relatório (saída ${r.status}): ${(r.stderr || r.stdout).slice(0, 400)}`);
  }
  if (json.error) throw new Error(`o npm audit falhou: ${json.error.summary ?? JSON.stringify(json.error)}`);
  return json;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const RAIZ = path.join(import.meta.dirname, "..");
  try {
    const { excecoes } = JSON.parse(readFileSync(path.join(RAIZ, ".github/excecoes-do-audit.json"), "utf8"));
    const hoje = new Date().toISOString().slice(0, 10);
    const { barram, aceitos } = avaliar(auditar([]), auditar(["--omit=dev"]), excecoes, hoje);
    for (const a of aceitos) {
      console.log(`· aceito: ${a.id} (${a.pacote}, ${a.gravidade}) — só em ferramenta de desenvolvimento; revisar até ${a.revisar_ate}`);
    }
    if (barram.length) {
      for (const a of barram) console.error(`✗ ${a.id} (${a.pacote}, ${a.gravidade}): ${a.titulo} — ${a.porque}`);
      console.error("\nRode `npm audit` para os detalhes. Exceção só para ferramenta de desenvolvimento sem correção: .github/excecoes-do-audit.json");
      process.exit(1);
    }
    console.log("✓ nenhuma vulnerabilidade alta ou crítica sem exceção");
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
