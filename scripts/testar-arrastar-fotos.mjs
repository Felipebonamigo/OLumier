#!/usr/bin/env node
/**
 * ARRASTAR UMA FOTO PARA OUTRA POSIÇÃO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-arrastar-fotos.mjs
 *
 * ── O PEDIDO (28/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe: "adicionar opção de 'arrastar' as fotos na sessão fotos. Pois, quero
 * adicionar as fotos analógicas que fiz no 'local' certo, na ordem cronológica
 * e não consigo arrastar".
 *
 * A ordem da galeria é a narrativa do casamento — o repositório já brigou três
 * vezes por ela (migrações 038 e o lote de 23/09). Mas ela só podia ser
 * decidida NO ENVIO: quem revela um filme depois, ou recebe uma foto do segundo
 * fotógrafo na semana seguinte, não tinha como encaixá-la no meio. Sobrava
 * reenviar a galeria inteira na ordem nova.
 *
 * ── A ARITMÉTICA, QUE É ONDE ISSO COSTUMA QUEBRAR ─────────────────────────
 *
 * Mover é "tirar da posição de origem e enfiar na do alvo" — o mesmo `splice`
 * que a lista de capítulos já usa para arrastar, e o mesmo que a tela calcula
 * enquanto o dedo anda. O servidor TEM de concordar com esse cálculo: se ele
 * decidir outra coisa, o ladrilho aparece num lugar durante o arrasto e pula
 * para outro quando a página recarrega.
 *
 * A consequência de `splice` é que os dois sentidos não são simétricos:
 *
 *   descendo   [0,1,2,3,4] mover 0 para a casa de 3  →  1,2,3,0,4
 *              (a foto cai DEPOIS do alvo: ele subiu uma casa quando ela saiu)
 *   subindo    [0,1,2,3,4] mover 4 para a casa de 1  →  0,4,1,2,3
 *              (a foto cai ANTES do alvo)
 *
 * Trocar os sinais dá uma lista que parece certa no teste de três fotos e
 * embaralha na de trezentas — por isso as etapas abaixo conferem a SEQUÊNCIA
 * inteira, e não só a posição da foto movida.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { moverMediaNaOrdem } from "../src/lib/medias.ts";

await exigirBancoDeTeste();

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

const g = await galeriaDaRodada(db, { nome: "arrastar", medias: 5 });
const tenantId = g.tenant_id;

/** A galeria na ordem em que o cliente a vê, pelo número do nome do arquivo. */
const sequencia = async () => {
  const { rows } = await db.query(
    "select nome_original from medias where galeria_id = $1 order by ordem, criado_em",
    [g.id],
  );
  return rows.map((r) => r.nome_original.match(/-(\d+)\.jpg$/)[1]).join(",");
};

/** Devolve a bancada à ordem de envio entre uma etapa e outra. */
const arrumar = async () => {
  for (const [i, m] of g.midias.entries()) {
    await db.query("update medias set ordem = $2 where id = $1", [m.id, i]);
  }
};

const id = (n) => g.midias[n].id;

await arrumar();

console.log("A ordem de envio:\n");

await etapa("a bancada começa na ordem em que foi enviada", async () => {
  const s = await sequencia();
  if (s !== "0,1,2,3,4") throw new Error(s);
  return s;
});

console.log("\nArrastar:\n");

await etapa("descer: a primeira para a casa da quarta", async () => {
  await arrumar();
  await moverMediaNaOrdem(g.id, tenantId, id(0), id(3));
  const s = await sequencia();
  if (s !== "1,2,3,0,4") throw new Error(`virou ${s}, esperava 1,2,3,0,4`);
  return s;
});

await etapa("subir: a última para a casa da segunda", async () => {
  await arrumar();
  await moverMediaNaOrdem(g.id, tenantId, id(4), id(1));
  const s = await sequencia();
  if (s !== "0,4,1,2,3") throw new Error(`virou ${s}, esperava 0,4,1,2,3`);
  return s;
});

await etapa("vizinhas: trocar duas que já estão lado a lado", async () => {
  await arrumar();
  await moverMediaNaOrdem(g.id, tenantId, id(2), id(1));
  const s = await sequencia();
  if (s !== "0,2,1,3,4") throw new Error(`virou ${s}, esperava 0,2,1,3,4`);
  return s;
});

await etapa("soltar em cima de si mesma não muda nada", async () => {
  await arrumar();
  await moverMediaNaOrdem(g.id, tenantId, id(2), id(2));
  const s = await sequencia();
  if (s !== "0,1,2,3,4") throw new Error(`virou ${s}`);
});

await etapa("nenhuma foto some, e nenhuma se repete", async () => {
  /* O jeito clássico de errar esta conta é duplicar uma posição: a lista
     continua com cinco linhas, mas duas empatam e a ordem passa a depender do
     desempate por data — a mesma classe de defeito das migrações 038 e de
     23/09. */
  await arrumar();
  await moverMediaNaOrdem(g.id, tenantId, id(0), id(4));
  const { rows } = await db.query(
    "select ordem, count(*)::int as n from medias where galeria_id = $1 group by ordem having count(*) > 1",
    [g.id],
  );
  if (rows.length) throw new Error(`${rows.length} posição(ões) empatada(s)`);
  const s = await sequencia();
  if (s.split(",").length !== 5) throw new Error(`sobraram ${s.split(",").length} fotos`);
  return "5 posições distintas";
});

console.log("\nAs travas:\n");

await etapa("com o estúdio errado não move nada", async () => {
  await arrumar();
  const antes = await sequencia();
  await moverMediaNaOrdem(g.id, tenantId === null ? "x" : crypto.randomUUID(), id(0), id(3));
  const depois = await sequencia();
  if (depois !== antes) throw new Error(`mexeu: ${antes} virou ${depois}`);
  return "intocada";
});

await etapa("foto de outra galeria não entra nesta", async () => {
  const vizinha = await galeriaDaRodada(db, { nome: "arrastar-vizinha", medias: 2 });
  await arrumar();
  const antes = await sequencia();
  await moverMediaNaOrdem(g.id, tenantId, vizinha.midias[0].id, id(2));
  const depois = await sequencia();
  if (depois !== antes) throw new Error(`mexeu: ${antes} virou ${depois}`);
  return "intocada";
});

console.log("\nA tela:\n");

await etapa("o ladrilho da grade é arrastável", async () => {
  const { readFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const fonte = readFileSync(
    path.join(path.resolve(import.meta.dirname, ".."), "src/components/grade-medias.tsx"),
    "utf8",
  );
  if (!/draggable/.test(fonte)) throw new Error("nenhum ladrilho é arrastável");
  if (!/onDrop/.test(fonte)) throw new Error("ninguém recebe a foto arrastada");
  /* As setas do capítulo existem porque `draggable` não funciona no toque; aqui
     o equivalente é o "mover para", que continua sendo o caminho de quem está
     no celular. Se ele sumir, arrastar vira a única forma — e no dedo não há
     forma nenhuma. */
  if (!/mover-para/.test(fonte)) {
    throw new Error("o caminho sem arrastar sumiu — no toque não sobraria nada");
  }
  return "arrasta no mouse, menu no toque";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ arrastar fotos tem problema" : "\n✓ arrastar fotos ok");
process.exit(falhou ? 1 : 0);
