#!/usr/bin/env node
/**
 * A ORDEM das etapas do deploy.sh, que é onde mora o estrago.
 * Uso: node --experimental-strip-types scripts/testar-deploy.mjs
 *
 * ── POR QUE UM TESTE DE ORDEM, E NÃO DE COMPORTAMENTO ─────────────────────
 *
 * O `deploy.sh` fala com o servidor de produção e com o banco de produção.
 * Exercitá-lo de verdade num teste significaria publicar, ou manter um segundo
 * VPS só para isso. Nenhum dos dois cabe hoje.
 *
 * O que dá para prender sem nada disso é a ORDEM em que ele faz as coisas — e
 * é justamente ali que estavam os defeitos, porque cada etapa isolada está
 * certa. Ninguém erra "aplicar migração"; erra-se aplicar antes de conferir.
 *
 * ── O DEFEITO QUE ISTO PRENDE ─────────────────────────────────────────────
 *
 * Até 27/08/2026 a migração era aplicada ANTES do portão de qualidade. Portão
 * vermelho depois disso deixava o banco de produção com estrutura nova e o
 * código velho no ar — um estado que nenhuma das duas metades reconhece.
 *
 * Aconteceu de verdade em 26/08/2026 com a `023-dominio-proprio.sql`: a
 * migração entrou, o portão reprovou por outro motivo, e a produção passou o
 * resto do dia com o esquema à frente do código. Deu certo por sorte — a
 * coluna nova era só ignorada. Com um `not null`, seria escrita quebrada.
 *
 * E isto NÃO é problema de coordenação entre sessões: um deploy solitário, de
 * madrugada, com um teste quebrado, produz exatamente o mesmo estado.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

/*
 * Comentário não conta. O arquivo explica o que faz e cita os próprios comandos
 * em texto — inclusive as instruções de "para fazer na mão" — então procurar a
 * string crua encontraria a MENÇÃO antes da execução e o teste mediria prosa.
 */
const roteiro = readFileSync(path.join(RAIZ, "deploy.sh"), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

/** Marcadores da EXECUÇÃO, não da menção. O `ssh -n` é o que separa as duas. */
const MARCOS = {
  tipos: "if ! npx tsc --noEmit; then",
  suite: "if ! npm test -- --exigir-tudo; then",
  dump: 'ssh -n "$VPS" "/opt/fotonio-backup.sh"',
  migracao: 'scripts/migrar.mjs --aplicar"',
  empacotamento: "git archive --format=tar.gz",
};

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

/** Onde cada marco aparece. Explode se sumir: marco que não existe não ordena nada. */
function onde(chave) {
  const i = roteiro.indexOf(MARCOS[chave]);
  if (i < 0) {
    throw new Error(
      `não achei "${MARCOS[chave]}" no deploy.sh. Se a etapa foi renomeada, ` +
        `atualize MARCOS aqui — mas confira que ela ainda EXISTE antes.`,
    );
  }
  return i;
}

console.log("deploy.sh: a ordem das etapas");

etapa("todos os marcos existem", () => {
  const faltando = Object.keys(MARCOS).filter((k) => roteiro.indexOf(MARCOS[k]) < 0);
  if (faltando.length) throw new Error(`sumiram: ${faltando.join(", ")}`);
  return `${Object.keys(MARCOS).length} marcos`;
});

etapa("a migração é aplicada DEPOIS do portão de qualidade", () => {
  if (onde("migracao") < onde("suite")) {
    throw new Error(
      "a migração entra antes de a suíte rodar. Portão vermelho depois disso deixa o " +
        "banco de produção com estrutura nova e o código velho servindo — e não há " +
        "desfazer automático. Aconteceu em 26/08/2026 com a 023.",
    );
  }
  return "esquema só muda depois de o código passar";
});

etapa("o dump vem antes da migração", () => {
  /* A ordem entre estes dois nunca esteve errada, e é aqui para não passar a
   * estar: quem for mover o bloco da migração leva o dump junto ou quebra esta
   * etapa. Dump depois da migração é dump da estrutura já alterada. */
  if (onde("dump") > onde("migracao")) {
    throw new Error("o dump sairia depois da migração — seria cópia do estado já mudado");
  }
  return "cópia de segurança primeiro";
});

etapa("o portão de qualidade vem antes do empacotamento", () => {
  /* Também nunca esteve errado, e o próprio script explica por quê: portão
   * depois do empacotamento é decoração, porque o custo já foi pago e a
   * tentação de "deixa subir" é máxima ali. */
  if (onde("tipos") > onde("empacotamento") || onde("suite") > onde("empacotamento")) {
    throw new Error("o portão roda depois do git archive — não é portão, é carimbo");
  }
  return "confere antes de empacotar";
});

etapa("os tipos vêm antes da suíte", () => {
  /* Barato antes de caro: `tsc` leva segundos e a suíte leva minutos. Errado
   * não quebra nada, só desperdiça — por isso é a única etapa aqui cuja falha
   * é de eficiência e não de segurança. */
  if (onde("tipos") > onde("suite")) throw new Error("a suíte roda antes do typecheck");
  return "o barato primeiro";
});

/*
 * ── O PORTÃO CONTRA O ORIGIN ──────────────────────────────────────────────
 *
 * `git archive HEAD` empacota a árvore LOCAL. Se outra sessão empurrou e esta
 * máquina não puxou, a publicação sobe sem o trabalho dela — e o hash carimbado
 * bate certinho enquanto isso acontece, porque ele descreve o que foi
 * empacotado e não o que deveria ter sido.
 *
 * Aqui todas as sessões dividem UMA árvore de trabalho, então o inverso também
 * derruba: publicar commit local não empurrado põe produção a rodar código que
 * ninguém mais tem, e o próximo deploy feito a partir do origin desfaz sem
 * saber que desfez.
 *
 * A regra mora em `scripts/portao-origin.sh` e não dentro do `deploy.sh` para
 * poder ser EXERCITADA: dá para rodá-la num worktree fixado num commit velho e
 * ver a recusa acontecer. Testar dentro do deploy.sh exigiria fazer checkout do
 * repositório, e o checkout troca o próprio deploy.sh no disco pela versão sem
 * o portão — o script então publica achando que conferiu. (Armadilha relatada
 * pela sessão do Atomatiza em 27/08/2026, depois de custar uma publicação
 * errada lá.)
 */
etapa("o portão do origin existe e é um script próprio", () => {
  const p = path.join(RAIZ, "scripts/portao-origin.sh");
  if (!existsSync(p)) {
    throw new Error("scripts/portao-origin.sh não existe");
  }
  return "scripts/portao-origin.sh";
});

etapa("o deploy.sh chama o portão do origin", () => {
  if (!roteiro.includes("portao-origin.sh")) {
    throw new Error("regra existe e o deploy não a chama — não protege nada");
  }
  return "chamada presente";
});

etapa("o portão do origin roda antes do empacotamento", () => {
  const i = roteiro.indexOf("portao-origin.sh");
  if (i < 0 || i > onde("empacotamento")) {
    throw new Error("conferir o origin depois de empacotar não impede nada");
  }
  return "confere antes";
});

console.log(falhou ? "\n✗ a ordem do deploy tem problema" : "\n✓ ordem do deploy ok");
process.exitCode = falhou ? 1 : 0;
