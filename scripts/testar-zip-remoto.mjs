#!/usr/bin/env node
/**
 * O contrato entre o app e o servidor de ZIP — a parte pura. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs scripts/testar-zip-remoto.mjs
 *
 * O que se prende aqui é o que os DOIS lados precisam concordar: a assinatura
 * do pedido na URL, a chave de cache (e o que a muda), o relato, e o nome de
 * cada arquivo dentro do zip. Se um lado mudar sozinho, é aqui que aparece.
 */
import {
  assinarPedido,
  conferirPedidoAssinado,
  chaveDeCache,
  versaoDoConteudo,
  relatoValido,
  autorizacaoConfere,
  zipRemotoConfigurado,
  segredoDoZip,
  urlDoServidorDeZip,
} from "../src/lib/zip-remoto.ts";
import { entradasDoZip, nomeUnico, semProibidos } from "../src/lib/entradas-do-zip.ts";
import { intervaloDoRange } from "../servidor-zip/range.ts";

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, oque) => {
  if (a !== b) throw new Error(`${oque}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const SEGREDO = "s".repeat(40);
const ID = "0f6b2a1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

console.log("\nassinatura do pedido");

await etapa("assina e confere", () => {
  const token = assinarPedido(ID, SEGREDO);
  igual(conferirPedidoAssinado(token, SEGREDO), ID, "id conferido");
  return token.slice(0, 44) + "…";
});

await etapa("assinatura de outro segredo é recusada", () => {
  const token = assinarPedido(ID, "x".repeat(40));
  igual(conferirPedidoAssinado(token, SEGREDO), null, "token alheio");
});

await etapa("token mexido, sem ponto ou com id torto é recusado", () => {
  const token = assinarPedido(ID, SEGREDO);
  igual(conferirPedidoAssinado(token.slice(0, -1) + "A", SEGREDO), null, "último caractere trocado");
  igual(conferirPedidoAssinado(ID, SEGREDO), null, "sem assinatura");
  igual(conferirPedidoAssinado(`nao-e-uuid.${token.split(".")[1]}`, SEGREDO), null, "id torto");
  igual(conferirPedidoAssinado(token, ""), null, "sem segredo ninguém entra");
});

await etapa("sem segredo não assina; id que não é uuid não assina", () => {
  let estourou = 0;
  try {
    assinarPedido(ID, "");
  } catch {
    estourou++;
  }
  try {
    assinarPedido("abc", SEGREDO);
  } catch {
    estourou++;
  }
  igual(estourou, 2, "estouros");
});

console.log("\nconfiguração");

await etapa("só há servidor com URL E segredo de 32+", () => {
  igual(zipRemotoConfigurado({}), false, "vazio");
  igual(zipRemotoConfigurado({ ZIP_SERVIDOR_URL: "https://zip.x" }), false, "só url");
  igual(zipRemotoConfigurado({ ZIP_SERVIDOR_URL: "https://zip.x", ZIP_SEGREDO: "curto" }), false, "segredo curto");
  igual(zipRemotoConfigurado({ ZIP_SERVIDOR_URL: "https://zip.x/", ZIP_SEGREDO: SEGREDO }), true, "os dois");
  igual(urlDoServidorDeZip({ ZIP_SERVIDOR_URL: "https://zip.x///" }), "https://zip.x", "sem barra no fim");
  igual(segredoDoZip({ ZIP_SEGREDO: "curto" }), "", "segredo curto conta como ausente");
});

await etapa("o Bearer confere em tempo constante e recusa o resto", () => {
  igual(autorizacaoConfere(`Bearer ${SEGREDO}`, SEGREDO), true, "certo");
  igual(autorizacaoConfere(`Bearer ${SEGREDO}x`, SEGREDO), false, "a mais");
  igual(autorizacaoConfere(SEGREDO, SEGREDO), false, "sem Bearer");
  igual(autorizacaoConfere(null, SEGREDO), false, "sem cabeçalho");
  igual(autorizacaoConfere(`Bearer ${SEGREDO}`, ""), false, "sem segredo no servidor");
});

console.log("\nchave de cache");

const fotos = [
  { nome: "Festa/DSC_0001.jpg", tamanho: 100 },
  { nome: "Festa/DSC_0002.jpg", tamanho: 200 },
];

await etapa("só galeria inteira e capítulo são guardáveis", () => {
  igual(typeof chaveDeCache("g", "tudo", null, fotos), "string", "tudo");
  igual(typeof chaveDeCache("g", "capitulo", "s1", fotos), "string", "capítulo");
  igual(chaveDeCache("g", "favoritas", null, fotos), null, "favoritas");
  igual(chaveDeCache("g", "recorte", null, fotos), null, "recorte");
});

await etapa("a mesma lista dá a mesma chave, em qualquer ordem", () => {
  const a = versaoDoConteudo(fotos);
  const b = versaoDoConteudo([...fotos].reverse());
  igual(a, b, "ordem");
  return a;
});

await etapa("foto a mais, tamanho diferente ou nome diferente mudam a chave", () => {
  const base = chaveDeCache("g", "tudo", null, fotos);
  const maisUma = chaveDeCache("g", "tudo", null, [...fotos, { nome: "x.jpg", tamanho: 1 }]);
  const outroTamanho = chaveDeCache("g", "tudo", null, [fotos[0], { ...fotos[1], tamanho: 201 }]);
  const outroNome = chaveDeCache("g", "tudo", null, [fotos[0], { ...fotos[1], nome: "Festa/DSC_0002 (2).jpg" }]);
  const conjunto = new Set([base, maisUma, outroTamanho, outroNome]);
  igual(conjunto.size, 4, "chaves distintas");
});

await etapa("capítulos diferentes da mesma galeria não se confundem", () => {
  const a = chaveDeCache("g", "capitulo", "s1", fotos);
  const b = chaveDeCache("g", "capitulo", "s2", fotos);
  const soltas = chaveDeCache("g", "capitulo", null, fotos);
  const tudo = chaveDeCache("g", "tudo", null, fotos);
  igual(new Set([a, b, soltas, tudo]).size, 4, "quatro chaves");
});

await etapa("a chave só tem caracteres de nome de arquivo", () => {
  const c = chaveDeCache("0f6b2a1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b", "tudo", null, fotos);
  if (!/^[A-Za-z0-9._-]+$/.test(c)) throw new Error(`chave com caractere estranho: ${c}`);
  return c;
});

console.log("\nrelato");

await etapa("relato bem formado passa; qualquer campo torto reprova", () => {
  const bom = { pedidoId: ID, evento: "servido", bytes: 10, doCache: true, duracaoMs: 5 };
  igual(relatoValido(bom), true, "bom");
  for (const evento of ["montado", "abortado", "despejo", "trecho"]) {
    igual(relatoValido({ ...bom, evento }), true, `evento ${evento}`);
  }
  igual(relatoValido({ ...bom, evento: "clicou" }), false, "evento");
  igual(relatoValido({ ...bom, evento: 1 }), false, "evento número");
  igual(relatoValido({ ...bom, bytes: -1 }), false, "bytes negativos");
  igual(relatoValido({ ...bom, bytes: "10" }), false, "bytes string");
  igual(relatoValido({ ...bom, pedidoId: "x" }), false, "id");
  igual(relatoValido({ ...bom, doCache: "sim" }), false, "doCache");
  igual(relatoValido(null), false, "nulo");
});

console.log("\nnomes dentro do zip");

const entrega = (fotos, extras = {}) => ({
  titulo: "Ana & Kaio: casamento",
  tenantId: "t",
  fotos,
  capitulos: new Map([["s1", "Festa/Noite"]]),
  sufixo: "",
  tipo: "tudo",
  prefixar: true,
  grupoSolto: "Diversas",
  ...extras,
});
const media = (nome, secao, bytes = 10, versao = 1) => ({
  id: `id-${nome}`,
  nome_original: nome,
  secao_id: secao,
  bytes: String(bytes),
  versao,
  chave: `k/${nome}`,
  armazem: "b2",
});

await etapa("galeria inteira: uma pasta por capítulo, soltas no grupo do fotógrafo", () => {
  const { nomeDoZip, arquivos } = entradasDoZip(
    entrega([media("a.jpg", "s1"), media("b.jpg", null)]),
  );
  igual(nomeDoZip, "Ana & Kaio casamento.zip", "nome do zip sem os dois-pontos");
  igual(arquivos[0].nome, "Festa Noite/a.jpg", "capítulo vira pasta, sem a barra do nome");
  igual(arquivos[1].nome, "Diversas/b.jpg", "solta no grupo");
  igual(arquivos[0].tamanho, 10, "tamanho vem do banco");
});

await etapa("um capítulo só: sem pasta, e o sufixo no nome do zip", () => {
  const { nomeDoZip, arquivos } = entradasDoZip(
    entrega([media("a.jpg", "s1")], { tipo: "capitulo", sufixo: " - Festa/Noite" }),
  );
  igual(arquivos[0].nome, "a.jpg", "sem pasta");
  igual(nomeDoZip, "Ana & Kaio casamento - Festa Noite.zip", "sufixo");
});

await etapa("duas DSC_0001.jpg no mesmo capítulo não se sobrescrevem", () => {
  const { arquivos } = entradasDoZip(entrega([media("DSC_0001.jpg", "s1"), media("dsc_0001.JPG", "s1")]));
  igual(arquivos[1].nome, "Festa Noite/dsc_0001 (2).JPG", "a segunda ganha (2)");
});

await etapa("nomeUnico e semProibidos, nos cantos", () => {
  const usados = new Set();
  igual(nomeUnico("a", usados), "a", "primeiro");
  igual(nomeUnico("a", usados), "a (2)", "sem extensão");
  igual(nomeUnico("a", usados), "a (3)", "terceiro");
  igual(semProibidos('x:*?"<>|y'), "x y", "proibidos viram um espaço");
  igual(semProibidos("  a   b  "), "a b", "espaços dobrados");
});

console.log("\nRange");

await etapa("os formatos que o navegador manda ao retomar", () => {
  igual(JSON.stringify(intervaloDoRange("bytes=100-", 1000)), "[100,999]", "de onde parou");
  igual(JSON.stringify(intervaloDoRange("bytes=0-99", 1000)), "[0,99]", "trecho");
  igual(JSON.stringify(intervaloDoRange("bytes=-100", 1000)), "[900,999]", "últimos N");
  igual(JSON.stringify(intervaloDoRange("bytes=0-5000", 1000)), "[0,999]", "fim além do arquivo é cortado");
  igual(intervaloDoRange("bytes=1000-", 1000), null, "início no fim não existe");
  igual(intervaloDoRange("bytes=5-2", 1000), null, "invertido");
  igual(intervaloDoRange("items=0-1", 1000), null, "outra unidade");
  igual(intervaloDoRange(undefined, 1000), null, "sem cabeçalho");
});

process.exit(falhou ? 1 : 0);
