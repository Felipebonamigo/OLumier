#!/usr/bin/env node
/**
 * A galeria grande em partes. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-partes-do-zip.mjs
 *
 * Precisa do servidor de desenvolvimento rodando (a rota da lista de partes).
 *
 * Felipe, 10/10/2026: "ZIP em partes para galerias grandes". Um ZIP de 20 GB
 * numa conexão só, do servidor de ZIP até o Brasil, rende menos que várias
 * juntas e recomeça do zero numa queda. O que esta suíte prende:
 *
 *   - a divisão é contígua, de até 4 GB, e o filme maior que isso vai sozinho;
 *   - os nomes dentro do zip saem do zip INTEIRO: a segunda "DSC_0001.jpg"
 *     não vira a primeira na parte em que cair;
 *   - galeria pequena, capítulo e favoritas não são divididos;
 *   - parte além da última é recusada (a galeria mudou entre menu e clique);
 *   - a rota da lista respeita as travas e devolve a mesma divisão do clique;
 *   - o pedido grava a parte, e a parte entregue não vira "baixou tudo".
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

const { dividirEmPartes, nomeDaParte, lerParte, LIMITE_DA_PARTE } = await import("../src/lib/partes-do-zip.ts");
const { entradasDaParte } = await import("../src/lib/entradas-do-zip.ts");

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
  }
};

const GB = 1000 ** 3;
const media = (nome, secao, bytes) => ({
  id: `id-${nome}-${bytes}`,
  nome_original: nome,
  secao_id: secao,
  bytes: String(bytes),
  versao: 1,
  chave: `k/${nome}`,
  armazem: "b2",
});
const entrega = (fotos, extras = {}) => ({
  titulo: "Ana e Kaio",
  tenantId: "t",
  fotos,
  capitulos: new Map([["s1", "Cerimônia"], ["s2", "Festa"]]),
  sufixo: "",
  tipo: "tudo",
  prefixar: true,
  grupoSolto: "Diversas",
  ...extras,
});

console.log("As partes — as contas\n");

await etapa("contíguas, de até 4 GB, e o filme grande vai sozinho", () => {
  const t = (gb) => ({ tamanho: gb * GB });
  const partes = dividirEmPartes([t(1.5), t(1.5), t(1.5), t(9), t(0.5), t(3.9)]);
  igual(
    partes.map((p) => p.map((a) => a.tamanho / GB)),
    [[1.5, 1.5], [1.5], [9], [0.5], [3.9]],
    "divisão",
  );
  igual(dividirEmPartes([]), [], "vazio");
  igual(dividirEmPartes([t(4)]).length, 1, "exatamente 4 GB cabe numa");
  igual(LIMITE_DA_PARTE < 4 * 1024 ** 3, true, "abaixo do teto do FAT32");
  return "5 partes, o filme de 9 GB sozinho";
});

await etapa("nome da parte e a parte pedida no endereço", () => {
  igual(nomeDaParte("Ana e Kaio.zip", 2, 4), "Ana e Kaio - parte 2 de 4.zip", "nome");
  igual(nomeDaParte("sem extensao", 1, 2), "sem extensao - parte 1 de 2.zip", "sem .zip");
  igual([lerParte("3"), lerParte(null), lerParte("0"), lerParte("-1"), lerParte("2x"), lerParte("99999")], [3, null, null, null, null, null], "leitura");
  return "“… - parte 2 de 4.zip”";
});

await etapa("os nomes saem do zip inteiro, antes de dividir", () => {
  /* Duas DSC_0001.jpg na Cerimônia, cada uma numa parte. */
  const e = entrega([media("DSC_0001.jpg", "s1", 3 * GB), media("DSC_0001.jpg", "s1", 3 * GB), media("b.jpg", "s2", GB)]);
  const p1 = entradasDaParte(e, 1);
  const p2 = entradasDaParte(e, 2);
  igual(p1.parte, { numero: 1, de: 2 }, "parte 1");
  igual(p1.arquivos.map((a) => a.nome), ["Cerimônia/DSC_0001.jpg"], "parte 1");
  igual(p2.arquivos.map((a) => a.nome), ["Cerimônia/DSC_0001 (2).jpg", "Festa/b.jpg"], "parte 2 mantém o (2) e a pasta");
  igual(p2.nomeDoZip, "Ana e Kaio - parte 2 de 2.zip", "nome do zip");
  igual(entradasDaParte(e, 3), null, "parte além da última");
  igual(entradasDaParte(e, null).arquivos.length, 3, "sem parte, o zip inteiro");
  return "o (2) continua (2) na parte em que caiu";
});

await etapa("galeria pequena, capítulo e favoritas não se dividem", () => {
  const pequena = entrega([media("a.jpg", "s1", GB)]);
  igual(entradasDaParte(pequena, 1).parte, null, "parte 1 de 1 é o zip inteiro");
  igual(entradasDaParte(pequena, 1).nomeDoZip, "Ana e Kaio.zip", "nome de sempre");
  igual(entradasDaParte(pequena, 2), null, "não há parte 2");
  const capitulo = entrega([media("a.jpg", "s1", 3 * GB), media("b.jpg", "s1", 3 * GB)], { tipo: "capitulo" });
  igual(entradasDaParte(capitulo, 2).parte, null, "capítulo vem inteiro");
  igual(entradasDaParte(capitulo, 2).arquivos.length, 2, "as duas");
  return "só a galeria inteira";
});

/* ── A rota e o pedido ─────────────────────────────────────────────────── */

exigirBancoDeTeste();
const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { galeriaDaRodada, limparRodada } = await import("./fixture-de-teste.mjs");

try {
  /* Três fotos de "3 GB" — o tamanho é só o do banco: nenhuma rota aqui lê o
     original, só a lista. */
  const g = await galeriaDaRodada(db, { nome: "partes", medias: 3, publicada: true, bytes: 3 * GB });
  await db.query("update galerias set permite_download = true, senha_hash = null where id = $1", [g.id]);

  console.log(`\nAs partes — a rota\n`);

  await etapa("a lista das partes, com tamanho e quantidade", async () => {
    const r = await fetch(`${BASE}/api/g/${g.id}/zip/partes`);
    igual(r.status, 200, "status");
    igual(r.headers.get("cache-control")?.includes("no-store"), true, "sem cache");
    const { partes } = await r.json();
    igual(partes.map((p) => [p.numero, p.arquivos, p.bytes / GB]), [[1, 1, 3], [2, 1, 3], [3, 1, 3]], "partes");
    return "3 partes de 3 GB";
  });

  await etapa("as travas são as do zip", async () => {
    await db.query("update galerias set permite_download = false where id = $1", [g.id]);
    const r = await fetch(`${BASE}/api/g/${g.id}/zip/partes`);
    await db.query("update galerias set permite_download = true where id = $1", [g.id]);
    igual(r.status, 403, "download desligado");
    return "HTTP 403 sem download";
  });

  await etapa("o pedido grava a parte, e a parte entregue não é “baixou tudo”", async () => {
    const { prepararEntrega } = await import("../src/lib/entrega-da-galeria.ts");
    const { criarPedidoDeZip, lerPedidoDeZip, registrarEntregaDeZip } = await import("../src/lib/pedidos-zip.ts");
    const e = await prepararEntrega(g.id, new URLSearchParams());
    const quem = { ipHash: null, userAgent: "teste", pessoaId: null };
    const pedido = await criarPedidoDeZip(g.id, e, quem, null, 2);
    if (!pedido) throw new Error("o pedido da parte 2 não nasceu");
    if (!/ - parte 2 de 3\.zip$/.test(pedido.nomeDoZip)) throw new Error(`nome: ${pedido.nomeDoZip}`);
    const lido = await lerPedidoDeZip(pedido.id);
    igual([lido.parte, lido.entradas.length], [2, 1], "parte e entradas");
    igual(await criarPedidoDeZip(g.id, e, quem, null, 4), null, "parte 4 de 3");

    await registrarEntregaDeZip(lido, "servidor", { evento: "servido", bytes: 3 * GB, doCache: true, duracaoMs: 1000 });
    const inteiro = await criarPedidoDeZip(g.id, e, quem, null, null);
    await registrarEntregaDeZip(await lerPedidoDeZip(inteiro.id), "servidor", {
      evento: "servido",
      bytes: 9 * GB,
      doCache: true,
      duracaoMs: 1000,
    });
    const { rows } = await db.query("select acao from acessos where galeria_id = $1 order by id", [g.id]);
    igual(rows.map((r) => r.acao), ["baixou", "baixou_tudo"], "Atividade");

    /* O servidor de ZIP não muda: a parte chega a ele como um pedido com a
       própria lista, GUARDÁVEL, numa chave de cache só dela. */
    const { manifestoDoPedido } = await import("../src/lib/pedidos-zip.ts");
    const daParte = await manifestoDoPedido(lido, false);
    const doInteiro = await manifestoDoPedido(await lerPedidoDeZip(inteiro.id), false);
    igual([daParte.arquivos.length, doInteiro.arquivos.length], [1, 3], "arquivos no manifesto");
    if (!daParte.chaveDeCache || daParte.chaveDeCache === doInteiro.chaveDeCache) {
      throw new Error(`chave de cache: ${daParte.chaveDeCache} / ${doInteiro.chaveDeCache}`);
    }
    if (!/ - parte 2 de 3\.zip$/.test(daParte.nomeDoZip)) throw new Error(`nome no manifesto: ${daParte.nomeDoZip}`);
    return "parte → baixou · inteiro → baixou_tudo · manifesto guardável, chave própria";
  });

  await etapa("parte que sumiu responde 404 com o motivo, e não o zip inteiro", async () => {
    const r = await fetch(`${BASE}/api/g/${g.id}/zip?parte=9`, { redirect: "manual" });
    igual(r.status, 404, "status");
    const corpo = await r.json();
    if (!/galeria mudou/.test(corpo.erro)) throw new Error(corpo.erro);
    return "HTTP 404";
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ as partes do zip têm problema" : "\n✓ a galeria grande sai em partes que abrem sozinhas");
process.exitCode = falhou ? 1 : 0;
