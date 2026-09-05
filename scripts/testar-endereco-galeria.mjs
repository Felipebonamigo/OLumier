#!/usr/bin/env node
/**
 * O endereço (slug) da GALERIA, e quando ele pode mudar. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-endereco-galeria.mjs
 *
 * ── O PEDIDO, E A REGRA QUE ELE ESBARRA (05/09/2026) ──────────────────────
 *
 * Juan: "to tentando trocar o url e não consigo, clico e a área não é
 * clicável" e, olhando o link que saiu, "o link não gostei porque não consegui
 * arrumar o 2" — a galeria dele nasceu `paula-bruno-2` porque ele já tinha
 * criado uma `paula-bruno` por engano.
 *
 * O campo era travado de propósito, e a razão é boa: o endereço vai para o
 * WhatsApp do casal e é repassado para a família inteira. Renomear a galeria
 * não pode transformar um link em circulação numa página de erro. Para o
 * ESTÚDIO isso foi resolvido com apelido (migração 025); para a galeria não há
 * tabela de apelido, então a saída é outra.
 *
 * ── A REGRA QUE ESTE ARQUIVO PRENDE ───────────────────────────────────────
 *
 * O endereço muda enquanto a galeria NÃO ESTÁ PUBLICADA e NUNCA FOI ABERTA por
 * ninguém. As duas condições juntas, e é a segunda que faz a promessa valer:
 * "não publicada" sozinha permitiria trocar o endereço de uma galeria que foi
 * ao ar, foi entregue, e depois saiu do ar temporariamente — e aí o link do
 * casal quebra.
 *
 * Sem acesso registrado e fora do ar, ninguém pode ter aquele endereço: ele
 * nunca respondeu a ninguém.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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

const g = await galeriaDaRodada(db, { nome: "endereco", medias: 1, publicada: false });
const cookie = cookieDeSessao(g.tenant_id);

const { podeTrocarEnderecoDaGaleria, trocarEnderecoDaGaleria } = await import(
  "../src/lib/endereco-galeria.ts"
);

const semAcessos = () => db.query("delete from acessos where galeria_id = $1", [g.id]);
const foraDoAr = () => db.query("update galerias set publicada = false where id = $1", [g.id]);

console.log("O endereço da galeria:\n");

await etapa("rascunho nunca aberto pode trocar de endereço", async () => {
  await foraDoAr();
  await semAcessos();
  if (!(await podeTrocarEnderecoDaGaleria(g.id, g.tenant_id))) {
    throw new Error("recusou justamente o caso que o recurso existe para atender");
  }
  return "liberado";
});

await etapa("galeria no ar NÃO pode trocar de endereço", async () => {
  await db.query("update galerias set publicada = true where id = $1", [g.id]);
  await semAcessos();
  const pode = await podeTrocarEnderecoDaGaleria(g.id, g.tenant_id);
  await foraDoAr();
  if (pode) throw new Error("deixou trocar o endereço de uma galeria publicada");
  return "travado";
});

await etapa("galeria já aberta por alguém NÃO pode trocar, mesmo fora do ar", async () => {
  await foraDoAr();
  await semAcessos();
  await db.query(
    "insert into acessos (galeria_id, acao, ip_hash, user_agent) values ($1, 'abriu', 'hash-de-teste', 'teste')",
    [g.id],
  );
  const pode = await podeTrocarEnderecoDaGaleria(g.id, g.tenant_id);
  await semAcessos();
  if (pode) {
    throw new Error("o link já respondeu a alguém e ainda assim liberou a troca");
  }
  return "travado — o link já circulou";
});

await etapa("a troca grava o endereço novo, em formato de endereço", async () => {
  await foraDoAr();
  await semAcessos();
  const r = await trocarEnderecoDaGaleria(g.id, g.tenant_id, "  Paula e Bruno!!  ");
  if (!r.ok) throw new Error(`recusou: ${r.erro}`);
  const { rows } = await db.query("select slug from galerias where id = $1", [g.id]);
  if (rows[0].slug !== "paula-e-bruno") throw new Error(`gravou "${rows[0].slug}"`);
  return rows[0].slug;
});

await etapa("endereço já usado por outra galeria do mesmo estúdio é recusado", async () => {
  const outra = await galeriaDaRodada(db, { nome: "endereco-2", medias: 0, publicada: false });
  const r = await trocarEnderecoDaGaleria(g.id, g.tenant_id, outra.slug);
  if (r.ok) throw new Error("duas galerias do mesmo estúdio ficaram com o mesmo endereço");
  return r.erro;
});

await etapa("galeria de outro estúdio não é alcançada pelo id", async () => {
  const { rows: t } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status)
          values ($1, 'Vizinho', $2, 'x', $3, 'ativo') returning id`,
    [`viz-end-${g.id.slice(0, 8)}`, `viz-end-${g.id.slice(0, 8)}@teste.local`, String(1024 ** 4)],
  );
  const { rows: gv } = await db.query(
    `insert into galerias (tenant_id, slug, titulo, publicada, estado)
          values ($1, $2, 'Do vizinho', false, 'online') returning id, slug`,
    [t[0].id, `viz-end-${g.id.slice(0, 8)}`],
  );
  try {
    const r = await trocarEnderecoDaGaleria(gv[0].id, g.tenant_id, "roubado");
    const { rows } = await db.query("select slug from galerias where id = $1", [gv[0].id]);
    if (r.ok || rows[0].slug !== gv[0].slug) {
      throw new Error("trocou o endereço da galeria de outro estúdio");
    }
    return "não encontrada";
  } finally {
    await db.query("delete from galerias where id = $1", [gv[0].id]);
    await db.query("delete from tenants where id = $1", [t[0].id]);
  }
});

console.log("\nNa tela de entrega:\n");

await etapa("a aba Entrega oferece a troca enquanto a galeria é rascunho", async () => {
  await foraDoAr();
  await semAcessos();
  const html = await (
    await fetch(`${BASE}/painel/galerias/${g.id}/entrega`, { headers: { cookie } })
  ).text();
  if (!/Endereço da galeria/.test(html)) {
    throw new Error("a aba não mostra o endereço da galeria para editar");
  }
  return "campo presente";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o endereço da galeria tem problema" : "\n✓ endereço da galeria ok");
process.exit(falhou ? 1 : 0);
