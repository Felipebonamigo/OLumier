#!/usr/bin/env node
/**
 * Testa a fila de envio em massa. Uso:
 *   node --env-file=.env.local scripts/testar-fila-upload.mjs
 *
 * O cenário real é a pasta do casamento com 600 fotos. Aqui verificamos as três
 * coisas que decidem se isso funciona: paralelismo, retentativa e o descarte do
 * lixo que vem junto quando se arrasta uma pasta.
 */
import { createHmac } from "node:crypto";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const mod = await import("../src/lib/fila-upload.ts");

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

console.log("Fila:\n");

await etapa("envia em paralelo, respeitando o limite", async () => {
  let simultaneos = 0;
  let pico = 0;
  const itens = Array.from({ length: 12 }, (_, i) => i);
  await mod.emParalelo(itens, mod.PARALELOS, async () => {
    simultaneos++;
    pico = Math.max(pico, simultaneos);
    await new Promise((r) => setTimeout(r, 30));
    simultaneos--;
  });
  if (pico > mod.PARALELOS) throw new Error(`passou do limite: ${pico}`);
  if (pico < mod.PARALELOS) throw new Error(`não paralelizou: pico ${pico}`);
  return `12 arquivos, pico de ${pico} simultâneos`;
});

await etapa("processa TODOS os itens da fila", async () => {
  const feitos = new Set();
  const itens = Array.from({ length: 25 }, (_, i) => i);
  await mod.emParalelo(itens, 4, async (it) => {
    await new Promise((r) => setTimeout(r, 5));
    feitos.add(it);
  });
  if (feitos.size !== 25) throw new Error(`processou ${feitos.size} de 25`);
  return "25 de 25";
});

await etapa("tenta de novo e vence na segunda", async () => {
  let tentativas = 0;
  const r = await mod.comRetentativa(async () => {
    tentativas++;
    if (tentativas < 2) throw new Error("rede caiu");
    return "ok";
  });
  if (r !== "ok" || tentativas !== 2) throw new Error(`resultado ${r} em ${tentativas} tentativas`);
  return "2 tentativas";
});

await etapa("desiste depois do limite, sem travar a fila", async () => {
  let tentativas = 0;
  const t0 = Date.now();
  try {
    await mod.comRetentativa(async () => {
      tentativas++;
      throw new Error("servidor fora");
    });
    throw new Error("deveria ter falhado");
  } catch (e) {
    if (e.message !== "servidor fora") throw e;
  }
  if (tentativas !== mod.TENTATIVAS) throw new Error(`tentou ${tentativas}`);
  return `${tentativas} tentativas em ${((Date.now() - t0) / 1000).toFixed(1)}s (espera crescente)`;
});

console.log("\nPasta arrastada:\n");

const arq = (nome, size = 1000, type = "image/jpeg") => ({ name: nome, size, type });

await etapa("descarta o lixo que vem junto da pasta", async () => {
  const entrada = [
    arq("IMG_001.jpg"),
    arq(".DS_Store", 6148, ""),
    arq("Thumbs.db", 8192, ""),
    arq("._IMG_002.jpg"),
    arq("vazio.jpg", 0),
    arq("contrato.pdf", 5000, "application/pdf"),
    arq("filme.mp4", 90000, "video/mp4"),
  ];
  const aceitos = entrada.filter(mod.arquivoAceito).map((f) => f.name);
  const esperado = ["IMG_001.jpg", "filme.mp4"];
  if (JSON.stringify(aceitos) !== JSON.stringify(esperado)) {
    throw new Error(`aceitou ${aceitos.join(", ")}`);
  }
  return `${entrada.length} arquivos → ${aceitos.length} válidos`;
});

await etapa("ordena como o fotógrafo espera (2 antes de 10)", async () => {
  const nomes = ["foto_10.jpg", "foto_2.jpg", "foto_1.jpg", "foto_20.jpg"];
  const ordenado = mod.ordenarNatural(nomes.map((n) => arq(n))).map((f) => f.name);
  const esperado = ["foto_1.jpg", "foto_2.jpg", "foto_10.jpg", "foto_20.jpg"];
  if (JSON.stringify(ordenado) !== JSON.stringify(esperado)) {
    throw new Error(ordenado.join(", "));
  }
  return ordenado.join(" · ");
});

// --- envio para capítulo, contra a rota de verdade --------------------------

const { DATABASE_URL, SESSION_SECRET } = process.env;
if (DATABASE_URL && SESSION_SECRET) {
  console.log("\nEnvio direto para o capítulo:\n");
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();

  const { rows } = await db.query(
    `select g.id, t.id tid from galerias g join tenants t on t.id = g.tenant_id
      order by g.criado_em limit 1`,
  );
  const { id: galeriaId, tid } = rows[0];
  const expira = Date.now() + 120_000;
  const dados = `${tid}.${expira}`;
  const cookie = `fotonio_sessao=${dados}.${createHmac("sha256", SESSION_SECRET).update(dados).digest("hex")}`;

  const { rows: secs } = await db.query(
    "select id, nome from secoes where galeria_id = $1 order by ordem limit 1",
    [galeriaId],
  );

  if (secs.length > 0) {
    await etapa("foto enviada já nasce no capítulo escolhido", async () => {
      const r = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          nome: "teste-capitulo.jpg",
          mime: "image/jpeg",
          bytes: 2048,
          secaoId: secs[0].id,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? `HTTP ${r.status}`);
      const { rows: m } = await db.query("select secao_id from medias where id = $1", [d.mediaId]);
      if (m[0].secao_id !== secs[0].id) throw new Error("não entrou no capítulo");
      await db.query("delete from medias where id = $1", [d.mediaId]);
      return `direto em "${secs[0].nome}"`;
    });

    await etapa("capítulo de OUTRA galeria é recusado", async () => {
      const { rows: outra } = await db.query(
        `insert into galerias (tenant_id, slug, titulo) values ($1, 'temp-teste-fila', 'Temp')
         returning id`,
        [tid],
      );
      const { rows: sOutra } = await db.query(
        "insert into secoes (galeria_id, nome) values ($1, 'Intrusa') returning id",
        [outra[0].id],
      );
      const r = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          nome: "intruso.jpg",
          mime: "image/jpeg",
          bytes: 2048,
          secaoId: sOutra[0].id,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? `HTTP ${r.status}`);
      const { rows: m } = await db.query("select secao_id from medias where id = $1", [d.mediaId]);
      if (m[0].secao_id !== null) throw new Error("aceitou capítulo de outra galeria!");
      await db.query("delete from medias where id = $1", [d.mediaId]);
      await db.query("delete from galerias where id = $1", [outra[0].id]);
      return "ignorado, foto fica sem capítulo";
    });
  }
  await db.end();
}

if (falhou) {
  console.error("\n✗ a fila de envio tem problema");
  process.exit(1);
}
console.log(`\n✓ fila de envio em massa íntegra (${mod.PARALELOS} paralelos, ${mod.TENTATIVAS} tentativas)`);
