#!/usr/bin/env node
/**
 * BAIXAR SEPARADO EM PASTAS. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-download-por-pasta.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (10/09/2026) ─────────────────────────────────────────────────
 *
 * Juan: "MENU do download das fotos. Pra poder escolher se será feito todas de
 * uma única vez ou se será separado em pastas."
 *
 * As pastas já existem — são os CAPÍTULOS da galeria (Making Of, Cerimônia,
 * Festa), que o envio por pasta do Lightroom já cria sozinho. O que faltava era
 * poder baixar um só.
 *
 * ── O QUE ISSO MEXE NA ATIVIDADE ──────────────────────────────────────────
 *
 * "Baixou tudo" é prova de entrega que o fotógrafo lê para saber se o casal
 * recebeu. Se baixar UMA pasta contasse como baixar tudo, a aba Atividade
 * diria que o casal levou o casamento inteiro quando ele levou a cerimônia —
 * e é justamente essa tela que ele abre quando o cliente diz que não recebeu.
 * Mesma família do defeito de 05/09, em que o clique contava como entrega.
 *
 * Por isso a ação registrada depende do TAMANHO DO PEDIDO, e é `acaoDeEntrega`
 * que decide. Uma pasta vira um "baixou" comum: menos do que aconteceu, nunca
 * mais — número subestimado é lacuna, número inflado é mentira.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { acaoDeEntrega } from "../src/lib/salvar-client.ts";
import { FOTOS_POR_TELA } from "../src/config/fatia-galeria.ts";

await exigirBancoDeTeste();

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

console.log("O que fica registrado na Atividade:\n");

await etapa("pedir a galeria inteira conta como “baixou tudo”", () => {
  const a = acaoDeEntrega(200, 200);
  if (a !== "baixou_tudo") throw new Error(`veio ${a}`);
  return a;
});

await etapa("pedir UMA pasta NÃO conta como “baixou tudo”", () => {
  const a = acaoDeEntrega(42, 200);
  if (a !== "baixou") throw new Error(`42 de 200 fotos viraram ${a} — a Atividade mentiria`);
  return a;
});

await etapa("uma pasta que por acaso tem tudo conta como tudo", () => {
  /* Galeria de capítulo único: baixar "Cerimônia" É baixar a galeria. O que
     manda é o tamanho do pedido, não o nome do botão que foi clicado. */
  const a = acaoDeEntrega(30, 30);
  if (a !== "baixou_tudo") throw new Error(`veio ${a}`);
  return a;
});

/*
 * ── A GALERIA QUE NÃO COUBE INTEIRA (11/09/2026) ──────────────────────────
 *
 * No mesmo dia em que o corte por fatia entrou (ver `config/fatia-galeria.ts`),
 * ele criou um caso que esta função não conhecia: `itens` deixou de ser "a
 * galeria" e passou a ser "o pedaço que coube na tela".
 *
 * Na galeria de 2.108 fotos da Carol, o pedaço são 600. Baixar esses 600
 * comparava 600 com 600 e registrava BAIXOU TUDO — a Atividade jurando ao
 * fotógrafo que o casal levou o casamento inteiro, tendo levado 28%. É a mesma
 * prova falsa de 05/09, por outra porta.
 *
 * A regra não muda: quem decide é o tamanho do pedido contra o tamanho da
 * GALERIA. O que mudou foi quem sabe esse total — e é por isso que ele precisa
 * ser passado de fora, em vez de deduzido da lista que está na mão.
 */
await etapa("baixar a fatia de uma galeria grande NÃO é baixar tudo", () => {
  const a = acaoDeEntrega(600, 2108);
  if (a !== "baixou") {
    throw new Error(`600 de 2108 viraram ${a} — a Atividade contaria entrega que não houve`);
  }
  return a;
});

await etapa("e a galeria passa o total DELA, não o da fatia", async () => {
  /* A etapa acima prova a regra; esta prova que ela é chamada com o número
     certo. Sem as duas, a função devolve "baixou" para 600 de 2108 e o
     componente segue perguntando "600 de 600?" — cada uma certa sozinha, e a
     Atividade errada mesmo assim. */
  const { readFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const fonte = readFileSync(
    path.join(path.resolve(import.meta.dirname, ".."), "src/components/galeria-cliente.tsx"),
    "utf8",
  );
  const chamada = fonte.match(/acaoDeEntrega\([^)]*\)/)?.[0] ?? "";
  if (!chamada) throw new Error("ninguém registra a entrega");
  if (/itens\.length/.test(chamada)) {
    throw new Error(
      `${chamada} — numa galeria fatiada \`itens\` é só o pedaço na tela, e 600 de 600 vira "baixou tudo"`,
    );
  }
  return chamada;
});

console.log("\nOs itens do menu:\n");

const g = await galeriaDaRodada(db, { nome: "pastas", medias: 4, publicada: true });
await db.query("update galerias set senha_hash = null, permite_download = true where id = $1", [
  g.id,
]);

const menuBaixar = async () => {
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  const barra = html.match(/<nav[^>]*aria-label="Menu da galeria"[^]*?<\/nav>/)?.[0] ?? "";
  if (!barra) throw new Error("não achei a barra de menus");
  const menu = barra.match(/<details[^]*?<summary[^>]*>[^]*?Baixar[^]*?<\/details>/)?.[0];
  if (!menu) throw new Error("não achei o menu Baixar");
  return menu;
};

await etapa("sem capítulos, o menu tem só o baixar tudo", async () => {
  const m = await menuBaixar();
  if (!/Todas as fotos num zip \(4\)/.test(m)) throw new Error("sumiu o baixar tudo");
  return "um item";
});

let capA, capB;
await etapa("com capítulos, cada um vira um item com a sua contagem", async () => {
  const { rows } = await db.query(
    `insert into secoes (galeria_id, nome, ordem)
          values ($1, 'Cerimônia', 0), ($1, 'Festa', 1) returning id, nome`,
    [g.id],
  );
  [capA, capB] = rows;
  /* Três fotos na Cerimônia, uma na Festa: contagens DIFERENTES de propósito —
     com dois números iguais, um item que mostrasse o total da galeria passaria
     despercebido. */
  for (const m of g.midias.slice(0, 3)) {
    await db.query("update medias set secao_id = $2 where id = $1", [m.id, capA.id]);
  }
  await db.query("update medias set secao_id = $2 where id = $1", [g.midias[3].id, capB.id]);

  const m = await menuBaixar();
  if (!/Cerimônia \(3\)/.test(m)) throw new Error("não achei “Cerimônia (3)”");
  if (!/Festa \(1\)/.test(m)) throw new Error("não achei “Festa (1)”");
  if (!/Todas as fotos num zip \(4\)/.test(m)) throw new Error("o baixar tudo sumiu junto");
  return "Cerimônia (3) · Festa (1) · Todas (4)";
});

/* Capítulo vazio não vira item, mas isso não se prende aqui: a página do
   cliente já não manda capítulo sem foto, e `testar-secoes.mjs` prende esse
   lado. Uma etapa aqui passaria mesmo com o menu errado. */

await etapa("com UM capítulo só, não há pasta a escolher", async () => {
  /* Uma pasta que é a galeria inteira oferece a mesma coisa duas vezes. */
  await db.query("update medias set secao_id = $2 where galeria_id = $1", [g.id, capA.id]);
  try {
    const m = await menuBaixar();
    if (/Cerimônia/.test(m)) throw new Error("ofereceu a pasta única ao lado do baixar tudo");
    if (!/Todas as fotos num zip \(4\)/.test(m)) throw new Error("e ainda perdeu o baixar tudo");
    return "só o baixar tudo";
  } finally {
    await db.query("update medias set secao_id = null where galeria_id = $1", [g.id]);
    await db.query("delete from secoes where galeria_id = $1", [g.id]);
  }
});

console.log("\nA galeria que não coube inteira:\n");

/*
 * O outro lado da mesma mentira. Corrigir só o registro deixaria a Atividade
 * honesta e a TELA mentindo: o menu continuaria oferecendo "Todas as fotos
 * (600)" numa galeria de 2.108 — e o cliente fecharia a aba achando que levou
 * tudo, que é pior do que o número errado no painel do fotógrafo.
 */
const grande = await galeriaDaRodada(db, {
  nome: "fatiada",
  medias: FOTOS_POR_TELA + 1,
  publicada: true,
});
await db.query(
  "update galerias set senha_hash = null, permite_download = true where id = $1",
  [grande.id],
);

const menuDaGrande = async () => {
  const html = await (
    await fetch(`${BASE}/g/${grande.tslug}/${grande.gslug}`, { cache: "no-store" })
  ).text();
  const barra = html.match(/<nav[^>]*aria-label="Menu da galeria"[^]*?<\/nav>/)?.[0] ?? "";
  if (!barra) throw new Error("não achei a barra de menus");
  const menu = barra.match(/<details[^]*?<summary[^>]*>[^]*?Baixar[^]*?<\/details>/)?.[0];
  if (!menu) throw new Error("não achei o menu Baixar");
  return menu;
};

/*
 * Desde 16/09/2026 o "todas" do computador é um zip montado no SERVIDOR com a
 * galeria inteira, não com a fatia da tela. A mentira que esta seção prende
 * continua a mesma — o número tem de ser o que chega —, só que agora o número
 * certo é o da galeria. Um item que ainda contasse a fatia diria "(600)" e cai
 * aqui.
 */
await etapa("no computador, “todas” conta a galeria inteira, não o pedaço da tela", async () => {
  const m = await menuDaGrande();
  const item = m.match(/Todas as fotos[^<]*/)?.[0];
  if (!item) throw new Error("a galeria grande perdeu o baixar tudo");
  if (!item.includes(`(${FOTOS_POR_TELA + 1})`)) {
    throw new Error(`a galeria tem ${FOTOS_POR_TELA + 1} fotos e o item diz "${item}"`);
  }
  return item;
});

await etapa("e não manda baixar pasta por pasta quem leva tudo num zip", async () => {
  /* O rodapé "baixe pasta por pasta para levar tudo" era o caminho do resto
     quando o download saía da tela. No computador ele virou conselho errado:
     faria a noiva baixar 12 zips em vez de um. No celular continua valendo. */
  const m = await menuDaGrande();
  if (/pasta por pasta/.test(m)) throw new Error("o rodapé ainda manda baixar pasta por pasta");
  return "um zip leva tudo";
});

/*
 * ── NO CELULAR, O MESMO NÚMERO (16/09/2026) ───────────────────────────────
 *
 * Até aqui "Salvar as N fotos no celular" levava `itens` — a fatia. Numa
 * galeria de 601 o botão dizia 600 e entregava 600, e o rodapé mandava salvar
 * pasta por pasta. Agora a lista vem inteira do servidor, e o número do botão é
 * o da galeria. O palpite pelo user-agent é o que desenha a primeira pintura,
 * então dá para conferir pelo HTML.
 */
const menuComo = async (ua) => {
  const html = await (
    await fetch(`${BASE}/g/${grande.tslug}/${grande.gslug}`, {
      cache: "no-store",
      headers: { "user-agent": ua },
    })
  ).text();
  const barra = html.match(/<nav[^>]*aria-label="Menu da galeria"[^]*?<\/nav>/)?.[0] ?? "";
  return barra.match(/<details[^]*?<summary[^>]*>[^]*?Baixar[^]*?<\/details>/)?.[0] ?? "";
};
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

await etapa("no iPhone, “salvar” conta a galeria inteira", async () => {
  const m = await menuComo(IPHONE);
  const item = m.match(/Salvar as \d+ fotos no celular/)?.[0];
  if (item !== `Salvar as ${FOTOS_POR_TELA + 1} fotos no celular`) {
    throw new Error(`o item do iPhone diz "${item ?? "nada"}"`);
  }
  return item;
});

await etapa("no Android, BAIXAR — o menu do Android não salva na galeria", async () => {
  const m = await menuComo(ANDROID);
  const item = m.match(/Baixar as \d+ fotos no celular/)?.[0];
  if (item !== `Baixar as ${FOTOS_POR_TELA + 1} fotos no celular`) {
    throw new Error(`o item do Android diz "${item ?? "nada"}"`);
  }
  if (/Salvar as \d+ fotos/.test(m)) throw new Error("o Android ainda oferece o menu de compartilhar");
  return item;
});

await etapa("no celular, a galeria inteira também pode ir para o computador", async () => {
  const m = await menuComo(IPHONE);
  if (!/Baixar tudo no computador/.test(m)) throw new Error("não há o item de mandar para o computador");
  if (/pasta por pasta/.test(m)) throw new Error("o celular ainda manda salvar pasta por pasta");
  return "Baixar tudo no computador";
});

/*
 * ── AS FOTOS QUE A SELFIE ACHOU (revisão de 16/09/2026) ──────────────────
 *
 * Numa galeria fatiada a busca por rosto leva a `?fotos=<ids>`. Quando o
 * "salvar tudo" do celular passou a pedir a galeria inteira ao servidor, o
 * convidado perdeu o jeito de levar só as dele. O menu dessa tela oferece as
 * encontradas antes de tudo.
 */
await etapa("na tela da busca por rosto, o menu oferece só as encontradas", async () => {
  const { rows } = await db.query(
    "select id from medias where galeria_id = $1 order by ordem limit 2",
    [grande.id],
  );
  const consulta = `?fotos=${rows.map((r) => r.id).join(",")}`;
  const pagina = async (ua) => {
    const html = await (
      await fetch(`${BASE}/g/${grande.tslug}/${grande.gslug}${consulta}`, {
        cache: "no-store",
        headers: { "user-agent": ua },
      })
    ).text();
    return html.match(/<nav[^>]*aria-label="Menu da galeria"[^]*?<\/nav>/)?.[0] ?? "";
  };
  const iphone = await pagina(IPHONE);
  if (!/Salvar estas 2 fotos no celular/.test(iphone)) {
    throw new Error("o iPhone não oferece “Salvar estas 2 fotos”");
  }
  const pc = await pagina(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  );
  if (!/Baixar estas 2 fotos num zip/.test(pc)) {
    throw new Error("o computador não oferece “Baixar estas 2 fotos num zip”");
  }
  return "celular e computador";
});

await etapa("e diz quantas a galeria tem de verdade", async () => {
  /* Sem o número real, "esta parte" é honesto e inútil: a pessoa não sabe se
     falta uma foto ou mil, nem que existe outro caminho para o resto. */
  const m = await menuDaGrande();
  const total = String(FOTOS_POR_TELA + 1);
  if (!m.includes(total)) {
    throw new Error(`o menu não diz em lugar nenhum que a galeria tem ${total} fotos`);
  }
  return `${total} ditas`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o download por pasta tem problema" : "\n✓ download por pasta ok");
process.exit(falhou ? 1 : 0);
