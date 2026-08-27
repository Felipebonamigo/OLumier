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
  suite: "npm test -- --exigir-tudo; then",
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

console.log(falhou ? "\n✗ a ordem do deploy tem problema" : "\n✓ ordem do deploy ok");
process.exitCode = falhou ? 1 : 0;
