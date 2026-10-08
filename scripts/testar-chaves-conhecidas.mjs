#!/usr/bin/env node
/**
 * TUDO O QUE TEM DONO NO BANCO ENTRA NA LISTA DA VARREDURA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-chaves-conhecidas.mjs
 *
 * Não precisa do servidor; só do banco.
 *
 * ── O DEFEITO QUE ISTO PRENDE (achado em 02/10/2026) ──────────────────────
 *
 * `chavesConhecidas` monta a lista do que o banco reconhece como seu, e a
 * varredura apaga do bucket tudo o que NÃO está nela. A lista tinha as mídias
 * e a logo do estúdio — e esquecia a capa enviada como arquivo
 * (`galerias.capa_chave`, migração 029).
 *
 * Quem subiu uma arte de capa tinha, portanto, um arquivo com dono no banco e
 * sem dono na varredura: `varrer-orfaos --apagar` o classificava como órfão e o
 * apagava. A galeria continuava publicada, apontando para um objeto que não
 * existe mais — capa quebrada na entrega de um casamento, e nada no banco
 * dizendo que algo foi perdido.
 *
 * Não foi pego pelos testes que existiam porque o `testar-varredura` é todo de
 * régua (compara banco com bucket sem tocar em nenhum dos dois) e o
 * `testar-limpeza` cobre `destruirGaleria`, que é outro caminho.
 *
 * ── POR QUE O TESTE É ESTE, E NÃO "RODAR A VARREDURA" ─────────────────────
 *
 * Rodar a varredura de verdade contra o bucket compartilhado para provar isto
 * seria pedir para apagar foto de cliente a cada rodada. A lista é a decisão —
 * o que está nela sobrevive, o que falta morre — então é nela que o teste pega.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { chavesConhecidas } from "./varrer-orfaos-regras.mjs";

await exigirBancoDeTeste();

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
};

const g = await galeriaDaRodada(db, { nome: "conhecidas", medias: 2 });

console.log("A lista do que a varredura reconhece:\n");

await etapa("as fotos e as derivadas estão na lista", async () => {
  const { r2, b2 } = await chavesConhecidas(db);
  for (const m of g.midias) {
    if (!r2.has(m.chave) && !b2.has(m.chave)) {
      throw new Error(`a foto ${m.nome_original} não está na lista`);
    }
    if (!r2.has(m.chave.replace(/\.jpg$/, "_thumb.webp"))) {
      throw new Error("a miniatura não está na lista");
    }
  }
  return `${g.midias.length} fotos com derivadas`;
});

await etapa("a VERSÃO LEVE do vídeo está na lista", async () => {
  /* Migração 065: a cópia H.264 que o cliente assiste. Fora da lista, a
     varredura a apagaria e o player voltaria ao original pesado. */
  const leve = g.midias[0].chave.replace(/\.jpg$/, "_leve.mp4");
  await db.query("update medias set chave_reproducao = $1 where id = $2", [leve, g.midias[0].id]);
  const { r2 } = await chavesConhecidas(db);
  if (!r2.has(leve)) throw new Error("a versão leve ficaria órfã");
  return "versão leve reconhecida";
});

await etapa("a CAPA enviada como arquivo está na lista", async () => {
  /* Era o buraco: capa com dono no banco e sem dono na varredura. */
  const capa = `${g.tenant_id}/${g.id}/capa/prova-${Date.now()}.jpg`;
  await db.query("update galerias set capa_chave = $1 where id = $2", [capa, g.id]);
  const { r2 } = await chavesConhecidas(db);
  if (!r2.has(capa)) {
    throw new Error("a capa enviada ficaria órfã — a varredura apagaria o arquivo de uma galeria no ar");
  }
  return "capa reconhecida";
});

await etapa("a capa de PASTA enviada como arquivo está na lista", async () => {
  /* Mesma natureza, mesma armadilha: coluna nova, lista esquecida. */
  const { rows: [s] } = await db.query(
    "insert into secoes (galeria_id,nome,slug,ordem) values ($1,'Festa','festa-conhecidas',0) returning id",
    [g.id],
  );
  const capa = `${g.tenant_id}/${g.id}/capa-pasta/${s.id}/prova-${Date.now()}.jpg`;
  await db.query("update secoes set capa_chave = $1 where id = $2", [capa, s.id]);
  const { r2 } = await chavesConhecidas(db);
  if (!r2.has(capa)) throw new Error("a capa da pasta ficaria órfã");
  return "capa da pasta reconhecida";
});

await etapa("a logo do estúdio está na lista", async () => {
  const logo = `${g.tenant_id}/marca/logo-${Date.now()}.png`;
  await db.query("update tenants set logo_chave = $1 where id = $2", [logo, g.tenant_id]);
  const { r2 } = await chavesConhecidas(db);
  if (!r2.has(logo)) throw new Error("a logo ficaria órfã");
  return "logo reconhecida";
});

await etapa("a FONTE própria do estúdio está na lista", async () => {
  /*
   * A terceira coluna de chave do banco (migração 026), e a que ficou de fora
   * quando as capas entraram: o comentário da rota da fonte dizia que "a
   * varredura já a conhece (ehChaveDeMarca)", e `ehChaveDeMarca` nunca foi
   * importada por script nenhum da varredura — é código morto. O dono da chave É
   * um tenant deste banco, então o guarda de ambiente também não protegia.
   */
  const fonte = `${g.tenant_id}/marca/fonte-${Date.now()}.fonte`;
  await db.query("update tenants set fonte_chave = $1 where id = $2", [fonte, g.tenant_id]);
  const { r2 } = await chavesConhecidas(db);
  if (!r2.has(fonte)) throw new Error("a fonte do estúdio ficaria órfã — a varredura a apagaria");
  return "fonte reconhecida";
});

await etapa("as fotos da PÁGINA INICIAL estão na lista", async () => {
  /* Migração 043: o admin troca as fotos da home pela tela, e elas não pertencem
     a galeria nenhuma. Fora da lista, a varredura levava a capa da página de
     vendas junto com o lixo. */
  const { rows } = await db.query("select lugar, chave, chave_miniatura from fotos_da_home limit 1");
  if (rows.length === 0) return "nenhuma foto de home nesta bancada — pulado";
  const { r2 } = await chavesConhecidas(db);
  if (!r2.has(rows[0].chave)) throw new Error("a foto da home ficaria órfã");
  if (rows[0].chave_miniatura && !r2.has(rows[0].chave_miniatura)) {
    throw new Error("a miniatura da foto da home ficaria órfã");
  }
  return rows[0].lugar;
});

await etapa("TODA coluna de chave do banco está coberta por esta lista", async () => {
  /*
   * A etapa que existe para o PRÓXIMO buraco, não para os já tapados.
   *
   * Três vezes seguidas uma coluna de chave nasceu e ninguém a pôs em
   * `chavesConhecidas` (capa da galeria, capa da pasta, fonte do estúdio). A
   * lista das colunas sai do PRÓPRIO BANCO: coluna nova com nome de chave que
   * este teste não conhece reprova aqui, no dia em que nascer.
   */
  const { rows } = await db.query(`
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
       and (column_name like '%\\_chave' or column_name like 'chave\\_%' or column_name = 'chave')
     order by table_name, column_name`);
  /* `chave_%` entrou em 08/10/2026: o filtro só olhava `%_chave`, e as colunas
     de derivada (`chave_thumb`, `chave_preview`) e a da versão leve
     (`chave_reproducao`, migração 065) passavam por baixo dele — a lista abaixo
     as citava, mas uma QUARTA nasceria sem ninguém notar. */
  const cobertas = new Set([
    "medias.chave",
    "medias.chave_thumb",
    "medias.chave_preview",
    "medias.chave_reproducao",
    "galerias.capa_chave",
    "secoes.capa_chave",
    "tenants.logo_chave",
    "tenants.fonte_chave",
    "fotos_da_home.chave",
    "fotos_da_home.chave_miniatura",
    /* NÃO é chave de bucket: `custos_da_sociedade.chave` é só o identificador da
       semente da migração 047, para ela não duplicar se rodar de novo. Fica
       nomeada aqui para a próxima pessoa não precisar descobrir isso de novo. */
    "custos_da_sociedade.chave",
  ]);
  const faltando = rows
    .map((r) => `${r.table_name}.${r.column_name}`)
    .filter((c) => !cobertas.has(c));
  if (faltando.length > 0) {
    throw new Error(
      `coluna(s) de chave que a varredura talvez não conheça: ${faltando.join(", ")} — ` +
        "ponha em chavesConhecidas e nesta lista, ou a varredura apaga o arquivo",
    );
  }
  return `${cobertas.size} colunas conhecidas`;
});

await etapa("chave que ninguém gravou NÃO entra", async () => {
  /* O contrário da lista também importa: se tudo entrasse, a varredura nunca
     apagaria nada e o bucket cresceria com lixo pago para sempre. */
  const { r2 } = await chavesConhecidas(db);
  if (r2.has(`${g.tenant_id}/${g.id}/nunca-existiu.jpg`)) {
    throw new Error("a lista aceitou uma chave que ninguém gravou");
  }
  return "só o que tem dono";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a lista da varredura tem buraco" : "\n✓ a lista da varredura está completa");
process.exitCode = falhou ? 1 : 0;
