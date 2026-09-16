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
import { galeriaDaRodada, marcaDaRodada } from "./fixture-de-teste.mjs";
import { alternarDaPessoa, pessoaPorEmail, resumoDaGaleria } from "../src/lib/favoritas.ts";

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

const foto = bancada.midias[0].id;
const outraFoto = bancada.midias[1]?.id ?? bancada.midias[0].id;

/*
 * DUAS PESSOAS DE VERDADE, desde a migração 033.
 *
 * Antes daqui vinham dois ids de visitante inventados, porque a coluna era
 * texto livre. Agora a favorita aponta para `pessoas_da_galeria`, e uma string
 * qualquer não é mais aceita pelo banco — o que é a mudança funcionando.
 *
 * O e-mail carrega a marca da execução pela mesma razão de sempre: com endereço
 * fixo, duas execuções simultâneas dividiriam a mesma pessoa e o `limpar()` de
 * uma varreria a lista da outra.
 */
const PESSOA_A = await pessoaPorEmail(galeriaId, `a-${marcaDaRodada()}@exemplo.com`, "Pessoa A");
const PESSOA_B = await pessoaPorEmail(galeriaId, `b-${marcaDaRodada()}@exemplo.com`, "Pessoa B");
const VISITANTE_A = PESSOA_A.id;
const VISITANTE_B = PESSOA_B.id;

// Galeria descartável, para provar o isolamento entre galerias.
const galeriaVizinha = (await galeriaDaRodada(db, { nome: "vizinha", medias: 1 })).id;

async function limpar() {
  await db.query("delete from favoritas where pessoa_id in ($1, $2)", [VISITANTE_A, VISITANTE_B]);
}

try {
  await limpar();
  console.log("marcar e desmarcar");

  await etapa("marca a foto", async () => {
    const r = await alternarDaPessoa(galeriaId, foto, VISITANTE_A);
    igual(r?.favorita, true, "resultado");
    const { rows } = await db.query(
      "select count(*)::int n from favoritas where media_id = $1 and pessoa_id = $2",
      [foto, VISITANTE_A],
    );
    igual(rows[0].n, 1, "linhas no banco");
  });

  await etapa("marcar de novo DESMARCA", async () => {
    const r = await alternarDaPessoa(galeriaId, foto, VISITANTE_A);
    igual(r?.favorita, false, "resultado");
    const { rows } = await db.query(
      "select count(*)::int n from favoritas where media_id = $1 and pessoa_id = $2",
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
        `insert into favoritas (galeria_id, media_id, visitante, pessoa_id) values ($1,$2,$3::text,$3::uuid)
         on conflict (galeria_id, media_id, pessoa_id) where pessoa_id is not null do nothing`,
        [galeriaId, foto, VISITANTE_A],
      ),
      db.query(
        `insert into favoritas (galeria_id, media_id, visitante, pessoa_id) values ($1,$2,$3::text,$3::uuid)
         on conflict (galeria_id, media_id, pessoa_id) where pessoa_id is not null do nothing`,
        [galeriaId, foto, VISITANTE_A],
      ),
    ]);
    const { rows } = await db.query(
      "select count(*)::int n from favoritas where media_id = $1 and pessoa_id = $2",
      [foto, VISITANTE_A],
    );
    igual(rows[0].n, 1, "linhas depois de duas inserções");
  });

  await etapa("foto de OUTRA galeria é recusada", async () => {
    const r = await alternarDaPessoa(galeriaVizinha, foto, VISITANTE_A);
    igual(r, null, "resultado");
  });

  console.log("\nresumo para o fotógrafo");

  /*
   * ── FOI E VOLTOU: 010 → 019 → 033 ────────────────────────────────────────
   *
   * Até a 018 cada visitante tinha a SUA lista. A 019 colapsou em uma lista da
   * galeria, para o casal escolher junto. A 033 (15/09/2026) voltou à lista por
   * pessoa, agora com e-mail, porque o link vai para o casamento inteiro e
   * qualquer convidado desmarcava a escolha da noiva.
   *
   * Estas duas etapas travaram o modelo de 019 — foi por elas que a mudança
   * apareceu vermelha em vez de passar despercebida, que é o serviço que se
   * espera delas. Agora travam o de 033, e o que elas afirmam é o INVERSO do
   * que afirmavam ontem. A separação em si tem suíte própria em
   * `testar-favoritas-por-pessoa.mjs`; aqui ficam as duas perguntas que o
   * resumo do FOTÓGRAFO faz.
   */
  await etapa("o resumo do fotógrafo soma as duas listas", async () => {
    await limpar();
    await alternarDaPessoa(galeriaId, foto, VISITANTE_A);
    await alternarDaPessoa(galeriaId, outraFoto, VISITANTE_B);

    const r = await resumoDaGaleria(galeriaId);
    igual(r.fotos, foto === outraFoto ? 1 : 2, "fotos distintas escolhidas");
    igual(r.pessoas, 2, "pessoas que contribuíram");
    return `${r.fotos} foto(s), ${r.pessoas} pessoa(s)`;
  });

  await etapa("a MESMA foto escolhida pelos dois conta uma vez para o álbum", async () => {
    await limpar();
    await alternarDaPessoa(galeriaId, foto, VISITANTE_A);
    igual((await resumoDaGaleria(galeriaId)).fotos, 1, "depois do primeiro");

    /* O segundo escolhe a MESMA foto. Antes isso DESMARCAVA — era o defeito.
       Agora entra na lista dele, e o álbum continua com uma foto: o fotógrafo
       revela uma cópia, escolhida por duas pessoas. */
    await alternarDaPessoa(galeriaId, foto, VISITANTE_B);
    const r = await resumoDaGaleria(galeriaId);
    igual(r.fotos, 1, "fotos distintas depois do segundo");
    igual(r.pessoas, 2, "pessoas que escolheram essa foto");
    return "duas escolhas, uma foto no álbum";
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

    /*
     * ── DESDE A MIGRAÇÃO 033, MARCAR EXIGE DIZER QUEM É ────────────────────
     *
     * A favorita tem dona. Uma identificação serve para o arquivo inteiro: o
     * que estas etapas conferem é a ROTA das favoritas — cookie, senha, cofre,
     * foto de outra galeria —, e não o cadastro, que tem suíte própria em
     * `testar-favoritas-por-pessoa.mjs`.
     */
    let euCookie = "";
    const identificar = async (gid, email) => {
      const r = await fetch(`${BASE}/api/g/${gid}/eu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      return (r.headers.get("set-cookie") ?? "").split(";")[0];
    };

    const marcar = (gid, corpo, cookie) => {
      const cookies = [euCookie, cookie].filter(Boolean).join("; ");
      return fetch(`${BASE}/api/g/${gid}/favoritas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cookies ? { cookie: cookies } : {}) },
        body: JSON.stringify(corpo),
      });
    };

    // Estado de partida conhecido: publicada, sem senha, no ar.
    const antes = (
      await db.query("select publicada, senha_hash, estado from galerias where id = $1", [galeriaId])
    ).rows[0];
    await db.query(
      "update galerias set publicada = true, senha_hash = null, estado = 'online' where id = $1",
      [galeriaId],
    );

    try {
      /* A regra nova, conferida ANTES de tudo — e é ela que dá sentido às
         outras: sem dizer quem é, não há lista onde a marcação caia. */
      await etapa("sem se identificar, a rota pede o e-mail (428)", async () => {
        const r = await marcar(galeriaId, { mediaId: foto });
        igual(r.status, 428, "status");
        const d = await r.json();
        if (!d.precisaEmail) throw new Error("a resposta não diz que falta o e-mail");
        return "428 · precisaEmail";
      });

      euCookie = await identificar(galeriaId, `teste-${Date.now()}@exemplo.com`);
      if (!/^pes_[0-9a-f]{8}=/.test(euCookie)) {
        throw new Error(`a identificação não devolveu cookie de pessoa: ${euCookie}`);
      }

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
