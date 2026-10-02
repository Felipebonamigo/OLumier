#!/usr/bin/env node
/**
 * A CAPA DA PASTA ENVIADA COMO ARQUIVO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-capa-enviada-da-pasta.mjs
 *
 * Precisa do servidor de desenvolvimento rodando e do armazém configurado.
 *
 * ── O PEDIDO (01/10/2026) ─────────────────────────────────────────────────
 *
 * Juan: "dificuldade em alterar a capa das pastas, fazer ser mais fácil,
 * visível no começo da página, enviar uma nova foto ou escolher uma da
 * galeria".
 *
 * Escolher uma foto do capítulo já existia (migração 052). Subir uma imagem que
 * NÃO é da entrega — uma arte com o nome do capítulo, um convite, um frame
 * tratado — não existia: pelo caminho antigo o fotógrafo teria de subi-la como
 * foto do capítulo, e ela apareceria no meio das fotos do casal.
 *
 * ── A REGRA QUE ESTE ARQUIVO MAIS PRENDE ──────────────────────────────────
 *
 * A chave do objeto vem do NAVEGADOR na hora de confirmar. Sem conferir que ela
 * pertence a ESTE capítulo desta galeria deste estúdio, um pedido forjado
 * apontaria a capa de uma pasta para um objeto de outra conta. É o mesmo
 * cuidado da rota da capa da galeria, e está repetido aqui porque são duas
 * portas diferentes.
 *
 * ── E A SEGUNDA, QUE CUSTA DINHEIRO ───────────────────────────────────────
 *
 * Capa trocada, capítulo apagado e galeria destruída têm de levar o arquivo
 * antigo embora. Arquivo pago que nenhuma linha do banco cita é órfão — e desde
 * 02/10/2026 a varredura reconhece esta coluna (`testar-chaves-conhecidas`),
 * então ela NÃO vai recolher o que estes caminhos esquecerem: vai preservar.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { objetoExiste, urlDeUpload, armazenamentoConfigurado } from "../src/lib/r2.ts";
import { LIMITE_CAPA } from "../src/lib/capa-galeria.ts";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
};
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

if (!armazenamentoConfigurado) {
  console.log("A capa da pasta enviada: pulado — sem armazém nesta bancada");
  await db.end();
  process.exit(0);
}

/* PNG de 1×1 — o menor arquivo que é mesmo um PNG. O caminho é o que importa. */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const g = await galeriaDaRodada(db, { nome: "capa-pasta", medias: 4 });
const cookie = cookieDeSessao(g.tenant_id);
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);
/* Pastas é formato liberado por conta (ver `acesso-formatos.ts`): sem isto a
   galeria pública cai de volta na galeria de sempre e o teste da entrega
   mediria outra tela. */
await db.query("update tenants set formatos_liberados_em = now() where id = $1", [g.tenant_id]);
await db.query(
  `update galerias set aparencia = jsonb_set(coalesce(aparencia,'{}'::jsonb),'{formato}','"pastas"')
    where id = $1`,
  [g.id],
);

/* Dois capítulos com foto: Pastas só existe a partir de dois (`telaDaEntrega`). */
const secoes = [];
for (const [i, nome] of ["Cerimônia", "Festa"].entries()) {
  const { rows: [s] } = await db.query(
    "insert into secoes (galeria_id,nome,slug,ordem) values ($1,$2,$3,$4) returning id",
    [g.id, nome, ["cerimonia", "festa"][i], i],
  );
  secoes.push(s.id);
}
await db.query("update medias set secao_id=$2 where galeria_id=$1 and ordem < 2", [g.id, secoes[0]]);
await db.query("update medias set secao_id=$2 where galeria_id=$1 and ordem >= 2", [g.id, secoes[1]]);

const rota = (secaoId = secoes[1], galeriaId = g.id) =>
  `${BASE}/api/galerias/${galeriaId}/secoes/${secaoId}/capa`;
const pedir = (corpo, secaoId) =>
  fetch(rota(secaoId), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(corpo),
  });

console.log("A capa da pasta enviada como arquivo:\n");

await etapa("sem sessão, ninguém pede envio", async () => {
  const r = await fetch(rota(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mime: "image/png", bytes: png.length }),
  });
  igual(r.status, 401, "status");
});

await etapa("capítulo de OUTRA galeria não aceita capa", async () => {
  const outra = await galeriaDaRodada(db, { nome: "capa-pasta-vizinha", medias: 1 });
  const { rows: [s] } = await db.query(
    "insert into secoes (galeria_id,nome,slug,ordem) values ($1,'Alheia','alheia',0) returning id",
    [outra.id],
  );
  /* O id do capítulo é de outra galeria: a rota tem de recusar mesmo com a
     sessão certa e uma galeria que é desta conta. */
  const r = await pedir({ mime: "image/png", bytes: png.length }, s.id);
  igual(r.status, 404, "status");
});

await etapa("tipo e tamanho são recusados antes de gerar URL", async () => {
  igual((await pedir({ mime: "image/gif", bytes: 100 })).status, 415, "gif");
  igual((await pedir({ mime: "image/svg+xml", bytes: 100 })).status, 415, "svg");
  igual((await pedir({ mime: "image/png", bytes: 0 })).status, 415, "vazio");
  igual((await pedir({ mime: "image/png", bytes: LIMITE_CAPA + 1 })).status, 415, "grande");
});

let chave = null;

await etapa("o pedido devolve URL assinada, com a chave na pasta DESTE capítulo", async () => {
  const r = await pedir({ mime: "image/png", bytes: png.length });
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  chave = corpo.chave;
  const esperado = `${g.tenant_id}/${g.id}/capa-pasta/${secoes[1]}/`;
  if (!chave.startsWith(esperado)) throw new Error(`chave fora da pasta: ${chave}`);
  const envio = await fetch(corpo.url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  if (!envio.ok) throw new Error(`PUT no bucket: HTTP ${envio.status}`);
  return chave.slice(-20);
});

await etapa("confirmar com chave de FORA do capítulo é recusado", async () => {
  const forjada = `${g.tenant_id}/${g.id}/capa-pasta/${secoes[0]}/roubada.png`;
  const r = await fetch(rota(), {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ chave: forjada }),
  });
  igual(r.status, 400, "status");
  const { rows: [antes] } = await db.query("select capa_chave from secoes where id = $1", [secoes[1]]);
  igual(antes.capa_chave, null, "não gravou nada");
});

await etapa("confirmar grava a capa do capítulo", async () => {
  const r = await fetch(rota(), {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ chave }),
  });
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  const { rows: [depois] } = await db.query("select capa_chave from secoes where id = $1", [secoes[1]]);
  igual(depois.capa_chave, chave, "gravada");
  /* E só no capítulo pedido: a capa da Festa não é a capa da Cerimônia. */
  const { rows: [vizinho] } = await db.query("select capa_chave from secoes where id = $1", [secoes[0]]);
  igual(vizinho.capa_chave, null, "o outro capítulo ficou intacto");
});

await etapa("o arquivo enviado vence a foto escolhida", async () => {
  /* As duas coisas podem coexistir no banco; a leitura tem de ter ordem, e a
     ordem é a mesma da capa da galeria: arquivo > foto escolhida > primeira. */
  const { rows: [m] } = await db.query(
    "select id from medias where secao_id = $1 order by ordem limit 1",
    [secoes[1]],
  );
  await db.query("update secoes set capa_media_id = $1 where id = $2", [m.id, secoes[1]]);
  const { pastasNoDesign } = await import("../src/lib/entrega-no-design.ts");
  const pastas = await pastasNoDesign(g.id);
  const festa = pastas.find((p) => p.secaoId === secoes[1]);
  if (!festa) throw new Error("a pasta Festa não apareceu no Design");
  if (!festa.enviada) throw new Error("o Design não diz que a capa é arquivo enviado");
  const nome = chave.split("/").pop();
  if (!festa.capa?.includes(nome)) throw new Error("o Design mostra a foto, não o arquivo enviado");
  return "arquivo > foto escolhida";
});

await etapa("a entrega do cliente mostra a capa enviada na pasta", async () => {
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  const limpo = html.replaceAll("\\u0026", "&").replaceAll("&amp;", "&");
  const nome = chave.split("/").pop();
  if (!limpo.includes(nome)) throw new Error("a capa enviada não aparece nas pastas do cliente");
  return nome;
});

await etapa("a capa NÃO vira foto da galeria", async () => {
  const { rows: [m] } = await db.query(
    "select count(*)::int as n from medias where galeria_id = $1",
    [g.id],
  );
  igual(m.n, 4, "mídias da galeria");
});

await etapa("trocar a capa apaga o arquivo anterior", async () => {
  const r = await pedir({ mime: "image/png", bytes: png.length });
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  await fetch(corpo.url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
  const confirma = await fetch(rota(), {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ chave: corpo.chave }),
  });
  if (!confirma.ok) throw new Error(`confirmar: HTTP ${confirma.status}`);
  igual(await objetoExiste(chave), false, "o arquivo antigo no bucket");
  chave = corpo.chave;
  return "o antigo saiu";
});

await etapa("tirar a capa limpa a coluna E apaga o arquivo", async () => {
  const r = await fetch(rota(), { method: "DELETE", headers: { cookie } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows: [depois] } = await db.query("select capa_chave from secoes where id = $1", [secoes[1]]);
  igual(depois.capa_chave, null, "coluna limpa");
  igual(await objetoExiste(chave), false, "objeto no bucket");
});

await etapa("apagar o capítulo leva a capa dele embora", async () => {
  /* Capítulo apagado não devolve as fotos para o lixo — elas voltam para "sem
     capítulo" (migração 003). A capa enviada, porém, não tem para onde voltar:
     ou sai do bucket aqui, ou fica paga para sempre. */
  const alvo = secoes[0];
  const k = `${g.tenant_id}/${g.id}/capa-pasta/${alvo}/plantada-${Date.now()}.png`;
  await fetch(await urlDeUpload(k, "image/png", 600), {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  await db.query("update secoes set capa_chave = $1 where id = $2", [k, alvo]);
  const { apagarSecao } = await import("../src/lib/secoes.ts");
  await apagarSecao(alvo, g.tenant_id);
  igual(await objetoExiste(k), false, "objeto no bucket");
  return "capítulo apagado, arquivo apagado";
});

await etapa("destruir a galeria leva as capas das pastas embora", async () => {
  const outra = await galeriaDaRodada(db, { nome: "capa-pasta-destruir", medias: 1 });
  const { rows: [s] } = await db.query(
    "insert into secoes (galeria_id,nome,slug,ordem) values ($1,'Única','unica',0) returning id",
    [outra.id],
  );
  const k = `${outra.tenant_id}/${outra.id}/capa-pasta/${s.id}/plantada-${Date.now()}.png`;
  await fetch(await urlDeUpload(k, "image/png", 600), {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  await db.query("update secoes set capa_chave = $1 where id = $2", [k, s.id]);
  const { destruirGaleria } = await import("../src/lib/tenants.ts");
  await destruirGaleria(outra.id, "estudio");
  igual(await objetoExiste(k), false, "objeto no bucket");
  return "galeria destruída, arquivo apagado";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a capa da pasta enviada não fecha" : "\n✓ a capa da pasta enviada ok");
process.exitCode = falhou ? 1 : 0;
