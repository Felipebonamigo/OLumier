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
  GALERIA_DA_SECAO,
  LUGAR_DO_COFRE,
  ondeAparece,
} from "../src/config/home-demonstracao.ts";
import {
  centroDaFaixa,
  chaveDaFotoDaHome,
  ehChaveDaFotoDaHome,
  focoQueCentraliza,
  fracaoVistaNaFaixa,
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

  /*
   * ── O FOCO DAS FOTOS PADRÃO (07/10/2026) ─────────────────────────────────
   *
   * Juan: "não tô conseguindo arrumar o centro focal, de nenhuma das fotos".
   * O foco só se marcava em foto TROCADA; as fotos de verdade são as padrão.
   * Agora o ajuste mora em `focos_da_home` e vale por cima do foco do código —
   * mas não por cima do foco de uma foto trocada, que o admin marcou olhando
   * para ela.
   */
  await etapa("o foco ajustado vale por cima do foco do código, só no lugar dele", () => {
    const f = mesclarFotosDaHome(FOTOS_PADRAO, [], [{ lugar: "delicada-1", foco_x: 62, foco_y: 18 }]);
    igual([f["delicada-1"].focoX, f["delicada-1"].focoY], [62, 18], "foco ajustado");
    igual(f["delicada-1"].src, FOTOS_PADRAO["delicada-1"].src, "a foto continua a padrão");
    igual(f["delicada-1"].descricao, FOTOS_PADRAO["delicada-1"].descricao, "a descrição continua a do site");
    igual(f["delicada-2"], FOTOS_PADRAO["delicada-2"], "o vizinho não mudou");
  });

  await etapa("foto trocada mantém o foco da própria linha — o ajuste da padrão não a toca", () => {
    const f = mesclarFotosDaHome(FOTOS_PADRAO, [linha("delicada-1")], [{ lugar: "delicada-1", foco_x: 62, foco_y: 18 }]);
    igual([f["delicada-1"].focoX, f["delicada-1"].focoY], [40, 30], "foco da troca");
  });

  await etapa("ajuste de lugar que saiu do código é ignorado, e foco fora da foto volta para dentro", () => {
    igual(mesclarFotosDaHome(FOTOS_PADRAO, [], [{ lugar: "foto1", foco_x: 10, foco_y: 10 }]), FOTOS_PADRAO, "lugar velho");
    const f = mesclarFotosDaHome(FOTOS_PADRAO, [], [{ lugar: "delicada-2", foco_x: 400, foco_y: -3 }]);
    igual([f["delicada-2"].focoX, f["delicada-2"].focoY], [100, 0], "foco");
  });

  /*
   * O clique CENTRALIZA o recorte (07/10/2026). `object-position: y%` deixa o
   * ponto de y% da foto perto do topo da faixa, não no meio; clicar no rosto
   * cortava a cabeça. Foto 2:3 numa faixa 5:2 mostra 26,7% da altura.
   */
  await etapa("o clique no rosto deixa o rosto no meio da faixa larga, e o marcador volta ao clique", () => {
    const vista = fracaoVistaNaFaixa(1333, 2000);
    if (Math.abs(vista - 0.2666) > 0.001) throw new Error(`vista ${vista}`);
    /* rosto a 28% da altura: o recorte vai de 14,7% a 41,3% — o rosto no meio */
    const y = focoQueCentraliza(28, vista);
    igual(y, 20, "foco que centraliza o rosto a 28%");
    const topo = (y / 100) * (1 - vista) * 100;
    if (Math.abs(topo + 50 * vista - 28) > 1) throw new Error(`o meio do recorte caiu em ${topo + 50 * vista}%`);
    if (Math.abs(centroDaFaixa(y, vista) - 28) > 1) throw new Error("o marcador não volta ao ponto clicado");
  });

  await etapa("rosto na borda da foto encosta o foco em 0 ou 100, e foto larga demais não corta na vertical", () => {
    const vista = fracaoVistaNaFaixa(1333, 2000);
    igual(focoQueCentraliza(3, vista), 0, "rosto colado no topo");
    igual(focoQueCentraliza(98, vista), 100, "rosto colado na base");
    igual(fracaoVistaNaFaixa(3000, 1000), 1, "foto mais larga que a faixa");
    igual(focoQueCentraliza(40, 1), 40, "sem corte vertical, o clique vale como está");
    igual(fracaoVistaNaFaixa(0, 0), 1, "medida inválida");
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

  /*
   * A CAPA QUE O FOTÓGRAFO ESCOLHEU (28/09/2026).
   *
   * Juan, mandando as fotos do casamento dele para a home: "uma das fotos eu
   * sinalizei com o nome 'capa'" — o beijo debaixo da árvore grande, com o véu
   * espalhado na grama. Na primeira montagem a capa saiu sendo outra (o beijo
   * diante da casa de pedra), escolhida por ser deitada, que é o formato que a
   * capa "jornal" pede.
   *
   * O formato é razão nossa; a escolha é dele. Numa página cujo argumento é
   * "a marca do fotógrafo fica na frente", mostrar a galeria dele com a capa
   * que NÓS preferimos é justamente o contrário do que a página afirma.
   */
  await etapa("a capa da galeria do Juan é a que ele marcou", () => {
    const classica = IDENTIDADES.find((i) => i.id === "classica");
    if (!classica) throw new Error("a identidade do Juan sumiu da home");
    const capa = FOTOS_PADRAO[classica.capa];
    if (!capa) throw new Error(`o lugar ${classica.capa} não tem foto padrão`);
    const arquivo = capa.src.split("/").pop();
    if (!capa.src.includes("beijo-arvore")) {
      throw new Error(`a capa é ${arquivo} — ele marcou o beijo debaixo da árvore`);
    }
    return arquivo;
  });

  await etapa("o admin sabe dizer onde cada foto aparece", () => {
    if (!ondeAparece("delicada-1").some((o) => o.includes('capa da galeria "Marina & Caio"'))) {
      throw new Error("delicada-1 é a capa da Marina & Caio");
    }
    if (ondeAparece("delicada-2").some((o) => o.includes("capa"))) throw new Error("delicada-2 não é capa");
    /* Desde 03/10/2026 o celular mostra outra galeria (`GALERIA_DA_SECAO`), para
       a galeria da Carol não se repetir em toda seção. */
    if (!ondeAparece(`${GALERIA_DA_SECAO.celular}-2`).some((o) => o.includes("celular"))) throw new Error("a galeria do celular sumiu");
    if (ondeAparece("delicada-2").some((o) => o.includes("celular"))) throw new Error("a galeria da Carol voltou para o celular");
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

  await etapa("o ajuste de foco da padrão, no banco, chega à home — e a troca não é afetada", async () => {
    await db.query(
      "insert into focos_da_home (lugar, foco_x, foco_y) values ('delicada-2', 33, 12), ('delicada-1', 70, 70)",
    );
    try {
      const f = await fotosDaHome();
      igual([f["delicada-2"].focoX, f["delicada-2"].focoY], [33, 12], "ajustado");
      igual(f["delicada-2"].src, FOTOS_PADRAO["delicada-2"].src, "continua a foto padrão");
      igual([f["delicada-1"].focoX, f["delicada-1"].focoY], [40, 30], "delicada-1 está trocada: vale a linha dela");
    } finally {
      await db.query("delete from focos_da_home");
    }
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

    await etapa("estúdio comum não ajusta foco, nem com o corpo certo", async () => {
      const r = await fetch(`${BASE}/api/admin/home/foto`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ lugar: "delicada-2", focoX: 5, focoY: 5 }),
      });
      igual(r.status, 404, "status");
      const { rows } = await db.query("select count(*)::int n from focos_da_home");
      igual(rows[0].n, 0, "nada foi gravado");
    });
  }
} finally {
  await db.query("delete from fotos_da_home where chave like $1", [`plataforma/home/%/${UUID}-%`]);
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ as fotos da home têm problema" : "\n✓ as fotos da home trocam pelo admin, e só por ele\n");
process.exit(falhou ? 1 : 0);
