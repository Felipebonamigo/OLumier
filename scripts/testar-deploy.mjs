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
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
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
  suite: "npm test -- --exigir-tudo; then",
  dump: 'ssh -n "$VPS" "/opt/fotonio-backup.sh"',
  migracao: 'scripts/migrar.mjs --aplicar"',
  empacotamento: "git archive --format=tar.gz",
  /* A migração da BANCADA, que é outra: sem aspas no fim, porque não viaja
     dentro de um comando ssh. É o que a distingue de `migracao` aqui. */
  bancada: "scripts/migrar.mjs --aplicar; then",
  guardaBancada: "guarda-producao.mjs",
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
 * ── A BANCADA EM DIA (16/09/2026) ─────────────────────────────────────────
 *
 * O portão de migração pergunta ao banco de PRODUÇÃO. Ninguém perguntava ao
 * LOCAL, e é contra ele que a suíte roda. Na publicação dos 29 ajustes o portão
 * devolveu quarenta suítes vermelhas — `column "slug" does not exist` — com o
 * código correto e a bancada três migrações atrás.
 */
etapa("a bancada local é migrada antes da suíte", () => {
  if (onde("bancada") > onde("suite")) {
    throw new Error("a suíte roda contra uma bancada que ninguém pôs em dia");
  }
  if (onde("tipos") > onde("bancada")) {
    throw new Error("mexe no banco antes de saber se o código compila");
  }
  return "depois dos tipos, antes da suíte";
});

etapa("o guarda de produção protege a migração da bancada", () => {
  /* Este passo aplica migração no que a DATABASE_URL apontar. Um `.env.local`
     copiado do servidor faria o deploy migrar PRODUÇÃO aqui — antes do portão,
     que é o estado exato que a ordem acima existe para impedir. */
  if (onde("guardaBancada") > onde("bancada")) {
    throw new Error("migra a bancada sem conferir se ela é mesmo uma bancada");
  }
  return "guarda-producao.mjs primeiro";
});

etapa("a bancada é migrada bem antes de tocar em produção", () => {
  if (onde("bancada") > onde("dump") || onde("bancada") > onde("migracao")) {
    throw new Error("a bancada só entra em dia depois de produção já ter mudado");
  }
  return "local primeiro, produção no fim";
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
etapa("suíte reprovada mostra o log do servidor do portão", () => {
  /*
   * 09/10/2026, depois de a quinta publicação reprovar sem explicação.
   *
   * O portão levanta um `next dev` e manda a saída dele para um arquivo que o
   * `trap` APAGA no fim. Quando a suíte reprova, a tela mostra só quais suítes
   * caíram — e a razão (rota que o Next não registrou, erro de compilação,
   * porta ocupada) fica naquele arquivo, que ninguém vê.
   *
   * Custou, naquele dia, uma investigação inteira terminando em "retenta e
   * torce": a rota existia no git, no build de produção e num servidor novo
   * aqui, e mesmo assim dava 404 lá. A informação que explicaria estava sendo
   * jogada fora na hora exata em que era necessária.
   */
  const i = roteiro.indexOf("suíte reprovada ou incompleta");
  if (i === -1) throw new Error("não achei a reprovação da suíte");
  const fim = roteiro.indexOf("exit 1", i);
  const bloco = roteiro.slice(i, fim === -1 ? i + 600 : fim);
  if (!/LOG_PORTAO/.test(bloco)) {
    throw new Error("a reprovação não despeja o log do servidor — o motivo do 404 some com o trap");
  }
});

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

/*
 * ── O SERVIDOR DO PORTÃO ──────────────────────────────────────────────────
 *
 * A suíte fala HTTP. Até 27/08/2026 ela falava com o servidor de
 * desenvolvimento na 3040 — compartilhado, e servindo a ÁRVORE DE TRABALHO, que
 * nesta máquina é a mesma pasta para todas as sessões.
 *
 * Duas consequências, e as duas aconteceram no mesmo dia:
 *
 *   · o servidor caiu no meio de uma publicação e nove suítes reprovaram com
 *     `fetch failed`, sem defeito nenhum no commit;
 *   · outra sessão editava a home enquanto o portão rodava, e o portão teria
 *     julgado uma página pela metade que não estava no pacote.
 *
 * O worktree fixado NÃO resolve isto. Ele isola a árvore e o HEAD; o servidor é
 * de quem está editando. Era a única das três corridas que nada acusava.
 *
 * A saída é o portão subir o SEU servidor, do próprio diretório, numa porta
 * livre — aí a suíte mede exatamente o que vai ser empacotado.
 */
etapa("o portão sobe o próprio servidor", () => {
  if (!roteiro.includes("PORTA_PORTAO")) {
    throw new Error(
      "o portão não levanta servidor próprio — a suíte julga a árvore de quem estiver " +
        "editando, e não o que vai no pacote",
    );
  }
  return "servidor do portão";
});

etapa("o servidor do portão sobe ANTES da suíte", () => {
  const i = roteiro.indexOf("PORTA_PORTAO");
  if (i < 0 || i > onde("suite")) throw new Error("sobe depois da suíte — não serve a ninguém");
  return "sobe antes";
});

etapa("a suíte é apontada para o servidor do portão", () => {
  /* Levantar e não apontar seria o pior dos mundos: um servidor a mais consumindo
   * memória e a suíte continuando a medir o da 3040. */
  if (!/BASE_URL="\$BASE_PORTAO"\s+npm test/.test(roteiro)) {
    throw new Error("subiu servidor próprio e não passou BASE_URL para a suíte");
  }
  return "BASE_URL aponta para ele";
});

etapa("o servidor do portão é derrubado ao fim, mesmo se a suíte reprovar", () => {
  /* Sem `trap`, o `exit 1` da suíte reprovada deixa um `next dev` órfão comendo
   * memória — e a cada tentativa de publicação, mais um. */
  if (!/trap .*EXIT/.test(roteiro)) {
    throw new Error("sem trap: portão vermelho deixaria servidor órfão");
  }
  return "trap na saída";
});

/*
 * ── A TRAVA DE PUBLICAÇÃO ─────────────────────────────────────────────────
 *
 * A quarta corrida, e a que sobrou depois das outras três.
 *
 * Em 27/08/2026 uma sessão publicou a release `113102-aaaaded` no meio da vez
 * de outra, que tinha reclamado a pista por mensagem. Não houve estrago por
 * SORTE de topologia — o commit em voo era filho direto do que subiu, então
 * nada se perdeu. Divergentes, seriam duas trocas de symlink brigando por
 * `/opt/fotonio` com cliente dentro.
 *
 * As três corridas anteriores (árvore suja, HEAD andando, servidor alheio)
 * foram fechadas por worktree fixado e servidor próprio do portão. Nenhuma
 * delas cobre esta: o conflito não é na máquina de quem publica, é no SERVIDOR.
 * Duas máquinas diferentes publicando ao mesmo tempo passariam por todos os
 * portões locais e colidiriam no `ln -sfn` mesmo assim.
 *
 * Por isso a trava mora NO SERVIDOR e não num arquivo do repositório: quem
 * publica pode nem estar nesta máquina. E por isso ela não substitui a fila por
 * mensagens — ela existe justamente para quem NÃO leu o canal.
 */
etapa("existe trava de publicação, e ela mora no servidor", () => {
  const p = path.join(RAIZ, "scripts/trava-publicacao.sh");
  if (!existsSync(p)) throw new Error("scripts/trava-publicacao.sh não existe");
  const trava = readFileSync(p, "utf8");
  if (!/ssh/.test(trava)) {
    throw new Error(
      "a trava não fala com o servidor — trava local não impede outra MÁQUINA de publicar",
    );
  }
  return "scripts/trava-publicacao.sh";
});

etapa("o deploy.sh pega a trava antes de empacotar", () => {
  const i = roteiro.indexOf("trava-publicacao.sh");
  if (i < 0) throw new Error("o deploy não chama a trava — ela não protege nada");
  if (i > onde("empacotamento")) throw new Error("pega a trava depois de empacotar — tarde demais");
  return "pega antes";
});

etapa("a trava é solta ao fim, mesmo se o portão reprovar", () => {
  /* Sem soltar, um portão vermelho deixa a publicação travada para todo mundo
   * até alguém descobrir e limpar à mão — remédio pior que a doença. */
  /* Procura a SOLTURA da trava, não um `trap` qualquer: o deploy já tem um
   * trap para derrubar o servidor do portão, e um regex frouxo casava com ele
   * e dava verde sem a trava existir. Teste que passa por engano é pior que
   * teste nenhum — este aqui passou assim antes de ser apertado. */
  if (!/trava-publicacao\.sh['" ]*soltar|soltar_trava/.test(roteiro)) {
    throw new Error("nada solta a trava: portão vermelho a deixaria presa para todos");
  }
  /*
   * E as duas limpezas têm de sair pelo MESMO trap. `trap ... EXIT` SUBSTITUI o
   * anterior em vez de somar — dois `trap` separados fazem o segundo apagar o
   * primeiro em silêncio, e aí ou a trava fica presa, ou o servidor do portão
   * fica órfão, dependendo da ordem. O último `trap` do arquivo precisa chamar
   * os dois.
   */
  const ultimoTrap = roteiro.lastIndexOf("trap ");
  const fim = roteiro.slice(ultimoTrap, ultimoTrap + 60);
  const nome = fim.match(/trap ([a-z_]+) EXIT/)?.[1];
  if (!nome) throw new Error("não achei o último trap EXIT");
  const corpo = roteiro.match(new RegExp(`${nome}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  const cobre = corpo.includes("soltar_trava") && corpo.includes("derrubar_portao");
  if (!cobre && nome !== "soltar_trava") {
    throw new Error(
      `o último trap chama "${nome}", que não cobre as duas limpezas — ` +
        `trap EXIT substitui o anterior, então uma das duas fica sem sair`,
    );
  }
  return `soltura no trap "${nome}"`;
});

/*
 * ── O ATALHO DA SUÍTE SÓ VALE PARA A MESMA ÁRVORE (10/10/2026) ─────────────
 *
 * O publicar.yml passa SUITE_VERIFICADA_NA_ARVORE quando o Verificar de um PR
 * já passou com a árvore que vai ao ar, e o deploy.sh pula a bancada, o
 * servidor do portão e a suíte. Errar esta regra é publicar código que nenhuma
 * suíte viu — então o teste RODA o trecho do deploy.sh num repositório de
 * mentira, em vez de procurar texto, e confere as quatro situações.
 */
etapa("o atalho da suíte exige a mesma árvore e a árvore de trabalho limpa", () => {
  const cru = readFileSync(path.join(RAIZ, "deploy.sh"), "utf8");
  const ini = cru.indexOf('SUITE_JA_VERIFICADA=""');
  const fimDoIf = cru.indexOf("\nfi\n", ini);
  if (ini < 0 || fimDoIf < 0) throw new Error("não achei o bloco SUITE_JA_VERIFICADA no deploy.sh");
  const trecho = cru.slice(ini, fimDoIf + 4) + 'printf %s "$SUITE_JA_VERIFICADA"';

  const dir = mkdtempSync(path.join(os.tmpdir(), "atalho-suite-"));
  try {
    const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
    git("init", "-q");
    writeFileSync(path.join(dir, "a.txt"), "um");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
    const arvore = git("rev-parse", "HEAD^{tree}");
    const roda = (valor) =>
      execFileSync("bash", ["-c", trecho], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, SUITE_VERIFICADA_NA_ARVORE: valor },
      });

    if (roda(arvore) !== "1") throw new Error("a mesma árvore, limpa, deveria pular a suíte");
    if (roda("") !== "") throw new Error("sem a variável a suíte tem de rodar");
    if (roda("0".repeat(40)) !== "") throw new Error("árvore diferente pulou a suíte");
    writeFileSync(path.join(dir, "a.txt"), "dois");
    if (roda(arvore) !== "") throw new Error("árvore de trabalho suja pulou a suíte");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return "mesma árvore e limpa pula; vazia, outra árvore ou suja rodam";
});

etapa("o atalho não pula tipos, lint nem a migração", () => {
  const ini = roteiro.indexOf('if [ -n "$SUITE_JA_VERIFICADA" ]; then');
  const fimBloco = roteiro.indexOf("fi # SUITE_JA_VERIFICADA");
  if (ini < 0 || fimBloco < 0) throw new Error("não achei o bloco que pula a suíte");
  const dentro = (chave) => {
    const i = onde(chave);
    return i > ini && i < fimBloco;
  };
  for (const chave of ["tipos", "dump", "migracao", "empacotamento"]) {
    if (dentro(chave)) throw new Error(`"${chave}" ficou dentro do bloco que o atalho pula`);
  }
  if (!dentro("suite")) throw new Error("a suíte não está dentro do bloco do atalho");
  const lint = roteiro.indexOf("npx eslint --format json");
  if (lint > ini && lint < fimBloco) throw new Error("o lint ficou dentro do bloco que o atalho pula");
  return "só bancada, servidor do portão e suíte ficam de fora";
});

console.log(falhou ? "\n✗ a ordem do deploy tem problema" : "\n✓ ordem do deploy ok");
process.exitCode = falhou ? 1 : 0;
