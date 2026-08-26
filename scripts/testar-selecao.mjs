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

/*
 * O endereço público desta galeria. As etapas de API não precisam dele, mas a
 * que confere o AVISO precisa: o que se testa ali é o HTML que o casal recebe,
 * e não há como olhar isso pelo banco.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const { rows: enderecos } = await db.query(
  `select t.slug as estudio, g.slug as galeria, g.publicada
     from galerias g join tenants t on t.id = g.tenant_id
    where g.id = $1`,
  [galeriaId],
);
const url = `${BASE}/g/${enderecos[0].estudio}/${enderecos[0].galeria}`;
/* Publicada e sem senha: a etapa do aviso lê a página como um convidado leria, e
 * o portão de senha devolveria o HTML errado. Restaurado no fim do arquivo. */
const publicadaAntes = enderecos[0].publicada;
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [galeriaId]);

/*
 * Texto da página com as tags fora.
 *
 * Sem isto o `<strong>` que destaca o número parte a frase no meio: o HTML traz
 * `até <strong …>4 fotos</strong>`, e uma busca por "até 4" não casa. O teste
 * ficaria vermelho com a correção já no lugar — pior que teste nenhum, porque
 * mandaria procurar defeito onde não há.
 */
const textoDaPagina = async () => {
  const r = await fetch(url, { headers: { connection: "close" }, cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} na galeria pública`);
  const html = await r.text();
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
};

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

/* ── o limite dito ANTES ─────────────────────────────────────────────────── */

/*
 * O servidor recusa a foto que passa do combinado, e isso já está preso acima.
 * Mas recusar é a última linha de defesa, não a primeira: até 26/08/2026 o casal
 * abria a galeria, marcava à vontade e só descobria a regra ao esbarrar nela —
 * a barra com o contador só nascia depois da PRIMEIRA foto marcada.
 *
 * O comentário no componente justificava esconder o BOTÃO de filtrar favoritas,
 * e a justificativa é boa: botão que não faz nada ocupando o lugar mais nobre da
 * tela. Só que o contador viajava junto, e o contador não é botão — é a regra.
 * Regra que só aparece quando você a quebra não é aviso, é pegadinha.
 */
await etapa("o limite é dito antes de o casal marcar a primeira", async () => {
  await db.query("update galerias set selecao_limite = 4 where id = $1", [galeriaId]);

  const texto = await textoDaPagina();

  /* Sem nenhuma favorita marcada: é exatamente o estado em que o casal chega. */
  if (!/escolha até 4 fotos/i.test(texto)) {
    throw new Error(
      "a galeria não diz quantas fotos podem ser escolhidas antes da primeira marcação — " +
        "o casal só descobriria a regra ao ser recusado",
    );
  }
  return "diz o combinado antes";
});

await etapa("sem limite, não inventa aviso", async () => {
  /* O `zerar` já deixou `selecao_limite` nulo. Anunciar "escolha até null" ou um
   * número tirado do nada seria pior que o silêncio de antes. */
  const texto = await textoDaPagina();
  if (/escolha até \d+ fotos/i.test(texto)) {
    throw new Error("anunciou um limite que não existe");
  }
  return "silêncio, como deve ser";
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
/* Devolve a galeria ao estado em que estava: o teste do aviso precisou publicá-la
 * para ler o HTML de convidado, e teste que deixa lixo atrás muda o resultado do
 * próximo. */
await db.query("update galerias set publicada = $1 where id = $2", [publicadaAntes, galeriaId]);
await db.end();

if (falhou) {
  console.error("\n✗ seleção com problema");
  process.exit(1);
}
console.log("\n✓ seleção funcionando");
