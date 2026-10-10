/*
 * ── O CORREDOR DAS SUÍTES PRECISA DE TETO (05/10/2026) ────────────────────
 *
 * Medido: uma execução de `testar-tudo` ficou 30 minutos sem imprimir UMA
 * linha e foi derrubada de fora. O `spawnSync` que roda cada suíte não tinha
 * `timeout`, e `spawnSync` captura a saída do filho: suíte pendurada segura o
 * corredor para sempre e ninguém vê sequer quais já tinham passado.
 *
 * É a mesma lição que o Atomatiza pagou com uma unidade `oneshot` sem
 * `TimeoutStartSec` — treze horas de produção sem o vigia rodar, e nada
 * acusando. Processo que pode pendurar precisa de teto, sempre.
 *
 * Isto se confere na fonte de propósito: para provar pelo comportamento seria
 * preciso plantar uma suíte que trava e rodar o corredor inteiro — vinte e
 * cinco minutos para medir um número que está escrito ali.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const fonte = readFileSync(path.join(AQUI, "testar-tudo.mjs"), "utf8");

let vermelhas = 0;
function etapa(nome, fn) {
  try {
    const nota = fn();
    console.log(`  ✓ ${nome}${nota ? ` — ${nota}` : ""}`);
  } catch (e) {
    vermelhas++;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

console.log("O corredor das suítes não pendura:\n");

etapa("cada suíte roda com teto de tempo", () => {
  const achou = /timeout:\s*([A-Z_]+|\d[\d_]*)/.exec(fonte);
  if (!achou) {
    throw new Error("`spawnSync` sem `timeout` — uma suíte pendurada trava o corredor inteiro");
  }
  return achou[1];
});

etapa("o teto é um número de minutos, não de segundos", () => {
  const nome = /timeout:\s*([A-Z_]+)/.exec(fonte)?.[1];
  const valor = nome
    ? Number(new RegExp(`const ${nome} = ([\\d_]+)`).exec(fonte)?.[1]?.replaceAll("_", ""))
    : Number(/timeout:\s*([\d_]+)/.exec(fonte)?.[1]?.replaceAll("_", ""));
  if (!Number.isFinite(valor)) throw new Error("não consegui ler o valor do teto");
  /* Abaixo de uns minutos o teto reprovaria suíte lenta honesta — as que
     sobem galeria e apagam mídia levam tempo de verdade. */
  if (valor < 120_000) throw new Error(`teto de ${valor} ms é curto demais e reprovaria suíte lenta honesta`);
  if (valor > 1_800_000) throw new Error(`teto de ${valor} ms é tão alto que não protege ninguém`);
  return `${valor / 60_000} min`;
});

etapa("estourar o teto é vermelho, e diz que foi o teto", () => {
  /* `spawnSync` que estoura o tempo volta com `status` nulo e `signal`
     preenchido. Sem olhar isso, o relatório diria só "morreu antes de
     relatar" — que é o contrário da verdade: ela não morreu, ela não acabou. */
  if (!/r\.signal/.test(fonte)) {
    throw new Error("o relatório não distingue suíte pendurada de suíte que quebrou");
  }
  return "distingue";
});

etapa("o corredor confere se o servidor ainda tem as rotas", () => {
  /*
   * Quatro vezes nesta sessao o `next dev` passou a devolver a PAGINA 404 em
   * HTML para uma rota de API que existe no disco. O teste que a usa reprova
   * com mensagens sem pe nem cabeca — "esperava 401, veio 404", "Unexpected
   * token <" — e manda procurar defeito no produto, que esta inteiro.
   *
   * Cada descoberta dessas custou uma suite inteira, que leva ~20 minutos.
   * Uma requisicao antes de comecar paga isso uma vez so.
   */
  if (!/rotasInteiras|servidorInteiro/.test(fonte)) {
    throw new Error("o corredor nao confere se o servidor perdeu rotas — a suite acusa defeito que nao existe");
  }
  return "confere";
});

etapa("quem espera o armazém dá mais prazo na CI", () => {
  /*
   * 09/10/2026, depois de `testar-servidor-zip` reprovar DUAS publicações com
   * "esperou demais" — e passar aqui todas as vezes.
   *
   * Não era defeito: ela monta um ZIP e espera. No runner a máquina é mais
   * lenta e o armazém é um MinIO ao lado, não o R2; cinco segundos que sobram
   * nesta mesa faltam lá. Prazo curto demais não encontra defeito nenhum, só
   * reprova quem está certo — e o preço é a publicação inteira parada.
   *
   * Prazo largo não custa nada quando o teste passa: ele só é esperado até a
   * condição acontecer.
   */
  const zip = readFileSync(path.join(AQUI, "testar-servidor-zip.mjs"), "utf8");
  if (!/process.env.CI/.test(zip)) {
    throw new Error("o prazo de espera do zip não olha a CI — vai reprovar de novo por lentidão");
  }
  return "prazo por ambiente";
});

if (vermelhas) {
  console.log(`\n✗ ${vermelhas} vermelha(s)\n`);
  process.exit(1);
}
console.log("\n✓ o corredor das suítes não pendura\n");
