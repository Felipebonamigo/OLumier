#!/usr/bin/env node
/**
 * O VÍDEO CHEGA COM CAPA, E DÁ PARA ESCOLHER VÁRIOS DE UMA VEZ. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-poster-de-video.mjs
 *
 * Suíte PURA: sem banco, sem servidor. O que ela prende é a decisão de TIPO —
 * que é onde os dois defeitos moram — e a marcação do seletor de arquivos.
 *
 * ── OS DOIS PEDIDOS (29/09/2026) ──────────────────────────────────────────
 *
 * Juan, com um print da galeria no iPhone mostrando dois retângulos vazios com
 * um botão de play no meio:
 *
 *   "Os vídeos não tem uma visualização. Uma capa. Eles ficam assim."
 *   "Pelo celular, não estão conseguindo subir vários vídeos de uma vez.
 *    Tem que ir um a um."
 *
 * ── A CAPA: O MESMO DEFEITO DO HEIC DA CAROL, EM OUTRO ARQUIVO ────────────
 *
 * Gerar o pôster já existia desde sempre: `quadroDoVideo` abre o arquivo num
 * `<video>`, busca o segundo 1 e tira um quadro. O que decidia se esse caminho
 * rodava era `arquivo.type.startsWith("video/")` — ou seja, o mime que o
 * SISTEMA OPERACIONAL atribuiu ao arquivo.
 *
 * Esse mime vem VAZIO com frequência: o Windows não registra `.heic` (foi o que
 * derrubou 33 dos 74 envios da Carol em 29/09, algumas horas antes), e um `.mov`
 * ou `.mp4` compartilhado de outro aplicativo chega igual. Com o tipo vazio, o
 * vídeo escapava do ramo de vídeo, caía no `if (!arquivo.type.startsWith("image/"))
 * return null` logo abaixo e subia SEM miniatura nenhuma. O ladrilho vazio do
 * print do Juan é exatamente isso.
 *
 * O servidor já não confia no mime desde aquele dia — `reconhecerArquivo` cai na
 * extensão quando ele não diz nada. Faltava o navegador usar a MESMA regra.
 *
 * ── O SELETOR: `accept` COM LISTA FECHADA ─────────────────────────────────
 *
 * O `accept` listava nove mimes exatos. No iPhone, a lista fechada é o caminho
 * conhecido para o seletor de fotos entregar um arquivo por vez; `image/*` e
 * `video/*` são as formas que ele entende para abrir a biblioteca inteira com
 * seleção múltipla.
 *
 * ⚠ Esta parte NÃO foi confirmada num iPhone de verdade — não há um aqui. O que
 * este arquivo prende é a marcação; a confirmação é do Juan, no aparelho dele.
 * Afrouxar o `accept` não afrouxa nada de verdade: quem decide o que entra é o
 * servidor, que devolve 415 para o que não estiver em `TIPOS_ACEITOS`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { reconhecerArquivo, TIPOS_ACEITOS } from "../src/lib/tipos-de-arquivo.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const extra = fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    falhou = true;
    console.error(`  ✗ ${nome} — ${e.message}`);
  }
};

console.log("Capa do vídeo e seleção múltipla\n");

etapa("vídeo sem mime nenhum ainda é reconhecido como vídeo", () => {
  for (const [nome, esperado] of [
    ["FILME.MOV", "video/quicktime"],
    ["clipe.mp4", "video/mp4"],
    ["saida.webm", "video/webm"],
  ]) {
    const r = reconhecerArquivo(nome, "");
    if (!r) throw new Error(`"${nome}" com mime vazio foi recusado`);
    if (r.tipo !== "video") throw new Error(`"${nome}" virou ${r.tipo}`);
    if (r.mime !== esperado) throw new Error(`"${nome}" resolveu ${r.mime}, esperava ${esperado}`);
  }
  return "MOV, MP4 e WEBM";
});

etapa("o mime conhecido continua mandando na extensão", () => {
  /* A ordem é a regra, e ela não pode inverter: o mime é o único dos dois que
     o navegador de fato conferiu. */
  const r = reconhecerArquivo("foto.jpg", "image/png");
  if (r?.mime !== "image/png") throw new Error(`resolveu ${r?.mime}, e não image/png`);
  return "image/png venceu .jpg";
});

etapa("arquivo sem mime E sem extensão conhecida continua recusado", () => {
  /* A saída pela extensão não pode virar porta dos fundos. */
  if (reconhecerArquivo("backup.zip", "")) throw new Error("um .zip passou");
  if (reconhecerArquivo("virus.exe", "application/x-msdownload")) throw new Error("um .exe passou");
  return "zip e exe recusados";
});

/**
 * O arquivo SEM os comentários.
 *
 * Sem isto, o comentário que EXPLICA o defeito — e que precisa citar a linha
 * antiga para a próxima sessão entender o que mudou — faria a conferência
 * acusar o defeito que ele descreve. Teste que não separa código de prosa
 * obriga a escrever comentário ruim.
 */
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const derivadas = semComentarios(
  readFileSync(path.join(RAIZ, "src/lib/derivadas-client.ts"), "utf8"),
);

etapa("o gerador de miniatura NÃO decide pelo mime cru do arquivo", () => {
  /*
   * A linha que causava o ladrilho vazio era literalmente esta:
   *     if (arquivo.type.startsWith("video/")) { ... }
   * Com o tipo vazio, o vídeo pulava o ramo dele e saía sem miniatura.
   */
  const cru = derivadas.match(/arquivo\.type\.startsWith\(\s*"(video|image)\//g) ?? [];
  if (cru.length) {
    throw new Error(
      `${cru.length} decisão(ões) ainda olham \`arquivo.type\` direto: ${[...new Set(cru)].join(", ")}`,
    );
  }
  if (!/reconhecerArquivo\(/.test(derivadas)) {
    throw new Error("o gerador não usa `reconhecerArquivo` — não há como cair na extensão");
  }
  return "usa a mesma regra do servidor";
});

const enviar = semComentarios(
  readFileSync(path.join(RAIZ, "src/components/enviar-arquivos.tsx"), "utf8"),
);

etapa("o seletor de arquivos abre a biblioteca inteira, com seleção múltipla", () => {
  const aceita = enviar.match(/accept="([^"]*)"/)?.[1];
  if (!aceita) throw new Error("não achei o `accept` do seletor");
  for (const curinga of ["image/*", "video/*"]) {
    if (!aceita.includes(curinga)) {
      throw new Error(`o \`accept\` não tem ${curinga}: "${aceita}"`);
    }
  }
  /* `multiple` sem curinga não basta no iPhone, e curinga sem `multiple` não
     seleciona vários em lugar nenhum. Os dois, ou nenhum dos dois serve. */
  const entradas = enviar.match(/<input[^>]*id="escolher-arquivos"[^>]*>/s)?.[0] ?? "";
  const bloco = entradas || enviar.slice(enviar.indexOf('id="escolher-arquivos"') - 200);
  if (!/multiple/.test(bloco)) throw new Error("o seletor de arquivos não é `multiple`");
  return aceita;
});

etapa("o servidor continua sendo quem decide o que entra", () => {
  /*
   * Afrouxar o `accept` só muda o que o SELETOR oferece. Se a lista do servidor
   * também afrouxasse, um `.zip` entraria — e é isso que esta etapa impede.
   */
  const tipos = Object.keys(TIPOS_ACEITOS);
  if (tipos.length !== 9) throw new Error(`${tipos.length} tipos aceitos, esperava 9`);
  if (tipos.some((t) => t.includes("*"))) throw new Error("o servidor aceitou um curinga");
  return `${tipos.length} tipos exatos`;
});

console.log(falhou ? "\n✗ o vídeo ainda chega sem capa" : "\n✓ capa do vídeo ok");
process.exitCode = falhou ? 1 : 0;
