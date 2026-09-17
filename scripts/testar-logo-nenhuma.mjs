#!/usr/bin/env node
/**
 * A capa sem assinatura nenhuma. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-logo-nenhuma.mjs
 *
 * ── O PEDIDO ──────────────────────────────────────────────────────────────
 *
 * Felipe, 17/09/2026: "ter a opção sem logo" na galeria.
 *
 * Até então a logo aparecia sempre que o ESTÚDIO tivesse uma, e o único jeito
 * de entregar uma capa sem ela era o estúdio não ter logo nenhuma — o que a
 * tirava de TODAS as galerias de uma vez, inclusive das já entregues.
 *
 * ── O QUE "NENHUMA" QUER DIZER, E POR QUE ISSO PRECISA DE TESTE ───────────
 *
 * Tira a ASSINATURA inteira: nem a imagem, nem o nome do estúdio em texto. A
 * capa fica com a foto, o título e a data. Escolhido pelo Felipe entre as duas
 * leituras possíveis, e é a diferença que este arquivo prende — a outra
 * (trocar a logo pelo nome escrito) já é o que acontece com quem não enviou
 * logo, e um dia alguém vai "consertar" uma pela outra.
 *
 * ── E POR QUE ELE PASSA EM TODAS AS CAPAS ────────────────────────────────
 *
 * A assinatura é desenhada em SEIS lugares de `galeria-capa.tsx`, um por
 * variante, e duas delas precisaram de conserto próprio:
 *
 *   convite        o `justify-between` tem dois filhos e é o de cima que
 *                  empurra o texto para o pé. Com um filho só, o texto sobe — a
 *                  capa mudaria de desenho por uma escolha que era só sobre a
 *                  logo.
 *   redonda/arco   a assinatura mora num embrulho com `mt-6`. Vazio, ele deixa
 *                  um vão morto reservado para o que não vem.
 *
 * Eu tinha trocado as duas ao escrever isto, e foi a etapa estrutural aqui
 * embaixo que me disse — procurando o `justify-between` na dividida, onde ele
 * não está. Comentário errado não dói; a etapa que olha a estrutura, sim.
 *
 * Testar só uma variante deixaria as outras cinco livres. Por isso o laço pega
 * a lista de `OPCOES.capa` em vez de nomear as capas à mão: capa nova entra
 * sozinha, e ninguém precisa lembrar de nada.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { OPCOES, APARENCIA_PADRAO, alturaLogoPx } from "../src/config/aparencia.ts";

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

console.log("A capa sem assinatura\n");

await etapa("\"nenhuma\" é escolhível na interface", () => {
  const ids = OPCOES.logo.map((o) => o.id);
  if (!ids.includes("nenhuma")) {
    throw new Error(`o eixo da logo oferece ${ids.join(", ")} — opção que não está aqui ninguém marca`);
  }
  return ids.join(", ");
});

await etapa("nenhuma não tem altura, e o padrão continua o de antes", () => {
  if (alturaLogoPx("nenhuma") !== 0) {
    throw new Error(`alturaLogoPx("nenhuma") devolveu ${alturaLogoPx("nenhuma")}`);
  }
  /*
   * O valor de reserva era `OPCOES.logo[1].px` — o SEGUNDO da lista, que por
   * acaso era o padrão. "Nenhuma" entrando na frente moveria o índice e o
   * tamanho de reserva viraria outro, em silêncio, para toda galeria com
   * aparência incompleta. Esta etapa prende o padrão pelo nome.
   */
  const padrao = OPCOES.logo.find((o) => o.id === APARENCIA_PADRAO.logo);
  if (alturaLogoPx("valor-que-nao-existe") !== padrao.px) {
    throw new Error(
      `a reserva devolveu ${alturaLogoPx("valor-que-nao-existe")}px e o padrão ` +
        `("${APARENCIA_PADRAO.logo}") vale ${padrao.px}px — a lista cresceu e o índice ficou para trás`,
    );
  }
  return `padrão "${APARENCIA_PADRAO.logo}" = ${padrao.px}px`;
});

const g = await galeriaDaRodada(db, { nome: "logo", medias: 3, publicada: true });
await db.query("update galerias set senha_hash = null, capa_media_id = $2 where id = $1", [
  g.id,
  g.midias[0].id,
]);

/* O estúdio PRECISA ter logo, senão a etapa passaria por ausência de arquivo em
   vez de por escolha — verde por não ter o que esconder. */
await db.query("update tenants set logo_chave = $2 where id = $1", [
  g.tenant_id,
  `${g.tenant_id}/marca/logo.png`,
]);

/** O HTML da capa com uma variante e um valor de logo. */
async function capa(nomeDaCapa, valorDaLogo) {
  await db.query(
    `update galerias
        set aparencia = jsonb_set(
              jsonb_set(coalesce(aparencia,'{}'::jsonb), '{capa}', $2::jsonb),
              '{logo}', $3::jsonb)
      where id = $1`,
    [g.id, JSON.stringify(nomeDaCapa), JSON.stringify(valorDaLogo)],
  );
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  return html.match(new RegExp(`<header[^>]*data-capa="${nomeDaCapa}"[^]*?</header>`))?.[0] ?? "";
}

const NOME_DO_ESTUDIO = (await db.query("select nome_estudio from tenants where id = $1", [g.tenant_id]))
  .rows[0].nome_estudio;

try {
  for (const { id: nomeDaCapa } of OPCOES.capa) {
    await etapa(`capa ${nomeDaCapa}: com logo assina, sem logo não`, async () => {
      const comLogo = await capa(nomeDaCapa, "media");
      if (!comLogo) throw new Error("não achei o cabeçalho desta capa no HTML");
      /* A âncora é o `alt`, que recebe o nome do estúdio: é assim que a logo
         chega a quem usa leitor de tela, e é o que some junto com ela. */
      if (!comLogo.includes(NOME_DO_ESTUDIO)) {
        throw new Error("com a logo escolhida, a assinatura não apareceu — a etapa ficaria sem objeto");
      }

      const semLogo = await capa(nomeDaCapa, "nenhuma");
      if (!semLogo) throw new Error("não achei o cabeçalho desta capa no HTML");
      if (semLogo.includes(NOME_DO_ESTUDIO)) {
        throw new Error(
          `"nenhuma" deixou a assinatura do estúdio na capa — ela tira a imagem E o nome`,
        );
      }
      return "assinatura só quando pedida";
    });
  }

  /*
   * O vão morto do convite: o embrulho da assinatura tem `mt-6`, e vazio ele
   * reserva 24px para o que não vem. Não dá para ver no texto do HTML sem olhar
   * a estrutura, então a etapa olha.
   */
  await etapa("a capa redonda não deixa vão no lugar da assinatura", async () => {
    const semLogo = await capa("redonda", "nenhuma");
    if (/<div class="mt-6"><\/div>/.test(semLogo.replace(/\s+/g, " "))) {
      throw new Error("sobrou um embrulho vazio com mt-6 — espaço reservado para nada");
    }
    return "sem embrulho órfão";
  });

  /*
   * O convite é o contrário: aqui o lugar da assinatura PRECISA continuar
   * existindo, senão o `justify-between` perde o filho de cima e o texto sobe
   * para o topo da coluna.
   */
  /*
   * ── O QUE ESTA ETAPA MEDE, E O QUE ELA NÃO MEDE ─────────────────────────
   *
   * Ela confere que o ESPAÇO RESERVADO continua no HTML — o primeiro filho da
   * coluna, vazio. Não confere o resultado visual: onde o texto pára dentro da
   * coluna é efeito de CSS, e só um navegador de verdade responderia isso.
   *
   * A primeira versão tentou contar filhos por expressão regular e passava
   * mesmo com o espaço removido: a captura pegava um pedaço maior do HTML e
   * achava quatro "filhos" que não eram filhos dela. Verde por olhar para o
   * lugar errado — conferido removendo o espaço de propósito, que é como isso
   * apareceu. Uma âncora exata e modesta vale mais que uma medida ampla e falsa.
   */
  await etapa("a capa convite guarda o lugar da assinatura", async () => {
    const semLogo = await capa("convite", "nenhuma");
    const coluna = /<div class="[^"]*justify-between[^"]*"[^>]*>(<[a-z]+)/.exec(semLogo);
    if (!coluna) throw new Error("não achei a coluna com justify-between");
    if (!/<div class="[^"]*justify-between[^"]*"[^>]*><span aria-hidden="true"><\/span>/.test(semLogo)) {
      throw new Error(
        `o primeiro filho da coluna virou "${coluna[1]}…": sem o espaço reservado, ` +
          `o justify-between para de empurrar e o texto sobe para o topo`,
      );
    }
    return "o espaço vazio segura o texto no pé";
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ a opção sem logo tem problema\n" : "\n✓ a capa sabe ficar sem assinatura\n");
process.exit(falhou ? 1 : 0);
