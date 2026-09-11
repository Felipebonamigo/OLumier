#!/usr/bin/env node
/**
 * Reordenar capítulos arrastando. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-ordem-capitulos.mjs
 *
 * ── O PEDIDO ──────────────────────────────────────────────────────────────
 *
 * Carol, 11/09/2026: "tem que clicar na flechinha e ir subindo um por um pra
 * organizar, não tem como fazer algo tipo pra segurar e arrastar? Quero subir a
 * pasta da festa lá pra cima, aí teria que ir clicando um por um".
 *
 * Ela tinha razão e o número é fácil: sete capítulos, "Festa" no fim, seis
 * cliques para chegar ao topo — e cada clique é uma ida ao servidor com a
 * página recarregando por baixo.
 *
 * ── O QUE MUDA NO SERVIDOR ────────────────────────────────────────────────
 *
 * `moverSecao` troca com a VIZINHA: é uma operação de um passo, e arrastar não
 * é um passo. Entra `reordenarSecoes`, que recebe a lista inteira na ordem
 * nova e grava de uma vez.
 *
 * A lista vem do NAVEGADOR, então este arquivo passa a maior parte do tempo
 * perguntando o que acontece quando ela vem torta: com id de outro estúdio, com
 * id repetido, com capítulo faltando, vazia. Uma função que recebe "a ordem
 * inteira" é uma função que pode reordenar a galeria de outra pessoa se ninguém
 * conferir de quem é cada id.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

import { reordenarSecoes, listarSecoes, criarSecao } from "../src/lib/secoes.ts";

let falhou = false;
const ok = (m, extra) => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ""}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const g = await galeriaDaRodada(db, { nome: "ordem", medias: 1 });
const tenantId = g.estudio.id;

/** Os nomes na ordem em que estão hoje no banco. */
const nomesAgora = async () => (await listarSecoes(g.id)).map((s) => s.nome);

try {
  console.log("Arrastar capítulo\n");

  const NOMES = ["Making of", "Decoração", "Cerimônia", "Recepção", "Festa"];
  const criadas = [];
  for (const nome of NOMES) criadas.push(await criarSecao(g.id, tenantId, nome));
  const porNome = new Map(criadas.map((s) => [s.nome, s.id]));

  const inicial = await nomesAgora();
  if (inicial.join() === NOMES.join()) ok("nascem na ordem em que foram criados", inicial.join(" · "));
  else erro(`nasceram como ${inicial.join(" · ")}`);

  /* O gesto do pedido: "Festa" do fim para o topo, de uma vez. */
  const nova = ["Festa", "Making of", "Decoração", "Cerimônia", "Recepção"];
  await reordenarSecoes(g.id, tenantId, nova.map((n) => porNome.get(n)));
  const depois = await nomesAgora();
  if (depois.join() === nova.join()) ok("a Festa sobe ao topo num gesto só", depois.join(" · "));
  else erro(`depois de arrastar ficou ${depois.join(" · ")}`);

  /* Arrastar de volta para o meio: a ordem é a que mandaram, não um embaralho. */
  const meio = ["Making of", "Decoração", "Festa", "Cerimônia", "Recepção"];
  await reordenarSecoes(g.id, tenantId, meio.map((n) => porNome.get(n)));
  if ((await nomesAgora()).join() === meio.join()) ok("e desce para o meio do mesmo jeito");
  else erro(`arrastar para o meio deu ${(await nomesAgora()).join(" · ")}`);

  console.log("\nQuando a lista vem torta\n");

  const antesDoTorto = await nomesAgora();

  /* ── A TRAVA QUE IMPORTA ───────────────────────────────────────────────
   * A lista vem do navegador. Sem conferir de quem é cada id, "reordene esta
   * lista" vira "reordene a galeria de quem eu quiser". */
  const outro = { id: null };
  {
    const { rows } = await db.query(
      `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status)
            values ($1, 'Estúdio Vizinho', $2, 'x', 1000000, 'ativo') returning id`,
      [`vizinho-${Date.now()}`, `vizinho-${Date.now()}@exemplo.com`],
    );
    outro.id = rows[0].id;
    const { rows: gal } = await db.query(
      `insert into galerias (tenant_id, slug, titulo, publicada, estado)
            values ($1, $2, 'Do vizinho', false, 'online') returning id`,
      [outro.id, `vizinho-${Date.now()}`],
    );
    const alheia = await criarSecao(gal[0].id, outro.id, "Alheia");

    await reordenarSecoes(g.id, tenantId, [alheia.id, ...antesDoTorto.map((n) => porNome.get(n))]);
    const depoisDoAlheio = await nomesAgora();
    if (depoisDoAlheio.join() === antesDoTorto.join()) {
      ok("id de capítulo de OUTRO estúdio é ignorado, e nada se move");
    } else {
      erro(`o id alheio mexeu na ordem: ${depoisDoAlheio.join(" · ")}`);
    }

    /* E o capítulo do vizinho não pode ter sido tocado. */
    const doVizinho = await listarSecoes(gal[0].id);
    if (doVizinho.length === 1 && doVizinho[0].nome === "Alheia") {
      ok("e o capítulo do vizinho continua de pé");
    } else {
      erro("o capítulo do vizinho foi alterado");
    }
  }

  /* Lista faltando capítulos: quem ficou de fora não pode sumir da tela. */
  await reordenarSecoes(g.id, tenantId, [porNome.get("Recepção"), porNome.get("Cerimônia")]);
  const parcial = await nomesAgora();
  if (parcial.length === NOMES.length && parcial[0] === "Recepção" && parcial[1] === "Cerimônia") {
    ok("lista parcial põe os enviados na frente e mantém o resto", parcial.join(" · "));
  } else {
    erro(`lista parcial deu ${parcial.join(" · ")}`);
  }

  /* Id repetido não pode duplicar nem derrubar. */
  const comRepetido = [porNome.get("Festa"), porNome.get("Festa"), porNome.get("Making of")];
  await reordenarSecoes(g.id, tenantId, comRepetido);
  const semDuplicata = await nomesAgora();
  if (semDuplicata.length === NOMES.length && new Set(semDuplicata).size === NOMES.length) {
    ok("id repetido não duplica capítulo", semDuplicata.join(" · "));
  } else {
    erro(`id repetido deu ${semDuplicata.join(" · ")}`);
  }

  /* Lista vazia e lixo: não é erro, é "não mexe". */
  const antesDoVazio = await nomesAgora();
  await reordenarSecoes(g.id, tenantId, []);
  await reordenarSecoes(g.id, tenantId, ["nao-e-uuid", ""]);
  if ((await nomesAgora()).join() === antesDoVazio.join()) ok("lista vazia ou com lixo não mexe em nada");
  else erro("lista vazia ou com lixo mudou a ordem");

  if (outro.id) await db.query("delete from tenants where id = $1", [outro.id]);
} finally {
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ a ordem dos capítulos tem problema");
  process.exit(1);
}
console.log("\n✓ arrastar capítulo funciona, e a lista torta não passa");
