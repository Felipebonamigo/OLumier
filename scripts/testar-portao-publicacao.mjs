#!/usr/bin/env node
/**
 * Testa o portão de qualidade do `deploy.sh`. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-portao-publicacao.mjs
 *
 * Por que existe: até 26/08/2026 o `deploy.sh` publicava sem conferir NADA.
 * Nem tipo, nem teste, nem lint. Havia 14 erros de lint no repositório e a
 * publicação seguia normalmente — porque ninguém pergunta.
 *
 * O caso que dói não é o lint: é a suíte. `npm test` PULA em silêncio toda
 * suíte que fala HTTP quando o servidor de desenvolvimento está fora do ar, e
 * ainda assim sai com código 0. Um portão ingênuo — "rodei npm test e deu
 * zero" — passaria com 10 de 36 suítes e diria que está tudo conferido. É pior
 * que não ter portão: dá a segurança sem entregar a conferência.
 *
 * Por isso a regra de saída da suíte virou função à parte, e é ela que este
 * teste prende. O `--exigir-tudo` existe para o portão: no dia a dia pular é
 * aceitável, na hora de publicar não é.
 */
import { readFileSync } from "node:fs";

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
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

console.log("a regra de saída da suíte");

let codigoDeSaida;
try {
  ({ codigoDeSaida } = await import("./resultado-suite.mjs"));
} catch (e) {
  console.log(`  ✗ scripts/resultado-suite.mjs não pôde ser carregado — ${e.message}`);
  console.error("\n✗ o portão de publicação tem problema\n");
  process.exit(1);
}

/*
 * Vermelha é vermelha em qualquer contexto: rodando à toa ou publicando.
 */
etapa("suíte vermelha reprova sempre", () => {
  igual(codigoDeSaida({ vermelhas: 1, pulados: 0, exigirTudo: false }), 1, "sem exigir tudo");
  igual(codigoDeSaida({ vermelhas: 1, pulados: 0, exigirTudo: true }), 1, "exigindo tudo");
});

etapa("tudo verde e nada pulado aprova", () => {
  igual(codigoDeSaida({ vermelhas: 0, pulados: 0, exigirTudo: false }), 0, "sem exigir tudo");
  igual(codigoDeSaida({ vermelhas: 0, pulados: 0, exigirTudo: true }), 0, "exigindo tudo");
});

/*
 * O DIA A DIA continua tolerante: quem roda a suíte sem servidor no ar quer o
 * resultado do que dá para rodar, não uma reprovação. Mudar isso faria as
 * pessoas pararem de rodar a suíte, que é o pior desfecho possível.
 */
etapa("pulado NÃO reprova no uso comum", () => {
  igual(codigoDeSaida({ vermelhas: 0, pulados: 21, exigirTudo: false }), 0, "com pulados");
});

/*
 * O CORAÇÃO DO PORTÃO. Sem esta linha, publicar com o servidor fora do ar
 * conferiria 10 de 36 suítes e diria "tudo certo".
 */
etapa("pulado REPROVA quando se exige tudo", () => {
  igual(codigoDeSaida({ vermelhas: 0, pulados: 1, exigirTudo: true }), 1, "uma pulada");
  igual(codigoDeSaida({ vermelhas: 0, pulados: 21, exigirTudo: true }), 1, "muitas puladas");
});

console.log("\no portão dentro do deploy.sh");

const deploy = readFileSync(new URL("../deploy.sh", import.meta.url), "utf8");
const posicao = (agulha) => deploy.indexOf(agulha);

etapa("o portão confere os tipos", () => {
  if (!/tsc\s+--noEmit/.test(deploy)) {
    throw new Error("o deploy não roda `tsc --noEmit` — tipo quebrado sairia para produção");
  }
});

etapa("o portão exige a suíte INTEIRA, não a parcial", () => {
  if (!deploy.includes("--exigir-tudo")) {
    throw new Error(
      "o deploy não passa --exigir-tudo: a suíte pularia as rotas em silêncio e sairia com 0",
    );
  }
});

etapa("o portão olha o lint", () => {
  if (!/eslint/.test(deploy)) throw new Error("o deploy não menciona o eslint");
});

/*
 * Ordem importa mais que presença: portão depois do empacotamento é decoração.
 * O `git archive` é o primeiro passo irreversível do ponto de vista do
 * servidor — depois dele vem scp e ssh.
 */
/*
 * As âncoras são os COMANDOS, não as palavras. A primeira versão deste teste
 * procurava "git archive" e casava com o comentário que explica o portão —
 * texto que fala do comando não é o comando.
 */
etapa("o portão vem ANTES de empacotar e enviar", () => {
  const portao = posicao("npm test -- --exigir-tudo");
  const empacota = posicao("git archive --format=tar.gz");
  const envia = posicao("scp -q /tmp/fotonio-deploy.tar.gz");
  if (portao < 0 || empacota < 0 || envia < 0) throw new Error("não achei uma das etapas");
  if (portao > empacota) throw new Error("o portão roda DEPOIS de empacotar");
  if (portao > envia) throw new Error("o portão roda DEPOIS de enviar para o servidor");
  return "portão → empacota → envia";
});

console.log(falhou ? "\n✗ o portão de publicação tem problema\n" : "\n✓ portão de publicação ok\n");
process.exit(falhou ? 1 : 0);
