#!/usr/bin/env node
/**
 * AS FOTOS DA PÁGINA INICIAL, TROCADAS PELO ADMIN. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-fotos-da-home.mjs
 *
 * ── DE ONDE VEIO (28/09/2026) ─────────────────────────────────────────────
 *
 * Felipe: "queremos também mudar as fotos que aparecem nessa página inicial,
 * aonde estão elas? eu consigo alterar no painel admin?" — e, com as primeiras
 * fotos autorais: "também crie na tela de admin". Ver a migração 043 e
 * `config/home-demonstracao.ts`.
 *
 * ── O QUE ESTE TESTE PRENDE ────────────────────────────────────────────────
 *
 * 1. A MESCLA: lugar sem troca mostra o padrão; troca válida vale por cima;
 *    linha ruim (lugar que saiu do código, medida impossível, chave de fora da
 *    pasta) é ignorada — a home nunca quebra, no pior caso mostra a de antes.
 * 2. A CHAVE: só vale a da pasta DESTE lugar e deste tamanho. Uma chave
 *    forjada poria na vitrine pública qualquer objeto do bucket — inclusive a
 *    foto de casamento de um cliente.
 * 3. OS PADRÕES: todo arquivo existe, e a medida declarada é a do arquivo —
 *    a grade monta as fileiras pela proporção antes de a foto chegar.
 * 4. A ROTA FIXA: redireciona para o link assinado da troca, cai no padrão
 *    sem troca, e não existe para lugar inventado.
 * 5. O PORTÃO: a tela e a API do admin não existem para estúdio comum nem
 *    para quem não está logado.
 */
import pg from "pg";
import sharp from "sharp";
import { existsSync } from "node:fs";
import path from "node:path";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import {
  FOTOS_PADRAO,
  IDENTIDADES,
  LUGARES_DA_HOME,
  LUGAR_DO_COFRE,
  ondeAparece,
} from "../src/config/home-demonstracao.ts";
import {
  chaveDaFotoDaHome,
  ehChaveDaFotoDaHome,
  mesclarFotosDaHome,
  normalizarFoco,
  recusaDaFotoDaHome,
} from "../src/lib/fotos-da-home-regras.ts";
import { fotosDaHome } from "../src/lib/fotos-da-home.ts";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const RAIZ = path.resolve(import.meta.dirname, "..");
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
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
  }
};

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const chave = (lugar, tamanho) => `plataforma/home/${lugar}/${UUID}-${tamanho}.webp`;
const linha = (lugar, extra = {}) => ({
  lugar,
  chave: chave(lugar, "foto"),
  chave_miniatura: chave(lugar, "miniatura"),
  largura: 1333,
  altura: 2000,
  descricao: "  Noivos\n no   jardim ",
  foco_x: 40,
  foco_y: 30,
  ...extra,
});

try {
  console.log("\nA mescla do padrão com as trocas\n");

  await etapa("sem troca nenhuma, a home é o padrão", () => {
    igual(mesclarFotosDaHome(FOTOS_PADRAO, []), FOTOS_PADRAO, "fotos");
  });

  await etapa("a troca vale por cima do padrão, só no lugar dela", () => {
    const f = mesclarFotosDaHome(FOTOS_PADRAO, [linha("delicada-1")]);
    if (!f["delicada-1"].src.startsWith("/api/home/foto/delicada-1?v=")) throw new Error(`src: ${f["delicada-1"].src}`);
    if (!f["delicada-1"].miniatura?.includes("t=miniatura")) throw new Error("miniatura sem o tamanho pequeno");
    igual([f["delicada-1"].largura, f["delicada-1"].altura], [1333, 2000], "medidas da troca");
    igual(f["delicada-1"].descricao, "Noivos no jardim", "descrição normalizada");
    igual([f["delicada-1"].focoX, f["delicada-1"].focoY], [40, 30], "foco");
    igual(f["delicada-2"], FOTOS_PADRAO["delicada-2"], "o vizinho não mudou");
  });

  await etapa("linha ruim é ignorada e o lugar fica com o padrão", () => {
    const ruins = [
      linha("foto1"), // lugar que saiu do código (o nome de antes das galerias)
      linha("delicada-2", { largura: 0 }),
      linha("editorial-3", { altura: 1.5 }),
      linha("noite-4", { chave: "estudio-x/galeria/foto.webp" }),
      linha("classica-2", { chave: chave("classica-3", "foto") }), // chave de OUTRO lugar
    ];
    const f = mesclarFotosDaHome(FOTOS_PADRAO, ruins);
    igual(f, FOTOS_PADRAO, "fotos");
  });

  await etapa("miniatura inválida não derruba a troca — a grade usa a grande", () => {
    const f = mesclarFotosDaHome(FOTOS_PADRAO, [linha("delicada-1", { chave_miniatura: "qualquer/coisa.webp" })]);
    igual(f["delicada-1"].miniatura, undefined, "miniatura");
    if (!f["delicada-1"].src.startsWith("/api/home/foto/delicada-1")) throw new Error("a troca se perdeu");
  });

  console.log("\nA chave que o navegador manda\n");

  await etapa("a chave gerada é aceita no próprio lugar e tamanho", () => {
    for (const lugar of LUGARES_DA_HOME) {
      for (const t of ["foto", "miniatura"]) {
        const c = chaveDaFotoDaHome(lugar, t);
        if (!ehChaveDaFotoDaHome(c, lugar, t)) throw new Error(`recusou a própria chave ${c}`);
      }
    }
  });

  await etapa("chave forjada é recusada", () => {
    const tentativas = [
      [chave("delicada-2", "foto"), "delicada-1", "foto", "de outro lugar"],
      [chave("delicada-1", "miniatura"), "delicada-1", "foto", "de outro tamanho"],
      ["estudio-123/galeria-9/foto-de-casamento.webp", "delicada-1", "foto", "de um cliente"],
      [`plataforma/home/delicada-1/../../estudio/${UUID}-foto.webp`, "delicada-1", "foto", "subindo pasta"],
      [`plataforma/home/delicada-1/nao-e-uuid-foto.webp`, "delicada-1", "foto", "sem uuid"],
      [`${chave("delicada-1", "foto")}.png`, "delicada-1", "foto", "extensão a mais"],
      [null, "delicada-1", "foto", "nula"],
    ];
    for (const [c, lugar, t, rotulo] of tentativas) {
      if (ehChaveDaFotoDaHome(c, lugar, t)) throw new Error(`aceitou chave ${rotulo}: ${c}`);
    }
  });

  await etapa("só WebP de tamanho plausível passa", () => {
    igual(recusaDaFotoDaHome("image/webp", 800_000), null, "webp normal");
    if (!recusaDaFotoDaHome("image/png", 800_000)) throw new Error("aceitou png");
    if (!recusaDaFotoDaHome("image/webp", 0)) throw new Error("aceitou vazio");
    if (!recusaDaFotoDaHome("image/webp", 30 * 1024 * 1024)) throw new Error("aceitou 30 MB");
  });

  await etapa("foco fora da foto volta para dentro", () => {
    igual([normalizarFoco(-10), normalizarFoco(140), normalizarFoco("abc"), normalizarFoco(33.6)], [0, 100, 50, 34], "foco");
  });

  console.log("\nAs fotos padrão\n");

  await etapa("todo arquivo padrão existe, com a medida declarada", async () => {
    for (const [lugar, f] of Object.entries(FOTOS_PADRAO)) {
      const arquivo = path.join(RAIZ, "public", f.src);
      if (!existsSync(arquivo)) throw new Error(`${lugar}: ${f.src} não existe`);
      const m = await sharp(arquivo).metadata();
      igual([m.width, m.height], [f.largura, f.altura], `${lugar} (${f.src})`);
    }
    return `${Object.keys(FOTOS_PADRAO).length} lugares`;
  });

  await etapa("toda identidade usa lugares que existem", () => {
    for (const i of IDENTIDADES) {
      for (const l of [i.capa, ...i.fotos]) {
        if (!LUGARES_DA_HOME.includes(l)) throw new Error(`${i.id} usa ${l}`);
      }
    }
  });

  await etapa("o admin sabe dizer onde cada foto aparece", () => {
    if (!ondeAparece("delicada-1").some((o) => o.includes('capa da galeria "Vanessa & Kalil"'))) {
      throw new Error("delicada-1 é a capa da Vanessa & Kalil");
    }
    if (ondeAparece("delicada-2").some((o) => o.includes("capa"))) throw new Error("delicada-2 não é capa");
    if (!ondeAparece("delicada-2").some((o) => o.includes("celular"))) throw new Error("a galeria em destaque some do celular");
    if (!ondeAparece("editorial-2").some((o) => o.includes("preto e branco"))) throw new Error("editorial é em preto e branco");
    if (!ondeAparece(LUGAR_DO_COFRE).some((o) => o.includes("Cofre"))) throw new Error("cofre sumiu");
    if (!ondeAparece("respiro")[0].includes("fim")) throw new Error("respiro");
  });

  console.log("\nO banco\n");

  await db.query("delete from fotos_da_home");

  await etapa("sem troca no banco, a função devolve o padrão", async () => {
    igual(await fotosDaHome(), FOTOS_PADRAO, "fotos");
  });

  await db.query(
    `insert into fotos_da_home (lugar, chave, chave_miniatura, largura, altura, descricao, foco_x, foco_y)
     values ($1, $2, $3, 1333, 2000, 'Noivos no jardim', 40, 30)`,
    ["delicada-1", chave("delicada-1", "foto"), chave("delicada-1", "miniatura")],
  );

  await etapa("com troca no banco, a função devolve a troca", async () => {
    const f = await fotosDaHome();
    if (!f["delicada-1"].src.startsWith("/api/home/foto/delicada-1?v=")) throw new Error(`src: ${f["delicada-1"].src}`);
    igual(f["delicada-2"], FOTOS_PADRAO["delicada-2"], "o resto");
  });

  let servidor = false;
  try {
    servidor = (await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    servidor = false;
  }

  if (!servidor) {
    console.log("\n⚠ servidor fora do ar — a parte das rotas foi pulada");
  } else {
    console.log("\nA rota fixa da foto\n");

    const destino = async (url) => {
      const r = await fetch(`${BASE}${url}`, { redirect: "manual" });
      return { status: r.status, local: r.headers.get("location") ?? "", cache: r.headers.get("cache-control") ?? "" };
    };

    await etapa("a troca redireciona para o link assinado da foto grande", async () => {
      const r = await destino("/api/home/foto/delicada-1?v=x");
      igual(r.status, 302, "status");
      if (!r.local.includes(chave("delicada-1", "foto"))) {
        throw new Error(`foi para ${r.local}`);
      }
      if (!/X-Amz-Signature=/.test(r.local)) throw new Error("o link não é assinado");
      if (!/public, max-age=300/.test(r.cache)) throw new Error(`cache: ${r.cache}`);
    });

    await etapa("a miniatura redireciona para a pequena", async () => {
      const r = await destino("/api/home/foto/delicada-1?v=x&t=miniatura");
      if (!r.local.includes(chave("delicada-1", "miniatura"))) throw new Error(`foi para ${r.local}`);
    });

    await etapa("lugar sem troca cai na foto padrão", async () => {
      const r = await destino("/api/home/foto/delicada-2");
      igual([r.status, r.local], [302, FOTOS_PADRAO["delicada-2"].src], "redirecionamento");
    });

    await etapa("lugar inventado não existe", async () => {
      igual((await destino("/api/home/foto/foto99")).status, 404, "status");
      igual((await destino("/api/home/foto/..%2Fadmin")).status, 404, "status");
    });

    console.log("\nO portão do admin\n");

    const estudio = await estudioDaRodada(db);
    const cookie = cookieDeSessao(estudio.id);

    await etapa("a tela não existe para estúdio comum", async () => {
      const r = await fetch(`${BASE}/painel/admin/home`, { headers: { cookie } });
      igual(r.status, 404, "status");
      if (/Fotos da página inicial/.test(await r.text())) throw new Error("vazou o título da tela");
    });

    await etapa("nem sem sessão", async () => {
      const r = await fetch(`${BASE}/painel/admin/home`, { redirect: "manual" });
      if (r.status === 200) throw new Error("respondeu 200 sem sessão");
      return `HTTP ${r.status}`;
    });

    await etapa("a API recusa estúdio comum e quem não entrou, nos quatro verbos", async () => {
      for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) {
        for (const headers of [{ cookie }, {}]) {
          const r = await fetch(`${BASE}/api/admin/home/foto`, {
            method: metodo,
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify({ lugar: "delicada-1" }),
          });
          igual(r.status, 404, `${metodo} ${headers.cookie ? "estúdio comum" : "sem sessão"}`);
        }
      }
      const { rows } = await db.query("select count(*)::int n from fotos_da_home where lugar = 'delicada-1'");
      igual(rows[0].n, 1, "a troca continua lá — o DELETE recusado não apagou nada");
    });
  }
} finally {
  await db.query("delete from fotos_da_home where chave like $1", [`plataforma/home/%/${UUID}-%`]);
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ as fotos da home têm problema" : "\n✓ as fotos da home trocam pelo admin, e só por ele\n");
process.exit(falhou ? 1 : 0);
