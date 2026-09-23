#!/usr/bin/env node
/**
 * O cabeçalho que dá nome ao arquivo baixado. Uso:
 *   node --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-content-disposition.mjs
 *
 * ── O DEFEITO ─────────────────────────────────────────────────────────────
 *
 * 11/09/2026, a Carol tentando salvar uma foto no celular. O navegador saiu da
 * galeria, foi parar no Backblaze e mostrou:
 *
 *     InvalidRequest invalid b2-content-disposition:
 *     expected a token character at 139, but got '('
 *
 * O `(` era do nome do arquivo — "… (1).jpg" é o nome mais comum que sai de
 * uma pasta de fotos. Ele ia parar no `filename*=UTF-8''…`, e ali a RFC 5987
 * não aceita parêntese: só letras, dígitos, uma lista curta de símbolos, e
 * `%XX`. `encodeURIComponent` NÃO resolve isso — por desenho ele deixa passar
 * `!'()*` sem codificar, e de todos esses só o `!` é legal num ext-value.
 *
 * O R2 engolia. O B2 recusa, e é lá que mora o ORIGINAL — exatamente o arquivo
 * que "salvar no celular" baixa. Por isso o defeito só aparecia no download da
 * foto em tamanho cheio, e não na galeria.
 *
 * ── POR QUE O TESTE É DA FUNÇÃO, E NÃO UMA IDA AO B2 ──────────────────────
 *
 * O ambiente de desenvolvimento não tem `ARQUIVOS_*` configurado: aqui não há
 * B2 para perguntar. E não faria falta — a regra que o B2 aplica está escrita
 * na RFC, e é ela que este arquivo confere. Um teste que dependesse do B2
 * ficaria pulado justamente na máquina onde o código é escrito.
 */
import { dispositionSegura } from "../src/lib/r2.ts";

let falhou = false;
const ok = (m, extra) => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ""}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

/*
 * `attr-char` da RFC 5987, escrito à mão de propósito: copiar a lista do
 * código que está sendo testado faria o teste concordar com o defeito.
 *
 *   attr-char = ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+" / "-" /
 *               "." / "^" / "_" / "`" / "|" / "~"
 *
 * Tudo o mais precisa vir como %XX. Repare no que NÃO está na lista e sai de
 * nome de foto todo dia: parêntese, apóstrofo, asterisco, espaço, vírgula.
 */
const EXT_VALUE_VALIDO = /^(?:[A-Za-z0-9!#$&+\-.^_`|~]|%[0-9A-Fa-f]{2})*$/;

const NOMES = [
  ["o caso da Carol", "Casamento Ana & Kaio - Festa - DSC_1234 (1).jpg"],
  ["apóstrofo e asterisco", "foto d'água *destaque*.jpg"],
  ["acento e travessão", "Cerimônia — beijo no altar.jpg"],
  ["vírgula e ponto e vírgula", "Ana, Kaio; os dois.jpg"],
  ["parênteses aninhados", "making of (noiva (2)).jpg"],
  ["sinal de porcento no nome", "desconto 50% .jpg"],
  ["só extensão", ".jpg"],
  ["nome vazio", ""],
];

console.log("O nome do arquivo vira cabeçalho\n");

for (const [caso, nome] of NOMES) {
  const cabecalho = dispositionSegura(nome);

  const ext = cabecalho.match(/filename\*=UTF-8''(.*)$/)?.[1];
  if (ext === undefined) {
    erro(`${caso}: o cabeçalho não trouxe \`filename*\``);
    continue;
  }

  if (!EXT_VALUE_VALIDO.test(ext)) {
    const ruim = [...ext].find((c) => !/[A-Za-z0-9!#$&+\-.^_`|~%]/.test(c));
    erro(`${caso}: o B2 recusaria — caractere '${ruim}' solto em \`${ext.slice(0, 60)}\``);
    continue;
  }

  /* Escapar não pode virar mutilar: o nome tem de voltar inteiro do outro
     lado, senão o casal recebe "Cerimo%CC%82nia.jpg" no telefone. */
  let voltou;
  try {
    voltou = decodeURIComponent(ext);
  } catch {
    erro(`${caso}: o ext-value não decodifica de volta`);
    continue;
  }
  const esperado = (nome.replace(/[\r\n"\\]/g, "").slice(0, 200) || "arquivo");
  if (voltou !== esperado) {
    erro(`${caso}: o nome voltou "${voltou}", esperava "${esperado}"`);
    continue;
  }

  ok(caso, ext.length > 48 ? `${ext.slice(0, 45)}…` : ext);
}

console.log("\nA parte entre aspas, para navegador antigo\n");

{
  /* A metade velha do cabeçalho tem outra regra, e ela já existia: nada de
     aspas, barra invertida ou quebra de linha, senão o nome deixa de ser nome
     e vira cabeçalho injetado. */
  const veneno = 'foto".jpg\r\nX-Coisa: sim\\';
  const cabecalho = dispositionSegura(veneno);
  const entreAspas = cabecalho.match(/filename="([^"]*)"/)?.[1];
  if (entreAspas === undefined) {
    erro("o cabeçalho não trouxe `filename=` entre aspas");
  } else if (/["\\\r\n]/.test(entreAspas)) {
    erro(`sobrou aspas, barra ou quebra de linha em \`${entreAspas}\``);
  } else if (/\r|\n/.test(cabecalho)) {
    erro("o cabeçalho inteiro ainda tem quebra de linha");
  } else {
    ok("aspas, barra e quebra de linha somem do nome", entreAspas);
  }

  /* Fora do ASCII vira `_` na parte velha — é o que ela sabe carregar. O nome
     de verdade viaja no `filename*`, que é o que todo navegador atual lê. */
  const comAcento = dispositionSegura("Cerimônia.jpg");
  const ascii = comAcento.match(/filename="([^"]*)"/)?.[1];
  if (ascii && /^[\x20-\x7E]*$/.test(ascii)) ok("acento só na parte moderna", ascii);
  else erro(`a parte ASCII trouxe algo fora do ASCII: ${ascii}`);
}

if (falhou) {
  console.error("\n✗ o cabeçalho do download tem problema");
  process.exit(1);
}
console.log("\n✓ o nome do arquivo sobrevive ao B2 e ao navegador");
