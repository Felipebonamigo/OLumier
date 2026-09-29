#!/usr/bin/env node
/**
 * Acha os vídeos cuja capa não é capa de nada — e os devolve para a fila.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/capas-de-video.mjs
 *   ... scripts/capas-de-video.mjs --aplicar
 *
 * ── POR QUE ELE EXISTE (29/09/2026) ───────────────────────────────────────
 *
 * Juan mandou um print com ladrilhos de vídeo vazios. O primeiro diagnóstico
 * foi "falta a miniatura", e havia um defeito real ali — mas ele explicava dois
 * vídeos. Baixando as 46 capas de produção e comparando o CONTEÚDO:
 *
 *     46 vídeos · 2 sem capa nenhuma
 *     41 com a mesma imagem em branco de ~4 KB, em três estúdios diferentes
 *      3 com capa de verdade
 *
 * O gerador já foi consertado (`derivadas-client.ts`), e quem subir daqui para
 * frente sai com capa boa. Este script é para as que já estão gravadas.
 *
 * ── O QUE ELE NÃO FAZ, E POR QUÊ ──────────────────────────────────────────
 *
 * Ele NÃO gera a capa. Gerar exige decodificar o vídeo, e não há ffmpeg no VPS
 * (conferido: `command -v ffmpeg` e `ffprobe` vazios). Instalar não resolveria
 * de graça: o original mora no Backblaze, então o servidor teria de BAIXAR cada
 * filme para tirar um quadro dele.
 *
 * Quem decodifica vídeo neste produto é o NAVEGADOR do fotógrafo, e é assim
 * desde sempre — a mesma razão pela qual o arquivo não passa pelo servidor. Por
 * isso a divisão de trabalho é:
 *
 *   este script  → descobre quem precisa, e zera a coluna da capa mentirosa
 *   a aba Vídeo  → o fotógrafo abre e o navegador dele gera as que faltam
 *
 * Zerar `chave_thumb` não apaga nada do fotógrafo: o vídeo continua inteiro, e a
 * galeria volta a desenhar o ladrilho de sempre — exatamente como ela já está
 * hoje, com a capa branca. O objeto órfão no armazém fica para `varrer-orfaos`.
 *
 * Sem `--aplicar` ele só relata.
 */
import pg from "pg";
import { createHash } from "node:crypto";
import { urlDaDerivada, armazemDe } from "../src/lib/armazem.ts";
import { classificarCapas, paraRegerar } from "./capas-de-video-regras.mjs";

const APLICAR = process.argv.includes("--aplicar");

if (!process.env.DATABASE_URL) {
  console.error("✗ falta DATABASE_URL");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { rows } = await db.query(`
  select m.id, m.chave_thumb, m.armazem, m.nome_original, g.titulo, t.nome_estudio
    from medias m
    join galerias g on g.id = m.galeria_id
    join tenants t on t.id = m.tenant_id
   where m.pronto and m.tipo = 'video'
   order by t.nome_estudio, g.titulo, m.nome_original
`);

console.log(`${rows.length} vídeo${rows.length === 1 ? "" : "s"} no banco. Lendo as capas…\n`);

const medidos = [];
let ilegiveis = 0;
for (const r of rows) {
  let hash = null;
  let bytes = null;
  if (r.chave_thumb) {
    try {
      /* A mesma assinatura que a galeria usa para servir a miniatura — se ela
         não abre por aqui, não abre para o cliente também. */
      const url = await urlDaDerivada(r.chave_thumb, r.chave_thumb, armazemDe(r.armazem), 300);
      const resposta = await fetch(url);
      if (resposta.ok) {
        const buf = Buffer.from(await resposta.arrayBuffer());
        bytes = buf.length;
        hash = createHash("sha1").update(buf).digest("hex");
      } else {
        ilegiveis++;
      }
    } catch {
      ilegiveis++;
    }
  }
  medidos.push({
    id: r.id,
    chave: r.chave_thumb,
    bytes,
    hash,
    galeria: `${r.nome_estudio} · ${r.titulo}`,
    nome: r.nome_original,
  });
}

const classificadas = classificarCapas(medidos);
const fila = paraRegerar(classificadas);

const porSituacao = new Map();
for (const c of classificadas) {
  if (!porSituacao.has(c.situacao)) porSituacao.set(c.situacao, []);
  porSituacao.get(c.situacao).push(c);
}

const ROTULOS = {
  ok: "capa de verdade",
  "sem-capa": "sem capa",
  "de-fabrica": "capa de fábrica (a mesma de outros)",
  suspeita: "capa pequena demais",
};
for (const situacao of ["ok", "sem-capa", "de-fabrica", "suspeita"]) {
  const lista = porSituacao.get(situacao) ?? [];
  if (!lista.length) continue;
  console.log(`${String(lista.length).padStart(3)} · ${ROTULOS[situacao]}`);
  if (situacao !== "ok") {
    for (const c of lista.slice(0, 8)) {
      console.log(`      ${c.galeria} — ${c.nome} (${c.motivo})`);
    }
    if (lista.length > 8) console.log(`      e mais ${lista.length - 8}`);
  }
}
if (ilegiveis) console.log(`\n⚠ ${ilegiveis} miniatura(s) não puderam ser lidas do armazém.`);

if (!fila.length) {
  console.log("\n✓ toda capa de vídeo é capa de verdade. Nada a fazer.");
} else if (!APLICAR) {
  console.log(
    `\n${fila.length} precisa(m) de capa nova. Para devolvê-las à fila: --aplicar` +
      `\n  (isso zera só a coluna da miniatura; o vídeo não é tocado)` +
      `\n  Depois, o fotógrafo abre a aba Vídeo da galeria e o navegador dele gera as capas.`,
  );
} else {
  const ids = fila.filter((f) => f.situacao !== "sem-capa" || true).map((f) => f.id);
  const r = await db.query("update medias set chave_thumb = null where id = any($1)", [ids]);
  console.log(`\n✓ ${r.rowCount} capa(s) devolvida(s) à fila.`);
  console.log("  O fotógrafo abre a aba Vídeo da galeria para gerá-las.");
}

await db.end();
