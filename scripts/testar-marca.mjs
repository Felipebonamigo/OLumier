#!/usr/bin/env node
/**
 * Testa a marca do estúdio — regras puras e o envio da logo de ponta a ponta.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-marca.mjs
 *
 * Por que existe: a logo era lida na capa desde sempre e nunca teve como ser
 * gravada. Agora que tem, o caminho inteiro precisa ficar preso — inclusive as
 * duas partes que só quebram em silêncio: a chave de OUTRO estúdio ser recusada,
 * e a logo antiga ser apagada do bucket na troca (senão vira arquivo pago que
 * ninguém enxerga).
 */
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import pg from "pg";
import {
  COR_PADRAO,
  LIMITE_LOGO,
  normalizarCor,
  normalizarNomeEstudio,
  recusaDaLogo,
  temasEmQueSome,
  contraste,
  FUNDO_ESCURO,
} from "../src/lib/marca-estudio.ts";
import { paraCampoDeData } from "../src/lib/datas.ts";
import { objetoExiste, apagarObjeto } from "../src/lib/r2.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const { DATABASE_URL } = process.env;

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

console.log("regras da cor");

await etapa("#abc vira #aabbcc", () => igual(normalizarCor("#ABC"), "#aabbcc", "cor curta"));
await etapa("espaço e maiúscula não atrapalham", () =>
  igual(normalizarCor("  #F0C268 "), "#f0c268", "cor com espaço"),
);

await etapa("recusa o que não é cor", () => {
  for (const ruim of ["vermelho", "#12345", "rgb(0,0,0)", "", "#gggggg"]) {
    igual(normalizarCor(ruim), null, `deveria recusar "${ruim}"`);
  }
});

/*
 * O caso que justifica a peneira existir: a cor vai para dentro de um `style` na
 * galeria pública. Se qualquer texto passasse, o campo deixaria de ser uma cor e
 * viraria CSS escolhido por quem preencheu.
 */
await etapa("recusa CSS disfarçado de cor", () => {
  for (const ataque of [
    "red;background:url(https://fora/x)",
    "#fff;position:fixed;inset:0",
    "url(javascript:alert(1))",
  ]) {
    igual(normalizarCor(ataque), null, `deveria recusar "${ataque}"`);
  }
});

console.log("\naviso de contraste");

await etapa("cor quase preta some no fundo escuro", () => {
  const r = temasEmQueSome("#0e0c0a");
  if (!r.includes("escuro")) throw new Error(`esperava avisar do escuro, veio ${JSON.stringify(r)}`);
});

await etapa("cor quase branca some no fundo claro", () => {
  const r = temasEmQueSome("#fdfdfd");
  if (!r.includes("claro")) throw new Error(`esperava avisar do claro, veio ${JSON.stringify(r)}`);
});

/*
 * A cor padrão é o dourado da marca, pensado para fundo escuro. No branco ela
 * fica em ~1,6:1 — some mesmo. Hoje isso não afeta ninguém porque o único lugar
 * que desenha essa cor (a vitrine /e/<slug>) é fixo no tema noite.
 *
 * O teste registra os dois fatos de propósito: se um dia a vitrine ganhar tema
 * claro, ou a cor passar a valer dentro da galeria, esta linha é o aviso de que
 * o padrão precisa mudar junto.
 */
await etapa("a cor padrão funciona no escuro, que é onde ela aparece", () => {
  const r = temasEmQueSome(COR_PADRAO);
  if (r.includes("escuro")) throw new Error("o dourado padrão sumiu no próprio fundo dele");
  igual(r.includes("claro"), true, "esperava aviso para o fundo claro");
  return `${contraste(COR_PADRAO, FUNDO_ESCURO).toFixed(1)}:1 no escuro · avisa no claro`;
});

console.log("\nnome do estúdio");

await etapa("junta espaço repetido e corta a ponta", () =>
  igual(normalizarNomeEstudio("  Sirius   Fotografia  "), "Sirius Fotografia", "nome"),
);
await etapa("mantém acento, & e ponto", () =>
  igual(normalizarNomeEstudio("Ana & Pedro Fotografia Ltda."), "Ana & Pedro Fotografia Ltda.", "nome"),
);
await etapa("recusa nome de uma letra", () => igual(normalizarNomeEstudio("A"), null, "nome curto"));

console.log("\nregras da logo");

await etapa("aceita PNG pequeno", () => igual(recusaDaLogo("image/png", 120_000), null, "png"));
await etapa("recusa acima de 2 MB", () => {
  if (!recusaDaLogo("image/png", LIMITE_LOGO + 1)) throw new Error("deixou passar arquivo grande");
});
await etapa("recusa SVG", () => {
  if (!recusaDaLogo("image/svg+xml", 5_000)) throw new Error("deixou passar SVG");
});
await etapa("recusa PDF e vídeo", () => {
  for (const m of ["application/pdf", "video/mp4", "text/html"]) {
    if (!recusaDaLogo(m, 1000)) throw new Error(`deixou passar ${m}`);
  }
});

console.log("\ndata do evento");

/*
 * O bug que este teste impede: a coluna é `date` e o driver entrega meia-noite
 * LOCAL. Passar por toISOString() devolve o dia anterior em qualquer fuso
 * positivo — a data apareceria um dia atrás no formulário e seria salva assim.
 */
await etapa("não perde um dia na conversão", () => {
  const d = new Date(2026, 2, 15); // 15/03/2026, meia-noite local
  igual(paraCampoDeData(d), "2026-03-15", "data");
});
await etapa("preenche com zero à esquerda", () =>
  igual(paraCampoDeData(new Date(2026, 0, 5)), "2026-01-05", "data"),
);

// --- ponta a ponta ----------------------------------------------------------

let servidor = false;
try {
  servidor = (await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(4000) })).ok;
} catch {
  servidor = false;
}

if (!servidor) {
  console.log("\n⚠ servidor fora do ar — a parte de ponta a ponta foi pulada");
} else {
  console.log("\nenvio da logo (ponta a ponta)");

  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();

  const { rows } = await db.query("select id, logo_chave from tenants order by criado_em limit 1");
  const tid = rows[0].id;
  const logoAntes = rows[0].logo_chave;

  const cookie = cookieDeSessao(tid);

  // PNG 1x1 de verdade — o servidor confere o que CHEGOU no bucket, então não
  // adianta mandar texto dizendo que é imagem.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  let chaveNova = null;

  try {
    await etapa("recusa tipo não aceito antes de assinar", async () => {
      const r = await fetch(`${BASE}/api/marca/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ mime: "image/svg+xml", bytes: 4000 }),
      });
      igual(r.status, 415, "status do SVG");
    });

    await etapa("recusa arquivo acima do limite", async () => {
      const r = await fetch(`${BASE}/api/marca/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ mime: "image/png", bytes: LIMITE_LOGO + 1 }),
      });
      igual(r.status, 415, "status do arquivo grande");
    });

    await etapa("sem sessão não assina nada", async () => {
      const r = await fetch(`${BASE}/api/marca/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime: "image/png", bytes: 1000 }),
      });
      igual(r.status, 401, "status sem cookie");
    });

    await etapa("recusa chave de outro estúdio", async () => {
      const r = await fetch(`${BASE}/api/marca/logo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ chave: "00000000-0000-0000-0000-000000000000/marca/roubada.png" }),
      });
      igual(r.status, 400, "status da chave alheia");
    });

    await etapa("envia e grava", async () => {
      const pedido = await fetch(`${BASE}/api/marca/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ mime: "image/png", bytes: PNG.length }),
      });
      const d = await pedido.json();
      if (!pedido.ok) throw new Error(d.erro ?? `HTTP ${pedido.status}`);
      chaveNova = d.chave;

      const put = await fetch(d.url, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: PNG,
      });
      if (!put.ok) throw new Error(`PUT no bucket devolveu ${put.status}`);

      const conf = await fetch(`${BASE}/api/marca/logo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ chave: d.chave }),
      });
      const fim = await conf.json();
      if (!conf.ok) throw new Error(fim.erro ?? `HTTP ${conf.status}`);

      const { rows: r2 } = await db.query("select logo_chave from tenants where id = $1", [tid]);
      igual(r2[0].logo_chave, d.chave, "chave gravada no banco");
      if (!(await objetoExiste(d.chave))) throw new Error("objeto não está no bucket");
      return d.chave.split("/").pop();
    });

    await etapa("trocar a logo apaga a anterior do bucket", async () => {
      const anterior = chaveNova;

      const pedido = await fetch(`${BASE}/api/marca/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ mime: "image/png", bytes: PNG.length }),
      });
      const d = await pedido.json();
      await fetch(d.url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: PNG });
      await fetch(`${BASE}/api/marca/logo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ chave: d.chave }),
      });
      chaveNova = d.chave;

      if (await objetoExiste(anterior)) {
        throw new Error("a logo antiga continua no bucket, sendo cobrada");
      }
      return "sem arquivo pago sobrando";
    });

    /*
     * Precisa rodar ENQUANTO existe logo gravada — por isso vem antes da
     * remoção. Depois do DELETE não haveria logo nenhuma para proteger, e o
     * teste passaria sem ter verificado nada.
     */
    await etapa("o varredor de órfãos não apaga logo em uso", async () => {
      // A logo não tem linha em `medias`. Uma varredura que olhasse só aquela
      // tabela classificaria a logo de TODOS os estúdios como órfã.
      const { chavesConhecidas } = await import("./varrer-orfaos-regras.mjs");
      const conhecidas = await chavesConhecidas(db);
      const { rows: r3 } = await db.query(
        "select logo_chave from tenants where logo_chave is not null",
      );
      if (r3.length === 0) throw new Error("nenhuma logo gravada — o teste não verificou nada");
      for (const l of r3) {
        if (!conhecidas.has(l.logo_chave)) throw new Error(`logo ${l.logo_chave} seria apagada`);
      }
      return `${r3.length} logo(s) protegida(s)`;
    });

    await etapa("tirar a logo limpa o banco e o bucket", async () => {
      const alvo = chaveNova;
      const r = await fetch(`${BASE}/api/marca/logo`, { method: "DELETE", headers: { cookie } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const { rows: r2 } = await db.query("select logo_chave from tenants where id = $1", [tid]);
      igual(r2[0].logo_chave, null, "banco depois de tirar");
      if (await objetoExiste(alvo)) throw new Error("objeto continua no bucket");
      chaveNova = null;
    });
  } finally {
    // Devolve o estúdio ao estado anterior e não deixa arquivo pago para trás.
    if (chaveNova) await apagarObjeto(chaveNova).catch(() => {});
    await db.query("update tenants set logo_chave = $1 where id = $2", [logoAntes, tid]);
    await db.end();
  }
}

if (falhou) {
  console.error("\n✗ a marca do estúdio tem problema");
  process.exit(1);
}
console.log("\n✓ marca do estúdio íntegra\n");
