/**
 * Abrir um zip com um descompactador DE VERDADE, o que existir na máquina.
 *
 * ── POR QUE NÃO UMA BIBLIOTECA ────────────────────────────────────────────
 *
 * Porque a pergunta que os testes de zip fazem não é "o meu código consegue
 * reler o que escreveu" — é "a pessoa do outro lado consegue abrir isto". Uma
 * biblioteca de zip em Node aceitaria com prazer um arquivo que o Explorer do
 * Windows recusa, e foi justamente esse defeito que a suíte pegou um dia. Ler
 * com a mesma caneta que escreveu não prova nada.
 *
 * ── POR QUE DEIXOU DE SER SÓ O POWERSHELL (17/09/2026) ────────────────────
 *
 * Os dois testes de zip chamavam `powershell -Command Expand-Archive` direto.
 * Na máquina do Felipe é o certo: o Windows é onde a noiva abre o arquivo. Num
 * runner Linux não existe powershell, o `spawnSync` volta com status nulo, e o
 * teste concluía "o Windows não abriu o zip" — acusando o zip de um defeito que
 * era da bancada. Três suítes vermelhas por isso.
 *
 * Então: onde houver Windows, continua sendo o Windows que julga. Onde não
 * houver, julga o `unzip`, que é um segundo par de olhos independente do código
 * que gerou o arquivo — que é o que dá valor à prova. A ferramenta usada volta
 * no retorno, para o teste poder dizer quem julgou.
 *
 * ── O ACENTO, E POR QUE O `unzip` PRECISA DE DUAS FLAGS (17/09/2026) ──────
 *
 * "Cerimônia - beijo no altar (1).jpg" saía do `unzip` como
 * `Cerim#U00f4nia - ...` e o teste acusava nome errado. Não era o zip: era o
 * `unzip` traduzindo o nome para o conjunto de caracteres da MÁQUINA, e o
 * runner roda em `LC_CTYPE=POSIX`, que não tem "ô" — então ele escapa o caractere
 * como `#U00f4`, que é o comportamento documentado dele.
 *
 * Medido aqui, com e sem ZIP64, em POSIX e em C.UTF-8 — e o resultado é o pior
 * possível para quem confia no padrão: **nenhuma das duas variáveis sozinha
 * acerta os quatro casos**. O `unzip` desta caixa honra o bit 11 (nomes em
 * UTF-8) nas entradas com campo extra, que são as do ZIP64, e IGNORA o bit nas
 * sem — tratando essas como CP437. Daí sair certo num caso e errado no outro,
 * com a mesma linha de comando:
 *
 *     zip comum  + POSIX     → certo (não traduz nada)
 *     zip comum  + C.UTF-8   → "Cerim├┤nia"  (leu como CP437)
 *     ZIP64      + POSIX     → "Cerim#U00f4nia" (leu UTF-8, não coube)
 *     ZIP64      + C.UTF-8   → certo
 *
 * `-UU` desliga a tradução de Unicode (nada de `#Uxxxx`) e `-O UTF-8` diz que os
 * nomes do arquivo já são UTF-8, cobrindo as entradas em que ele ignora o bit.
 * Juntas, as duas fazem os bytes do nome saírem como entraram — nos quatro
 * casos, em qualquer locale.
 *
 * O preço é honesto e está pago em outro lugar: dizendo "confie nos bytes", o
 * `unzip` deixa de ser juiz do bit 11, e um zip que esquecesse a flag passaria
 * por aqui. Quem julga o bit é o Windows, onde ele existe, e, onde não existe,
 * a conferência direta do diretório central em `testar-zip-em-fluxo.mjs` — pelo
 * mesmo motivo que o CRC é conferido à parte ali.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** true quando dá para pedir ao Windows — é ele quem manda, quando existe. */
function temPowershell() {
  if (process.platform !== "win32") return false;
  return (
    spawnSync("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
    }).status === 0
  );
}

/**
 * Quais flags de nome este `unzip` aceita — perguntadas a ele, não adivinhadas.
 *
 * `-UU` e `-O` são opcionais na compilação: num `unzip` sem elas a linha inteira
 * morre com "invalid option", e o teste voltaria a acusar o zip por um defeito
 * da bancada. Se faltarem, o que sobra é o comportamento sem tradução nenhuma —
 * que é justamente o que elas pedem.
 */
function flagsDeNome() {
  const ajuda = spawnSync("unzip", ["-h"], { encoding: "utf8" });
  const texto = `${ajuda.stdout ?? ""}${ajuda.stderr ?? ""}`;
  const flags = [];
  if (texto.includes("-UU")) flags.push("-UU");
  if (/-O\s+CHARSET/.test(texto)) flags.push("-O", "UTF-8");
  return flags;
}

/* Medido uma vez: são dois processos por zip aberto, e as suítes abrem vários. */
const POWERSHELL = temPowershell();
const FLAGS_DE_NOME = POWERSHELL ? [] : flagsDeNome();

/**
 * Grava o zip num diretório temporário e manda um descompactador abri-lo.
 *
 * @param zip      Buffer com o arquivo
 * @param nome     nome do arquivo temporário (padrão: "galeria.zip")
 * @returns {{dir, destino, codigo, msg, ferramenta}} — `codigo` 0 é sucesso;
 *          `msg` traz o que a ferramenta reclamou.
 */
export function abrirZip(zip, nome = "galeria.zip") {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-"));
  const arquivo = path.join(dir, nome);
  writeFileSync(arquivo, zip);
  const destino = path.join(dir, "saida");

  const r = POWERSHELL
    ? spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${arquivo}' -DestinationPath '${destino}' -Force`,
        ],
        { encoding: "utf8" },
      )
    : /* `-q` silencioso, `-d` destino. O unzip devolve 0 só quando abriu tudo;
         1 é "abriu com aviso", que para nós já é reprovação: a noiva não
         interpreta aviso. */
      spawnSync("unzip", ["-q", ...FLAGS_DE_NOME, arquivo, "-d", destino], { encoding: "utf8" });

  const ferramenta = POWERSHELL ? "Expand-Archive (Windows)" : "unzip";
  const msg = (r.stderr || r.error?.message || "").trim();
  return { dir, destino, codigo: r.status, msg, ferramenta };
}
