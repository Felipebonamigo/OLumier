#!/usr/bin/env node
/**
 * Testa as favoritas do cliente. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-favoritas.mjs
 *
 * O que precisa ficar preso aqui:
 *   - marcar duas vezes não duplica (o contador do painel vira mentira);
 *   - foto de OUTRA galeria é recusada (id chutado sujaria a lista do álbum);
 *   - galeria com senha não aceita marcação de quem não passou pela senha;
 *   - o cookie do visitante é assinado — sem isso, trocar o valor à mão leria e
 *     apagaria a lista de outra pessoa.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada, marcaDaRodada } from "./fixture-de-teste.mjs";
import { alternar, resumoDaGaleria } from "../src/lib/favoritas.ts";

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

/* Bancada própria desta execução. Antes daqui vinha a galeria mais antiga do
 * banco, e o `delete from favoritas where galeria_id` do final apagava as
 * favoritas de quem estivesse rodando junto — ver fixture-de-teste.mjs. */
const bancada = await galeriaDaRodada(db, { nome: "favoritas", medias: 2 });
const galeriaId = bancada.id;
const tenantId = bancada.estudio.id;

const foto = bancada.midias[0].id;
const outraFoto = bancada.midias[1]?.id ?? bancada.midias[0].id;

/* O visitante carrega a marca da execução. Com nome fixo, o `delete ... where
 * visitante in (...)` do `limpar()` varria a lista de QUALQUER execução rodando
 * junto — a galeria já estava isolada e este identificador ainda não. Foi o
 * segundo fundo falso do mesmo defeito. */
const VISITANTE_A = `visitante-a-${marcaDaRodada()}`;
const VISITANTE_B = `visitante-b-${marcaDaRodada()}`;

// Galeria descartável, para provar o isolamento entre galerias.
const galeriaVizinha = (await galeriaDaRodada(db, { nome: "vizinha", medias: 1 })).id;

async function limpar() {
  await db.query("delete from favoritas where visitante in ($1, $2)", [VISITANTE_A, VISITANTE_B]);
}

try {
  await limpar();
  console.log("marcar e desmarcar");

  await etapa("marca a foto", async () => {
    const r = await alternar(galeriaId, foto, VISITANTE_A);
    igual(r?.favorita, true, "resultado");
    const { rows } = await db.query(
      "select count(*)::int n from favoritas where media_id = $1 and visitante = $2",
      [foto, VISITANTE_A],
    );
    igual(rows[0].n, 1, "linhas no banco");
  });

  await etapa("marcar de novo DESMARCA", async () => {
    const r = await alternar(galeriaId, foto, VISITANTE_A);
    igual(r?.favorita, false, "resultado");
    const { rows } = await db.query(
      "select count(*)::int n from favoritas where media_id = $1 and visitante = $2",
      [foto, VISITANTE_A],
    );
    igual(rows[0].n, 0, "linhas no banco");
  });

  /*
   * Clique duplo, ou rede que reenvia: as duas chamadas chegam quase juntas.
   * Sem o índice único e o `on conflict`, viravam duas linhas — e o painel
   * diria "2 pessoas marcaram" com uma pessoa só.
   */
  await etapa("duas marcações simultâneas não viram duas linhas", async () => {
    await limpar();
    await Promise.all([
      db.query(
        `insert into favoritas (galeria_id, media_id, visitante) values ($1,$2,$3)
         on conflict (galeria_id, media_id) do nothing`,
        [galeriaId, foto, VISITANTE_A],
      ),
      db.query(
        `insert into favoritas (galeria_id, media_id, visitante) values ($1,$2,$3)
         on conflict (galeria_id, media_id) do nothing`,
        [galeriaId, foto, VISITANTE_A],
      ),
    ]);
    const { rows } = await db.query(
      "select count(*)::int n from favoritas where media_id = $1 and visitante = $2",
      [foto, VISITANTE_A],
    );
    igual(rows[0].n, 1, "linhas depois de duas inserções");
  });

  await etapa("foto de OUTRA galeria é recusada", async () => {
    const r = await alternar(galeriaVizinha, foto, VISITANTE_A);
    igual(r, null, "resultado");
  });

  console.log("\nresumo para o fotógrafo");

  /*
   * ── MUDOU NA MIGRAÇÃO 019 ────────────────────────────────────────────────
   * Até a 018, cada visitante tinha a SUA lista e o painel mostrava quantas
   * pessoas marcaram a mesma foto. A partir da 019 a seleção é UMA, da galeria:
   * "o álbum tem 40 fotos" é uma frase sobre a galeria, não sobre cada aparelho,
   * e "terminei" também é do casal, não de um celular.
   *
   * Estas duas etapas travavam o modelo antigo — foi por elas que a mudança
   * apareceu vermelha em vez de passar despercebida, que é o serviço que se
   * espera delas. Agora travam o novo. As regras da seleção (limite, prazo,
   * fechar) moram em `testar-selecao.mjs`.
   */
  await etapa("a lista é uma só: dois aparelhos somam na mesma", async () => {
    await limpar();
    await alternar(galeriaId, foto, VISITANTE_A);
    await alternar(galeriaId, outraFoto, VISITANTE_B);

    const r = await resumoDaGaleria(galeriaId);
    igual(r.fotos, foto === outraFoto ? 1 : 2, "fotos na lista da galeria");
    igual(r.pessoas, foto === outraFoto ? 1 : 2, "pessoas que contribuíram");
    return `${r.fotos} foto(s), ${r.pessoas} pessoa(s)`;
  });

  await etapa("clique do segundo na MESMA foto desmarca, não empilha", async () => {
    await limpar();
    await alternar(galeriaId, foto, VISITANTE_A);
    igual((await resumoDaGaleria(galeriaId)).fotos, 1, "depois do primeiro");

    await alternar(galeriaId, foto, VISITANTE_B);
    igual((await resumoDaGaleria(galeriaId)).fotos, 0, "depois do segundo");
    return "uma linha por foto, não por pessoa";
  });

  // --- pela rota, com senha ------------------------------------------------

  let servidor = false;
  try {
    servidor = (await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    servidor = false;
  }

  if (!servidor) {
    console.log("\n⚠ servidor fora do ar — a parte da rota foi pulada");
  } else {
    console.log("\npela rota");

    const marcar = (gid, corpo, cookie) =>
      fetch(`${BASE}/api/g/${gid}/favoritas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(corpo),
      });

    // Estado de partida conhecido: publicada, sem senha, no ar.
    const antes = (
      await db.query("select publicada, senha_hash, estado from galerias where id = $1", [galeriaId])
    ).rows[0];
    await db.query(
      "update galerias set publicada = true, senha_hash = null, estado = 'online' where id = $1",
      [galeriaId],
    );

    try {
      await etapa("marca e devolve o estado novo", async () => {
        const r = await marcar(galeriaId, { mediaId: foto });
        igual(r.status, 200, "status");
        const d = await r.json();
        if (typeof d.favorita !== "boolean") throw new Error("resposta sem o estado");
        // Desfaz para não deixar rastro do teste.
        const cookie = r.headers.get("set-cookie")?.split(";")[0];
        if (cookie) await marcar(galeriaId, { mediaId: foto }, cookie);
        return `favorita=${d.favorita}`;
      });

      await etapa("o cookie do visitante é criado no primeiro clique", async () => {
        const r = await marcar(galeriaId, { mediaId: foto });
        const set = r.headers.get("set-cookie") ?? "";
        if (!/fav_[0-9a-f]{8}=/.test(set)) throw new Error(`sem cookie de visitante: ${set}`);
        if (!/HttpOnly/i.test(set)) throw new Error("o cookie não é HttpOnly");
        const cookie = set.split(";")[0];
        await marcar(galeriaId, { mediaId: foto }, cookie);
        return "assinado e HttpOnly";
      });

      await etapa("cookie adulterado não vale como visitante", async () => {
        const r = await marcar(galeriaId, { mediaId: foto });
        const bom = (r.headers.get("set-cookie") ?? "").split(";")[0];
        const [nome, valor] = bom.split("=");
        const ruim = `${nome}=${valor.slice(0, -4)}0000`;

        // Com o cookie estragado, o servidor ignora e cria um visitante NOVO —
        // em vez de aceitar a identidade forjada.
        const r2 = await marcar(galeriaId, { mediaId: foto }, ruim);
        const novo = (r2.headers.get("set-cookie") ?? "").split(";")[0];
        if (!novo) throw new Error("aceitou o cookie adulterado sem criar outro");
        if (novo === ruim) throw new Error("devolveu o mesmo cookie adulterado");

        await marcar(galeriaId, { mediaId: foto }, bom);
        await marcar(galeriaId, { mediaId: foto }, novo);
      });

      await etapa("foto que não é da galeria: 404", async () => {
        const r = await marcar(galeriaId, {
          mediaId: "00000000-0000-0000-0000-000000000000",
        });
        igual(r.status, 404, "status");
      });

      await etapa("sem mediaId: 400", async () => {
        igual((await marcar(galeriaId, {})).status, 400, "status");
      });

      /*
       * O caso que motiva a conferência de senha existir: sem ela, quem
       * descobrisse só o ID da galeria marcaria fotos de um casamento trancado
       * — sem nunca ver as fotos, mas sujando a lista que o fotógrafo usa.
       */
      await etapa("galeria com senha recusa quem não passou pela senha", async () => {
        await db.query("update galerias set senha_hash = 'g2:qualquer' where id = $1", [galeriaId]);
        try {
          igual((await marcar(galeriaId, { mediaId: foto })).status, 401, "status");
        } finally {
          await db.query("update galerias set senha_hash = null where id = $1", [galeriaId]);
        }
      });

      await etapa("galeria no cofre não aceita marcação", async () => {
        await db.query("update galerias set estado = 'arquivada' where id = $1", [galeriaId]);
        try {
          igual((await marcar(galeriaId, { mediaId: foto })).status, 409, "status");
        } finally {
          await db.query("update galerias set estado = 'online' where id = $1", [galeriaId]);
        }
      });

      await etapa("galeria não publicada não aceita marcação", async () => {
        await db.query("update galerias set publicada = false where id = $1", [galeriaId]);
        try {
          igual((await marcar(galeriaId, { mediaId: foto })).status, 404, "status");
        } finally {
          await db.query("update galerias set publicada = true where id = $1", [galeriaId]);
        }
      });
    } finally {
      await db.query(
        "update galerias set publicada = $1, senha_hash = $2, estado = $3 where id = $4",
        [antes.publicada, antes.senha_hash, antes.estado, galeriaId],
      );
    }
  }
} finally {
  await limpar();
  // Apaga tudo que este teste marcou pela rota (visitantes anônimos criados agora).
  await db.query("delete from favoritas where galeria_id = $1", [galeriaId]);
  await db.query("delete from galerias where id = $1", [galeriaVizinha]);
  await db.end();
}

if (falhou) {
  console.error("\n✗ as favoritas têm problema");
  process.exit(1);
}
console.log("\n✓ favoritas do cliente íntegras\n");
