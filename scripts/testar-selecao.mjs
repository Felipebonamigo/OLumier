#!/usr/bin/env node
/**
 * Testa a seleção do álbum — o que vem DEPOIS de marcar a foto. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-selecao.mjs
 *
 * A marcação em si já era testada em `testar-favoritas.mjs`. Aqui ficam as três
 * regras que transformam "marcar coração" em "escolher o álbum", e cada uma
 * existe por uma falha concreta do jeito antigo:
 *
 *   LIMITE  — "o álbum tem 40 fotos" é combinado no contrato. Sem o limite no
 *             SERVIDOR, o casal escolhe 90 e a conversa desagradável sobra para
 *             o fotógrafo. Limite só no botão não é limite: é sugestão.
 *
 *   FECHAR  — sem um "terminei", a lista nunca acaba e o fotógrafo não sabe
 *             quando pode editar. Ele volta ao WhatsApp perguntar, que é o vai e
 *             volta que a seleção veio matar.
 *
 *   PRAZO   — entrega tem data. Passado o prazo, a seleção tranca sozinha em vez
 *             de o fotógrafo ter de lembrar de trancar.
 *
 * O limite é conferido onde a marcação acontece, não onde ela é desenhada:
 * qualquer pessoa com o link consegue chamar a rota direto.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

exigirBancoDeTeste();

const {
  estadoSelecao,
  alternar,
  fecharSelecao,
  reabrirSelecao,
  definirRegrasSelecao,
  listaDaSelecao,
} = await import("../src/lib/favoritas.ts");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { rows } = await db.query(
  `select g.id, g.tenant_id
     from galerias g
     join medias m on m.galeria_id = g.id and m.pronto
    group by g.id
   having count(m.id) >= 3
    order by g.criado_em limit 1`,
);
if (rows.length === 0) {
  console.error("✗ preciso de uma galeria com ao menos 3 fotos prontas");
  process.exit(1);
}
const { id: galeriaId, tenant_id: tenantId } = rows[0];

const { rows: fotos } = await db.query(
  "select id from medias where galeria_id = $1 and pronto order by ordem, criado_em limit 3",
  [galeriaId],
);

/** Estado limpo antes de cada bloco — o teste não pode depender do anterior. */
const zerar = async () => {
  await db.query("delete from favoritas where galeria_id = $1", [galeriaId]);
  await db.query(
    `update galerias set selecao_limite = null, selecao_prazo = null,
            selecao_fechada_em = null where id = $1`,
    [galeriaId],
  );
};

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    await zerar();
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

const NOIVA = "visitante-noiva";
const NOIVO = "visitante-noivo";

console.log("Seleção:\n");

/* ── a seleção é UMA, da galeria ─────────────────────────────────────────── */

await etapa("noiva e noivo somam na MESMA lista", async () => {
  await alternar(galeriaId, fotos[0].id, NOIVA);
  await alternar(galeriaId, fotos[1].id, NOIVO);
  const e = await estadoSelecao(galeriaId);
  if (e.total !== 2) throw new Error(`esperava 2 na lista da galeria, veio ${e.total}`);
  return "2 fotos, uma lista só";
});

await etapa("a mesma foto marcada pelos dois conta uma vez", async () => {
  await alternar(galeriaId, fotos[0].id, NOIVA);
  const r = await alternar(galeriaId, fotos[0].id, NOIVO);
  const e = await estadoSelecao(galeriaId);
  /* Marcar o que já está marcado é DESmarcar — a lista é compartilhada, então o
   * segundo clique tira a foto que o primeiro pôs. É o mesmo botão de sempre. */
  if (e.total !== 0) throw new Error(`esperava 0 depois do segundo clique, veio ${e.total}`);
  if (r.favorita !== false) throw new Error("não devolveu que desmarcou");
  return "clique do segundo desmarca";
});

/* ── limite ──────────────────────────────────────────────────────────────── */

await etapa("sem limite definido, marca à vontade", async () => {
  for (const f of fotos) await alternar(galeriaId, f.id, NOIVA);
  const e = await estadoSelecao(galeriaId);
  if (e.total !== 3) throw new Error(`esperava 3, veio ${e.total}`);
  if (e.cheia) throw new Error("disse que encheu sem limite nenhum");
});

await etapa("no limite, a próxima é RECUSADA pelo servidor", async () => {
  await definirRegrasSelecao(galeriaId, tenantId, { limite: 2, prazo: null });
  await alternar(galeriaId, fotos[0].id, NOIVA);
  await alternar(galeriaId, fotos[1].id, NOIVA);

  const r = await alternar(galeriaId, fotos[2].id, NOIVA);
  if (r?.erro !== "cheia") throw new Error(`esperava recusa "cheia", veio ${JSON.stringify(r)}`);

  const e = await estadoSelecao(galeriaId);
  if (e.total !== 2) throw new Error(`entrou mesmo assim: ${e.total} na lista`);
  if (!e.cheia) throw new Error("não avisou que está cheia");
  return "3a foto barrada com limite 2";
});

await etapa("DESmarcar continua valendo com a lista cheia", async () => {
  await definirRegrasSelecao(galeriaId, tenantId, { limite: 2, prazo: null });
  await alternar(galeriaId, fotos[0].id, NOIVA);
  await alternar(galeriaId, fotos[1].id, NOIVA);

  /* Se o limite bloqueasse o toggle inteiro, o casal ficaria preso: cheio, sem
   * poder trocar uma foto por outra, e sem entender por quê. */
  const r = await alternar(galeriaId, fotos[0].id, NOIVA);
  if (r?.favorita !== false) throw new Error("não deixou desmarcar com a lista cheia");

  const depois = await alternar(galeriaId, fotos[2].id, NOIVA);
  if (depois?.favorita !== true) throw new Error("não deixou trocar de foto");
  return "dá para trocar uma pela outra";
});

await etapa("limite menor que o já marcado não apaga escolha de ninguém", async () => {
  for (const f of fotos) await alternar(galeriaId, f.id, NOIVA);
  await definirRegrasSelecao(galeriaId, tenantId, { limite: 1, prazo: null });
  const e = await estadoSelecao(galeriaId);
  if (e.total !== 3) throw new Error(`apagou marcação ao baixar o limite: ${e.total}`);
  if (!e.cheia) throw new Error("deveria estar cheia (3 de 1)");
  return "3 marcadas seguem lá, e a lista está cheia";
});

/* ── fechar ──────────────────────────────────────────────────────────────── */

await etapa("fechada, não aceita mais marcar nem desmarcar", async () => {
  await alternar(galeriaId, fotos[0].id, NOIVA);
  await fecharSelecao(galeriaId);

  const marcar = await alternar(galeriaId, fotos[1].id, NOIVA);
  if (marcar?.erro !== "fechada") throw new Error(`marcou depois de fechada: ${JSON.stringify(marcar)}`);

  const desmarcar = await alternar(galeriaId, fotos[0].id, NOIVA);
  if (desmarcar?.erro !== "fechada") throw new Error("desmarcou depois de fechada");

  const e = await estadoSelecao(galeriaId);
  if (e.aberta) throw new Error("continua dizendo que está aberta");
  if (e.motivo !== "fechada") throw new Error(`motivo errado: ${e.motivo}`);
  return "trancada dos dois lados";
});

await etapa("o fotógrafo consegue reabrir — cliente que muda de ideia é comum", async () => {
  await alternar(galeriaId, fotos[0].id, NOIVA);
  await fecharSelecao(galeriaId);
  await reabrirSelecao(galeriaId, tenantId);

  const e = await estadoSelecao(galeriaId);
  if (!e.aberta) throw new Error("não reabriu");
  const r = await alternar(galeriaId, fotos[1].id, NOIVA);
  if (r?.favorita !== true) throw new Error("reabriu mas não deixa marcar");
  return "reaberta e marcando de novo";
});

await etapa("reabrir é do dono da galeria, não de quem tem o link", async () => {
  await fecharSelecao(galeriaId);
  const alheio = await reabrirSelecao(galeriaId, "00000000-0000-0000-0000-000000000000");
  if (alheio) throw new Error("estúdio errado conseguiu reabrir");
  const e = await estadoSelecao(galeriaId);
  if (e.aberta) throw new Error("reabriu mesmo assim");
});

/* ── prazo ───────────────────────────────────────────────────────────────── */

await etapa("passado o prazo, tranca sozinha", async () => {
  await definirRegrasSelecao(galeriaId, tenantId, {
    limite: null,
    prazo: new Date(Date.now() - 60_000),
  });
  const e = await estadoSelecao(galeriaId);
  if (e.aberta) throw new Error("segue aberta com o prazo vencido");
  if (e.motivo !== "prazo") throw new Error(`motivo errado: ${e.motivo}`);

  const r = await alternar(galeriaId, fotos[0].id, NOIVA);
  if (r?.erro !== "prazo") throw new Error(`marcou fora do prazo: ${JSON.stringify(r)}`);
  return "recusa com motivo próprio, não 'fechada'";
});

await etapa("dentro do prazo, segue normal", async () => {
  await definirRegrasSelecao(galeriaId, tenantId, {
    limite: null,
    prazo: new Date(Date.now() + 3_600_000),
  });
  const r = await alternar(galeriaId, fotos[0].id, NOIVA);
  if (r?.favorita !== true) throw new Error("barrou dentro do prazo");
});

/* ── a lista que o fotógrafo leva para o Lightroom ───────────────────────── */

await etapa("exportar devolve os nomes ORIGINAIS dos arquivos", async () => {
  await alternar(galeriaId, fotos[0].id, NOIVA);
  await alternar(galeriaId, fotos[1].id, NOIVA);

  const lista = await listaDaSelecao(galeriaId);
  if (lista.length !== 2) throw new Error(`esperava 2 nomes, veio ${lista.length}`);

  /* O nome do arquivo é a ponte com o Lightroom: é por ele que o fotógrafo
   * filtra lá dentro. Id do banco não serve para nada fora daqui. */
  const nomes = await db.query(
    "select nome_original from medias where id = any($1) order by ordem, criado_em",
    [[fotos[0].id, fotos[1].id]],
  );
  const esperados = nomes.rows.map((r) => r.nome_original).sort();
  const veio = lista.map((l) => l.nome).sort();
  if (JSON.stringify(esperados) !== JSON.stringify(veio)) {
    throw new Error(`nomes errados: ${JSON.stringify(veio)}`);
  }
  return veio.join(", ");
});

await etapa("exportar sai na ordem da galeria, não na de marcação", async () => {
  await alternar(galeriaId, fotos[2].id, NOIVA);
  await alternar(galeriaId, fotos[0].id, NOIVA);

  const lista = await listaDaSelecao(galeriaId);
  const ordemNaGaleria = await db.query(
    "select id from medias where id = any($1) order by ordem, criado_em",
    [[fotos[0].id, fotos[2].id]],
  );
  const esperada = ordemNaGaleria.rows.map((r) => r.id);
  if (JSON.stringify(lista.map((l) => l.id)) !== JSON.stringify(esperada)) {
    throw new Error("veio na ordem em que foi marcada");
  }
  return "ordem da galeria preservada";
});

await zerar();
await db.end();

if (falhou) {
  console.error("\n✗ seleção com problema");
  process.exit(1);
}
console.log("\n✓ seleção funcionando");
