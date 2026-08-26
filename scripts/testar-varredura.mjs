#!/usr/bin/env node
/**
 * O guarda que impede a varredura de apagar arquivo do OUTRO ambiente.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-varredura.mjs
 *
 * ── O DEFEITO QUE ISTO PRENDE ─────────────────────────────────────────────
 *
 * Em 26/08/2026 mediu-se que desenvolvimento e produção gravam no MESMO bucket
 * R2 (`galerias`, mesma conta). O `varrer-orfaos.mjs` compara UM bucket contra
 * UM banco, então tudo que o outro ambiente criou parece órfão.
 *
 * A direção cara é esta: no dia em que houver foto de cliente em produção,
 * rodar `--apagar` a partir do DEV classifica essas fotos como órfãs, porque o
 * banco de dev não conhece aquelas chaves. Apaga foto de casamento.
 *
 * Um guarda de "o banco conhece zero chave" NÃO pega esse caso — o dev conhece
 * centenas de chaves, as dele. O que separa os ambientes é o BANCO, nunca o
 * bucket: dev usa `fotonio_dev`, produção usa `fotonio`, e os dois usam
 * `galerias`. Então a pergunta certa é se banco e bucket combinam.
 *
 * ── O QUE ESTE GUARDA NÃO FAZ, DE PROPÓSITO ───────────────────────────────
 *
 * Ele não impede produção de apagar arquivo de teste do dev. A assimetria é
 * escolhida: um lado destrói foto de cliente, o outro destrói `limpeza-0.png`.
 * Fechar o lado caro com uma condição verificável vale mais do que não fechar
 * nenhum esperando a separação de buckets.
 *
 * É REMENDO, não solução. O conserto é separar o bucket por ambiente — e o dia
 * em que isso acontecer, este guarda deixa de disparar sozinho, sem ninguém
 * precisar lembrar de removê-lo.
 */
import { podeApagar } from "./varrer-orfaos-regras.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

let falhou = false;
function etapa(nome, fn) {
  try {
    const detalhe = fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

const DEV = "postgres://u:s@localhost:5433/fotonio_dev";
const PROD = "postgres://u:s@localhost:5432/fotonio";

console.log("o guarda da varredura: banco e bucket do mesmo ambiente");

etapa("dev apontando para o bucket de produção é RECUSADO", () => {
  const r = podeApagar({ bucket: "galerias", databaseUrl: DEV });
  if (r.pode) {
    throw new Error(
      "deixou passar — é este o caso que apaga foto de casamento: o banco de dev " +
        "não conhece as chaves de produção, então as fotos da cliente entram na lista de órfãs",
    );
  }
  if (!r.motivo) throw new Error("recusou sem dizer por quê — quem rodar não vai entender");
  return "recusado";
});

etapa("produção apontando para o próprio bucket é PERMITIDO", () => {
  const r = podeApagar({ bucket: "galerias", databaseUrl: PROD });
  if (!r.pode) throw new Error(`recusou o caso legítimo: ${r.motivo}`);
  return "permitido";
});

etapa("dev com bucket próprio é PERMITIDO (o dia em que separarem)", () => {
  /* É o teste que prova que o guarda SOME sozinho depois da separação, em vez
   * de virar entulho que alguém precisa lembrar de tirar. */
  const r = podeApagar({ bucket: "galerias-dev", databaseUrl: DEV });
  if (!r.pode) throw new Error(`recusou depois de os buckets serem separados: ${r.motivo}`);
  return "permitido";
});

etapa("sem DATABASE_URL é RECUSADO", () => {
  /* Não dá para afirmar o ambiente. Na dúvida, não apaga — é a mesma regra que
   * o script já aplica a objeto sem data conhecida. */
  const r = podeApagar({ bucket: "galerias", databaseUrl: undefined });
  if (r.pode) throw new Error("deixou passar sem saber de que ambiente é o banco");
  return "recusado";
});

etapa("banco de produção com bucket desconhecido é PERMITIDO", () => {
  /* O guarda protege O BUCKET DE PRODUÇÃO. Bucket que não é ele não está sob
   * esta regra — senão o guarda vira uma lista de permissões que envelhece a
   * cada bucket novo. */
  const r = podeApagar({ bucket: "outro-balde", databaseUrl: PROD });
  if (!r.pode) throw new Error(`recusou bucket que não é o de produção: ${r.motivo}`);
  return "permitido";
});

/*
 * ── A ETAPA QUE REALMENTE IMPORTA ─────────────────────────────────────────
 *
 * As cinco acima provam a REGRA. Esta prova a FIAÇÃO, e sem ela as outras não
 * valem nada: uma regra perfeita que o script nunca chama deixa o teste verde
 * enquanto o arquivo é destruído. É o mesmo motivo pelo qual `chavesConhecidas`
 * mora neste módulo e não dentro do script.
 */
etapa("o varrer-orfaos.mjs realmente chama o guarda", () => {
  const script = readFileSync(path.join(RAIZ, "scripts/varrer-orfaos.mjs"), "utf8");
  if (!script.includes("podeApagar")) {
    throw new Error("o script não chama podeApagar — a regra existe e não protege nada");
  }
  return "chamada presente";
});

etapa("o guarda é conferido ANTES de listar o bucket", () => {
  /* Ordem importa por dois motivos. O barato: listar bucket grande custa tempo e
   * chamada paga, e recusar depois disso é desperdício. O que importa: quanto
   * mais código roda antes da recusa, mais chance de alguém, um dia, mover a
   * checagem para depois do apagamento sem perceber. */
  const script = readFileSync(path.join(RAIZ, "scripts/varrer-orfaos.mjs"), "utf8");
  const ondeGuarda = script.indexOf("podeApagar");
  const ondeApaga = script.indexOf("apagarObjetos(");
  if (ondeGuarda < 0 || ondeApaga < 0) throw new Error("não achei uma das duas chamadas");
  if (ondeGuarda > ondeApaga) {
    throw new Error("o guarda é conferido DEPOIS do apagamento — não guarda nada");
  }
  return "guarda vem antes";
});

console.log(falhou ? "\n✗ o guarda da varredura tem problema" : "\n✓ guarda da varredura ok");
process.exitCode = falhou ? 1 : 0;
