#!/usr/bin/env node
/**
 * A lista do que vai ser salvo no celular — inteira, venha de onde vier. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-lista-de-entrega.mjs
 *
 * ── POR QUE A LISTA SAI DO SERVIDOR (16/09/2026) ──────────────────────────
 *
 * No celular, "salvar as N fotos", "salvar esta pasta" e "salvar as favoritas"
 * montavam a lista com o que estava NA TELA. Numa galeria fatiada a tela é um
 * pedaço: o menu dizia 2108 e entregava 600, a pasta dizia 800 e entregava
 * 600, e as favoritas de outros capítulos exigiam navegar antes. Entrega
 * parcial com cara de completa — o casal fecha a aba achando que levou tudo.
 *
 * O zip do computador já resolvia isso do lado do servidor. Esta rota dá ao
 * celular a mesma lista, sem os bytes: id, nome do arquivo e tamanho. A busca
 * de cada foto continua no celular, lote a lote.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { FOTOS_POR_TELA } from "../src/config/fatia-galeria.ts";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

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

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const pedir = async (gid, consulta = "", cookie = "") => {
  const r = await fetch(`${BASE}/api/g/${gid}/lista${consulta}`, {
    cache: "no-store",
    headers: cookie ? { cookie } : {},
  });
  let corpo = null;
  try {
    corpo = await r.json();
  } catch {
    /* 404 do Next devolve HTML: a rota não existe. */
  }
  return { status: r.status, corpo };
};

const prefixosFalsos = [];
try {
  /* Cinco fotos: três na Cerimônia, uma na Festa, uma solta. Contagens
     diferentes de propósito — com números iguais, trocar um capítulo pelo
     outro passaria despercebido. */
  const g = await galeriaDaRodada(db, { nome: "lista", medias: 5, publicada: true });
  await db.query(
    "update galerias set permite_download = true, senha_hash = null, estado = 'online' where id = $1",
    [g.id],
  );
  const { rows: secoes } = await db.query(
    `insert into secoes (galeria_id, nome, ordem)
          values ($1, 'Cerimônia', 0), ($1, 'Festa', 1) returning id, nome`,
    [g.id],
  );
  const [cerimonia, festa] = secoes;
  for (const m of g.midias.slice(0, 3)) {
    await db.query("update medias set secao_id = $2 where id = $1", [m.id, cerimonia.id]);
  }
  await db.query("update medias set secao_id = $2 where id = $1", [g.midias[3].id, festa.id]);

  console.log("O que a lista traz\n");

  await etapa("a galeria inteira, com id, nome do arquivo e tamanho de cada foto", async () => {
    const { status, corpo } = await pedir(g.id);
    if (status !== 200) throw new Error(`HTTP ${status}`);
    const fotos = corpo?.fotos ?? [];
    if (fotos.length !== 5) throw new Error(`vieram ${fotos.length} de 5`);
    const incompleta = fotos.find(
      (f) => typeof f.id !== "string" || typeof f.nome !== "string" || typeof f.bytes !== "number",
    );
    if (incompleta) throw new Error(`foto sem id/nome/bytes: ${JSON.stringify(incompleta)}`);
    return `${fotos.length} fotos`;
  });

  await etapa("o nome do arquivo leva o capítulo, igual ao do link assinado", async () => {
    /* O arquivo no celular nasce com ESTE nome (`new File([blob], nome)`), e o
       download do computador com o do `Content-Disposition`. Os dois têm de
       concordar — ver `lib/nome-de-arquivo.ts`. */
    const { corpo } = await pedir(g.id);
    const daCerimonia = corpo.fotos.find((f) => f.id === g.midias[0].id);
    const solta = corpo.fotos.find((f) => f.id === g.midias[4].id);
    if (daCerimonia?.nome !== `Cerimônia - ${g.midias[0].nome_original}`) {
      throw new Error(`nome da Cerimônia saiu "${daCerimonia?.nome}"`);
    }
    if (solta?.nome !== `Outras fotos - ${g.midias[4].nome_original}`) {
      throw new Error(`nome da solta saiu "${solta?.nome}"`);
    }
    return daCerimonia.nome;
  });

  await etapa("uma pasta traz só a pasta", async () => {
    const { corpo: c } = await pedir(g.id, `?cap=${cerimonia.id}`);
    const { corpo: f } = await pedir(g.id, `?cap=${festa.id}`);
    const { corpo: s } = await pedir(g.id, "?cap=sem-capitulo");
    const n = [c?.fotos?.length, f?.fotos?.length, s?.fotos?.length];
    if (n.join() !== "3,1,1") throw new Error(`Cerimônia/Festa/soltas = ${n.join("/")}`);
    return "3 · 1 · 1";
  });

  await etapa("capítulo de OUTRA galeria não traz foto nenhuma", async () => {
    const outra = await galeriaDaRodada(db, { nome: "lista-vizinha", medias: 1, publicada: true });
    const { rows: [sv] } = await db.query(
      "insert into secoes (galeria_id, nome, ordem) values ($1, 'Vizinha', 0) returning id",
      [outra.id],
    );
    await db.query("update medias set secao_id = $1 where galeria_id = $2", [sv.id, outra.id]);
    const { status, corpo } = await pedir(g.id, `?cap=${sv.id}`);
    if (corpo?.fotos?.length) throw new Error(`vieram ${corpo.fotos.length} fotos da vizinha`);
    return `HTTP ${status}`;
  });

  console.log("\nA lista não para no tamanho da tela\n");

  await etapa(`uma pasta com mais de ${FOTOS_POR_TELA} fotos vem inteira`, async () => {
    const grande = await galeriaDaRodada(db, { nome: "lista-grande", medias: 0, publicada: true });
    await db.query(
      "update galerias set permite_download = true, senha_hash = null where id = $1",
      [grande.id],
    );
    const { rows: [sg] } = await db.query(
      "insert into secoes (galeria_id, nome, ordem) values ($1, 'Festa', 0) returning id",
      [grande.id],
    );
    const quantas = FOTOS_POR_TELA + 5;
    prefixosFalsos.push(`${grande.tenant_id}/${grande.id}/lista-grande-`);
    /* Em massa, numa consulta só: 605 inserts um a um levam minutos. */
    await db.query(
      `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime,
                           bytes, largura, altura, ordem, pronto, secao_id)
       select $1, $2, $5 || i || '.jpg',
              'festa-' || i || '.jpg', 'foto', 'image/jpeg', 1000 + i, 1600, 1067, i, true, $3
         from generate_series(0, $4::int - 1) i`,
      [grande.id, grande.tenant_id, sg.id, quantas, prefixosFalsos.at(-1)],
    );
    const { status, corpo } = await pedir(grande.id, `?cap=${sg.id}`);
    if (status !== 200) throw new Error(`HTTP ${status}`);
    if (corpo.fotos.length !== quantas) {
      throw new Error(`vieram ${corpo.fotos.length} de ${quantas} — a lista parou na fatia`);
    }
    const tudo = await pedir(grande.id);
    if (tudo.corpo.fotos.length !== quantas) {
      throw new Error(`a galeria inteira trouxe ${tudo.corpo.fotos.length} de ${quantas}`);
    }
    return `${quantas} de ${quantas}`;
  });

  console.log("\nAs favoritas são de quem pediu\n");

  await etapa("sem dizer quem é, as favoritas pedem o e-mail (428)", async () => {
    const { status } = await pedir(g.id, "?favoritas=1");
    if (status !== 428) throw new Error(`HTTP ${status}`);
  });

  await etapa("identificada, vêm as favoritas DELA — inclusive de outros capítulos", async () => {
    const identificar = async (email) => {
      const r = await fetch(`${BASE}/api/g/${g.id}/eu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      return (r.headers.get("set-cookie") ?? "").split(";")[0];
    };
    const marcar = (cookie, mediaId) =>
      fetch(`${BASE}/api/g/${g.id}/favoritas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ mediaId }),
      });
    const noiva = await identificar(`noiva-lista-${Date.now()}@exemplo.com`);
    const noivo = await identificar(`noivo-lista-${Date.now()}@exemplo.com`);
    await marcar(noiva, g.midias[0].id);
    await marcar(noiva, g.midias[3].id);
    await marcar(noivo, g.midias[4].id);

    const { status, corpo } = await pedir(g.id, "?favoritas=1", noiva);
    if (status !== 200) throw new Error(`HTTP ${status}`);
    const ids = new Set(corpo.fotos.map((f) => f.id));
    if (ids.size !== 2 || !ids.has(g.midias[0].id) || !ids.has(g.midias[3].id)) {
      throw new Error(`vieram ${[...ids].length} favoritas, e não as duas da noiva`);
    }
    return "as 2 dela, nenhuma do noivo";
  });

  console.log("\nAs travas de qualquer download\n");

  await etapa("com download desligado, recusa (403)", async () => {
    await db.query("update galerias set permite_download = false where id = $1", [g.id]);
    try {
      const { status } = await pedir(g.id);
      if (status !== 403) throw new Error(`HTTP ${status}`);
    } finally {
      await db.query("update galerias set permite_download = true where id = $1", [g.id]);
    }
  });

  await etapa("galeria com senha recusa quem não passou por ela (401)", async () => {
    await db.query("update galerias set senha_hash = '$2b$10$naoimporta' where id = $1", [g.id]);
    try {
      const { status } = await pedir(g.id);
      if (status !== 401) throw new Error(`HTTP ${status}`);
    } finally {
      await db.query("update galerias set senha_hash = null where id = $1", [g.id]);
    }
  });

  /*
   * As duas travas que a PÁGINA aplica e a rota do zip não aplicava (revisão
   * de 16/09/2026): prazo vencido e trial abandonado. A página diz "fora do
   * ar"; quem guardou o id da galeria baixava tudo mesmo assim.
   */
  await etapa("galeria com prazo vencido não entrega lista nem zip", async () => {
    await db.query("update galerias set expira_em = now() - interval '1 day' where id = $1", [g.id]);
    try {
      const { status } = await pedir(g.id);
      const zip = await fetch(`${BASE}/api/g/${g.id}/zip`, { cache: "no-store" });
      await zip.body?.cancel();
      if (status === 200 || zip.status === 200) throw new Error(`lista ${status}, zip ${zip.status}`);
      return `lista ${status} · zip ${zip.status}`;
    } finally {
      await db.query("update galerias set expira_em = null where id = $1", [g.id]);
    }
  });

  await etapa("estúdio com trial abandonado não entrega lista nem zip", async () => {
    const { rows: [antes] } = await db.query("select status, trial_ate from tenants where id = $1", [g.tenant_id]);
    await db.query(
      "update tenants set status = 'trial', trial_ate = now() - interval '400 days' where id = $1",
      [g.tenant_id],
    );
    try {
      const { status } = await pedir(g.id);
      const zip = await fetch(`${BASE}/api/g/${g.id}/zip`, { cache: "no-store" });
      await zip.body?.cancel();
      if (status === 200 || zip.status === 200) throw new Error(`lista ${status}, zip ${zip.status}`);
      return `lista ${status} · zip ${zip.status}`;
    } finally {
      await db.query("update tenants set status = $2, trial_ate = $3 where id = $1", [
        g.tenant_id,
        antes.status,
        antes.trial_ate,
      ]);
    }
  });

  console.log("\nAs fotos que a busca por rosto achou\n");

  /*
   * Numa galeria fatiada a selfie leva a `?fotos=<ids>`. Antes da lista vir do
   * servidor, "salvar tudo" naquela tela salvava as encontradas; depois, a
   * galeria inteira — o convidado ficava sem jeito de levar só as dele.
   */
  await etapa("?fotos= traz só aquelas, na ordem da galeria", async () => {
    const ids = [g.midias[3].id, g.midias[0].id];
    const { status, corpo } = await pedir(g.id, `?fotos=${ids.join(",")}`);
    if (status !== 200) throw new Error(`HTTP ${status}`);
    const vieram = corpo.fotos.map((f) => f.id);
    if (vieram.length !== 2 || !vieram.includes(ids[0]) || !vieram.includes(ids[1])) {
      throw new Error(`vieram ${vieram.length}`);
    }
    return "2 de 2";
  });

  await etapa("?fotos= com id de outra galeria ou lixo não traz nada a mais", async () => {
    const outra = await galeriaDaRodada(db, { nome: "lista-vizinha", medias: 1, publicada: true });
    const { corpo } = await pedir(g.id, `?fotos=${outra.midias[0].id},nao-e-id,${g.midias[1].id}`);
    const vieram = (corpo?.fotos ?? []).map((f) => f.id);
    if (vieram.length !== 1 || vieram[0] !== g.midias[1].id) {
      throw new Error(`vieram ${JSON.stringify(vieram)}`);
    }
  });

  await etapa("galeria no cofre não entrega lista", async () => {
    await db.query("update galerias set estado = 'arquivada' where id = $1", [g.id]);
    try {
      const { status } = await pedir(g.id);
      if (status === 200) throw new Error("a galeria arquivada entregou a lista");
      return `HTTP ${status}`;
    } finally {
      await db.query("update galerias set estado = 'online' where id = $1", [g.id]);
    }
  });
} finally {
  /* Chaves de mentira, nada no balde: tirá-las poupa a limpeza de 605 exclusões. */
  for (const p of prefixosFalsos) {
    await db.query("delete from medias where chave like $1", [`${p}%`]).catch(() => {});
  }
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ a lista de entrega tem problema");
  process.exit(1);
}
console.log("\n✓ a lista de entrega vem inteira e respeita as travas");
