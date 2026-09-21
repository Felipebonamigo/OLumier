#!/usr/bin/env node
/**
 * A PASTA MAIOR QUE UMA TELA — nenhuma foto fica inalcançável. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-parte-do-capitulo.mjs
 *
 * ── O BURACO QUE ESTE ARQUIVO GUARDA (11/09/2026) ──────────────────────────
 *
 * O corte por fatia serve UM capítulo por tela, com teto de `FOTOS_POR_TELA`, e
 * o teto vale dentro do capítulo. Numa pasta "Festa" de 800 fotos, da 601ª em
 * diante não havia como VER — nem no computador nem no celular. Numa galeria de
 * 2000 fotos sem capítulo nenhum, 1400 simplesmente não existiam na tela.
 *
 * ── O MECANISMO MUDOU, A GARANTIA NÃO (16/09/2026) ─────────────────────────
 *
 * A primeira resposta foi paginar: "parte 3 de 4". Durou cinco dias. Felipe:
 * "remover paginação dentro do mesmo capítulo, tem apenas que rolar até o
 * final" — cada pastilha era um link para outro documento, e clicar recarregava
 * a página e jogava a rolagem para o topo, no meio de uma escolha de álbum.
 *
 * Hoje o resto chega rolando (`api/g/[id]/mais`). Este arquivo foi reescrito
 * junto, e de propósito continua se chamando o que se chamava: o que ele guarda
 * é a GARANTIA — a pasta grande não esconde foto —, não o mecanismo do dia.
 * `testar-rolagem-infinita.mjs` cuida das propriedades da rolagem; aqui o caso é
 * o CAPÍTULO maior que a tela, que é onde o buraco apareceu.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { FOTOS_POR_TELA, fatiarGaleria } from "../src/config/fatia-galeria.ts";
import { enderecoNaGaleria } from "../src/lib/endereco-na-galeria.ts";

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

console.log("O corte, sem servidor\n");

const fotos = (n, secao_id = null) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, secao_id }));

await etapa("a tela serve o teto e DIZ quantas ficaram para trás", () => {
  /* `restantes` é o que a rolagem usa para saber se ainda há o que buscar.
     Zerado por engano, a galeria pararia na 600ª sem avisar ninguém. */
  const festa = fotos(FOTOS_POR_TELA * 2 + 1, "festa");
  const r = fatiarGaleria(festa, "festa");
  if (r.itens.length !== FOTOS_POR_TELA) throw new Error(`serviu ${r.itens.length}`);
  if (r.restantes !== FOTOS_POR_TELA + 1) throw new Error(`disse que restam ${r.restantes}`);
  if (!r.fatiada) throw new Error("não se declarou fatiada");
  return `${r.itens.length} na tela, ${r.restantes} para rolar`;
});

await etapa("o corte é DENTRO do capítulo, não na galeria", () => {
  /* O bug original: cortar a galeria inteira em 600 fazia a Festa, que vem
     depois, não aparecer nunca — mesmo tendo 10 fotos. */
  const medias = [...fotos(FOTOS_POR_TELA, "making"), ...fotos(10, "festa")];
  const r = fatiarGaleria(medias, "festa");
  if (r.itens.length !== 10) throw new Error(`a Festa veio com ${r.itens.length}`);
  if (r.restantes !== 0) throw new Error(`disse que restam ${r.restantes} numa pasta de 10`);
  return "10 de 10";
});

await etapa("galeria que cabe inteira não é fatiada", () => {
  const r = fatiarGaleria(fotos(10));
  if (r.fatiada) throw new Error("fatiou uma galeria de 10 fotos");
  if (r.itens.length !== 10 || r.restantes !== 0) throw new Error(JSON.stringify(r));
});

/*
 * O endereço de uma pastilha mexe SÓ no capítulo. A primeira versão montava
 * "?cap=X" do zero e jogava fora o "?previa=1" do dono: no rascunho o capítulo
 * dava 404, e na publicada contava um "abriu" do próprio fotógrafo na Atividade
 * do casal (revisão de 16/09/2026).
 *
 * ── E EM 21/09/2026 O CAPÍTULO VIROU CAMINHO ──────────────────────────────
 *
 * Juan: "se os noivos forem mandar pra alguém, provavelmente vão copiar e
 * enviar. Daí vai ficar esse link cheio de coisa. Olha que feio." O `cap` saiu
 * da consulta e virou pasta; o resto da consulta continua atravessando.
 */
await etapa("o link do capítulo é caminho, guarda a prévia do dono e larga o recorte", () => {
  const base = "/g/sirius/julia-gustavo";
  const e = enderecoNaGaleria(base, "previa=1&fotos=a,b&cap=velho", { cap: "novo" });
  const [caminho, consulta = ""] = e.split("?");
  if (caminho !== `${base}/novo`) throw new Error(`caminho errado: ${e}`);
  const p = new URLSearchParams(consulta);
  if (p.get("previa") !== "1") throw new Error(`perdeu a prévia: ${e}`);
  if (p.has("cap")) throw new Error(`o cap velho ficou na consulta: ${e}`);
  if (p.has("fotos")) throw new Error(`levou o recorte junto: ${e}`);
  return e;
});

await etapa("sair do capítulo volta para o endereço da galeria, sem sobra", () => {
  const base = "/g/sirius/julia-gustavo";
  const e = enderecoNaGaleria(base, "cap=cerimonia", { cap: null });
  if (e !== base) throw new Error(e);
  return e;
});

/*
 * No domínio próprio o visitante vê `/<galeria>` — a forma `/g/<estudio>/…` é
 * interna e o proxy RECUSA servi-la naquele host. Por isso a base vem de fora:
 * montá-la aqui quebraria justamente os estúdios que pagam pelo endereço.
 */
await etapa("a base de fora é respeitada — domínio próprio não vira olumier", () => {
  const e = enderecoNaGaleria("/julia-gustavo", "", { cap: "cerimonia" });
  if (e !== "/julia-gustavo/cerimonia") throw new Error(e);
  return e;
});

console.log("\nNa tela\n");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const g = await galeriaDaRodada(db, { nome: "partes", medias: 0, publicada: true });
  await db.query("update galerias set senha_hash = null where id = $1", [g.id]);
  const {
    rows: [festa],
  } = await db.query(
    "insert into secoes (galeria_id, nome, ordem, slug) values ($1, 'Festa', 0, 'festa') returning id",
    [g.id],
  );
  const quantas = FOTOS_POR_TELA + 40;
  /* Em massa, numa consulta só. `ordem = i` é o que fixa quem é a 601ª. */
  await db.query(
    `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime,
                         bytes, largura, altura, ordem, pronto, secao_id)
     select $1, $2, $3 || lpad(i::text, 5, '0') || '.jpg',
            'festa-' || lpad(i::text, 5, '0') || '.jpg', 'foto', 'image/jpeg', 1000, 1600, 1067, i, true, $4
       from generate_series(0, $5::int - 1) i`,
    [g.id, g.tenant_id, `${g.tenant_id}/${g.id}/parte-`, festa.id, quantas],
  );

  const url = (consulta) => `${BASE}/g/${g.tslug}/${g.gslug}${consulta}`;
  const html = async (consulta) => (await fetch(url(consulta), { cache: "no-store" })).text();
  const nome = (i) => `festa-${String(i).padStart(5, "0")}.jpg`;

  await etapa(`a primeira tela da pasta mostra as ${FOTOS_POR_TELA} primeiras`, async () => {
    const h = await html("?cap=festa");
    if (!h.includes(nome(0))) throw new Error("a primeira foto não apareceu");
    if (!h.includes(nome(FOTOS_POR_TELA - 1))) throw new Error(`a ${FOTOS_POR_TELA}ª não apareceu`);
    if (h.includes(nome(FOTOS_POR_TELA))) throw new Error("veio além do teto no documento");
    return `até a ${FOTOS_POR_TELA}ª`;
  });

  await etapa("a paginação não voltou", async () => {
    const h = await html("?cap=festa");
    if (/parte \d+ de \d+/i.test(h)) throw new Error('"parte N de N" de volta');
    if (/próxima parte/i.test(h)) throw new Error('"próxima parte" de volta');
    return "sem pastilhas de parte";
  });

  /*
   * O PONTO DESTE ARQUIVO: a 601ª foto da Festa tem de ser alcançável. Antes
   * de 11/09 não era; entre 11/09 e 16/09 era por um link; hoje é rolando.
   */
  await etapa(`a ${FOTOS_POR_TELA + 1}ª foto da pasta é alcançável rolando`, async () => {
    const r = await fetch(`${BASE}/api/g/${g.id}/mais?cap=festa&desde=${FOTOS_POR_TELA}`, {
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const nomes = d.fotos.map((f) => f.nome);
    if (!nomes.includes(nome(FOTOS_POR_TELA))) {
      throw new Error(`o pedaço seguinte começa em ${nomes[0]}`);
    }
    if (!nomes.includes(nome(quantas - 1))) throw new Error("a última da pasta não veio");
    if (d.restantes !== 0) throw new Error(`sobraram ${d.restantes} sem tela`);
    return `da ${FOTOS_POR_TELA + 1}ª à ${quantas}ª, em um pedido`;
  });

  await etapa("a rolagem fica DENTRO da pasta aberta", async () => {
    /* Um recorte diferente aqui traria fotos de outro capítulo no meio do que a
       pessoa está lendo — e numa galeria com "sem capítulo" antes da Festa,
       traria as soltas de volta. */
    const soltas = 5;
    await db.query(
      `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime,
                           bytes, largura, altura, ordem, pronto)
       select $1, $2, $3 || i::text || '.jpg', 'solta-' || i::text || '.jpg',
              'foto', 'image/jpeg', 1000, 1600, 1067, 9000 + i, true
         from generate_series(0, $4::int - 1) i`,
      [g.id, g.tenant_id, `${g.tenant_id}/${g.id}/solta-`, soltas],
    );
    const d = await (
      await fetch(`${BASE}/api/g/${g.id}/mais?cap=festa&desde=${FOTOS_POR_TELA}`, {
        cache: "no-store",
      })
    ).json();
    const intrusas = d.fotos.filter((f) => f.nome.startsWith("solta-"));
    if (intrusas.length) throw new Error(`${intrusas.length} foto(s) de fora da pasta`);
    return "só fotos da Festa";
  });

  await etapa("o apelido do capítulo vale no pedido, não só o id", async () => {
    /* A barra escreve `?cap=festa` desde a migração 034; se a rota só aceitasse
       o id, a rolagem pararia na primeira tela de todo capítulo. */
    const porApelido = await (
      await fetch(`${BASE}/api/g/${g.id}/mais?cap=festa&desde=${FOTOS_POR_TELA}`, {
        cache: "no-store",
      })
    ).json();
    const porId = await (
      await fetch(`${BASE}/api/g/${g.id}/mais?cap=${festa.id}&desde=${FOTOS_POR_TELA}`, {
        cache: "no-store",
      })
    ).json();
    if (porApelido.fotos.length !== porId.fotos.length) {
      throw new Error(`apelido trouxe ${porApelido.fotos.length}, id trouxe ${porId.fotos.length}`);
    }
    if (porApelido.fotos.length === 0) throw new Error("os dois vieram vazios");
    return `${porApelido.fotos.length} fotos pelos dois caminhos`;
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ a pasta grande ainda esconde fotos" : "\n✓ a pasta grande mostra tudo");
process.exit(falhou ? 1 : 0);
