#!/usr/bin/env node
/**
 * URLs do lightbox e do download assinadas SOB DEMANDA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-urls-sob-demanda.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── POR QUE ISTO MUDOU (03/09/2026) ────────────────────────────────────────
 *
 * A galeria pública assinava TRÊS URLs por foto no servidor — miniatura,
 * preview e original — e mandava as três no HTML. Medido na galeria real de
 * 111 fotos em produção: 454 KB de página, 62 % disso eram URLs assinadas, e
 * preview + original (que a primeira pintura não usa) eram 147 KB. Num
 * casamento de 600 fotos seriam 800 KB a mais no 4G do salão de festa, para
 * fotos que o convidado talvez nunca amplie.
 *
 * Agora só a miniatura vai no HTML. O preview é pedido quando o lightbox
 * abre, e o original quando alguém clica em baixar — a esta rota, que aplica
 * a MESMA régua da página: publicada, no ar, senha quando houver, e download
 * só quando o fotógrafo permitiu. É essa última regra que faz este teste
 * existir: a URL do original não pode aparecer NUNCA no HTML, e a rota não
 * pode entregá-la quando o interruptor está desligado.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { gerarHashSenhaGaleria } from "../src/lib/galerias-publicas.ts";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
async function etapa(nome, fn) {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const g = await galeriaDaRodada(db, { nome: "urls", medias: 4 });
const outra = await galeriaDaRodada(db, { nome: "urls-outra", medias: 1 });
const [m0, m1, m2] = g.midias;
const pedir = (ids, tipo, extra = {}) =>
  fetch(`${BASE}/api/g/${g.id}/urls`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(extra.headers ?? {}) },
    body: JSON.stringify({ ids, tipo }),
  });

console.log("\nURLs sob demanda\n");

await etapa("o HTML traz as miniaturas e o preview DA CAPA — e nenhum outro preview, nenhum original", async () => {
  await db.query("update galerias set permite_download = true where id = $1", [g.id]);
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`)).text();
  const limpo = html.replaceAll("\\u0026", "&").replaceAll("&amp;", "&");
  if (!limpo.includes("_thumb.webp")) throw new Error("miniatura sumiu do HTML");

  /*
   * A capa é a exceção legítima: o hero da página É o preview da foto de capa
   * (sem capa escolhida, a primeira foto). Qualquer OUTRO preview no HTML é o
   * defeito que este teste existe para pegar.
   */
  const { rows: [capa] } = await db.query(
    `select coalesce(
              (select chave_preview from medias where id = g.capa_media_id),
              (select chave_preview from medias m where m.galeria_id = g.id and m.pronto and m.tipo = 'foto'
                 order by m.ordem, m.criado_em limit 1)
            ) as chave
       from galerias g where g.id = $1`,
    [g.id],
  );
  const previews = [...new Set(limpo.match(/[\w-]+_prev\.webp/g) ?? [])];
  const estranhos = previews.filter((p) => !capa.chave.endsWith(p));
  if (estranhos.length > 0) throw new Error(`preview no HTML além da capa: ${estranhos.join(", ")}`);

  /* As chaves da bancada terminam em `-N.jpg`; assinada, a URL carrega a
   * chave inteira. Se aparecer, o original está no HTML — mesmo com download
   * liberado, isso não pode: ele sai só pela rota, quando alguém pede. */
  if (/[\w-]+-\d+\.jpg\?X-Amz/.test(limpo)) throw new Error("original vai no HTML");
  return `${(limpo.match(/_thumb\.webp/g) ?? []).length} miniaturas · 1 preview (a capa) · zero originais`;
});

await etapa("o preview vem pela rota, só das fotos pedidas", async () => {
  const r = await pedir([m0.id, m1.id], "preview");
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  igual(Object.keys(corpo.urls).length, 2, "quantas");
  if (!corpo.urls[m0.id]?.includes("_prev.webp")) throw new Error("não é o preview");
  return "2 de 2, ambas _prev.webp";
});

await etapa("com download LIBERADO, a rota entrega o original com nome de arquivo", async () => {
  const r = await pedir([m2.id], "download");
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  const url = corpo.urls[m2.id];
  if (!url || !url.includes(`-2.jpg`)) throw new Error(`não é o original: ${url}`);
  if (!/response-content-disposition=/.test(url)) throw new Error("sem nome de arquivo para salvar");
  return "original, com Content-Disposition";
});

await etapa("com download BLOQUEADO, a rota RECUSA o original — o interruptor apaga o link", async () => {
  await db.query("update galerias set permite_download = false where id = $1", [g.id]);
  const r = await pedir([m2.id], "download");
  igual(r.status, 403, "status");
  /* E o preview continua saindo: bloquear download não é esconder a foto. */
  const p = await pedir([m2.id], "preview");
  igual(p.status, 200, "preview segue liberado");
  await db.query("update galerias set permite_download = true where id = $1", [g.id]);
});

/*
 * ── BAIXAR SEM ABRIR A FOTO (04/09/2026) ──────────────────────────────────
 *
 * Pedido do sócio: "adicionar botão de baixar a foto ao lado do coração, sem
 * precisar abrir individualmente". Quem escolhe foto de álbum passa por
 * centenas em sequência; obrigar dois cliques a mais por foto (abrir, baixar,
 * fechar) é o tipo de atrito que faz a pessoa desistir e pedir tudo por
 * WhatsApp.
 *
 * O botão nasce no HTML do servidor, junto do coração — por isso dá para
 * conferir daqui. E ele obedece ao MESMO interruptor da rota: com download
 * bloqueado, some. Um botão que aparece e depois falha seria pior que não ter.
 */
await etapa("o card da grade tem botão de baixar, sem precisar abrir a foto", async () => {
  await db.query("update galerias set permite_download = true where id = $1", [g.id]);
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`)).text();
  const botoes = (html.match(/Baixar [^"<]*\.jpg/g) ?? []).length;
  if (botoes === 0) throw new Error("nenhum botão de baixar no card");
  return `${botoes} cards com botão`;
});

await etapa("com download bloqueado, o botão de baixar some do card", async () => {
  await db.query("update galerias set permite_download = false where id = $1", [g.id]);
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`)).text();
  const botoes = (html.match(/Baixar [^"<]*\.jpg/g) ?? []).length;
  if (botoes > 0) throw new Error(`${botoes} botões de baixar numa galeria bloqueada`);
  /* O coração continua: bloquear download não é bloquear a escolha do álbum. */
  if (!/Marcar .*como favorita/.test(html)) throw new Error("o coração sumiu junto");
  await db.query("update galerias set permite_download = true where id = $1", [g.id]);
});

await etapa("foto de OUTRA galeria não sai por esta rota", async () => {
  const r = await pedir([outra.midias[0].id, m0.id], "preview");
  const corpo = await r.json();
  igual(r.status, 200, "status");
  igual(corpo.urls[outra.midias[0].id], undefined, "a estranha");
  if (!corpo.urls[m0.id]) throw new Error("a própria sumiu junto");
});

await etapa("galeria com senha exige a senha também aqui", async () => {
  await db.query("update galerias set senha_hash = $1 where id = $2", [
    gerarHashSenhaGaleria("segredo", g.id),
    g.id,
  ]);
  const r = await pedir([m0.id], "preview");
  igual(r.status, 401, "status");
  await db.query("update galerias set senha_hash = null where id = $1", [g.id]);
});

await etapa("galeria despublicada não assina nada", async () => {
  await db.query("update galerias set publicada = false where id = $1", [g.id]);
  igual((await pedir([m0.id], "preview")).status, 404, "status");
  await db.query("update galerias set publicada = true where id = $1", [g.id]);
});

await etapa("pedido torto é recusado: sem ids, tipo inventado, id que não é uuid, lista enorme", async () => {
  igual((await pedir([], "preview")).status, 400, "vazio");
  igual((await pedir([m0.id], "original")).status, 400, "tipo inventado");
  igual((await pedir(["nao-e-uuid"], "preview")).status, 400, "id torto");
  igual((await pedir(Array(2001).fill(m0.id), "download")).status, 400, "lista enorme");
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ URLs sob demanda com falha\n" : "\n✓ URLs sob demanda ok\n");
process.exit(falhou ? 1 : 0);
