#!/usr/bin/env node
/**
 * O endereço (slug) da GALERIA, e quando ele pode mudar. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-endereco-galeria.mjs
 *
 * ── O PEDIDO, E A REGRA QUE ELE ESBARRA (05/09/2026) ──────────────────────
 *
 * Juan: "to tentando trocar o url e não consigo, clico e a área não é
 * clicável" e, olhando o link que saiu, "o link não gostei porque não consegui
 * arrumar o 2" — a galeria dele nasceu `paula-bruno-2` porque ele já tinha
 * criado uma `paula-bruno` por engano.
 *
 * O campo era travado de propósito, e a razão é boa: o endereço vai para o
 * WhatsApp do casal e é repassado para a família inteira. Renomear a galeria
 * não pode transformar um link em circulação numa página de erro. Para o
 * ESTÚDIO isso foi resolvido com apelido (migração 025); para a galeria não há
 * tabela de apelido, então a saída é outra.
 *
 * ── A PRIMEIRA RESPOSTA, E POR QUE ELA NÃO BASTOU ─────────────────────────
 *
 * A troca começou permitida só enquanto a galeria não tivesse sido publicada
 * nem aberta por ninguém. Era seguro e era metade: quem errou o endereço e só
 * percebeu depois de entregar continuava preso a ele — exatamente o caso de
 * quem manda o link e ouve do casal "que 2 é esse?".
 *
 * ── A REGRA DE HOJE ───────────────────────────────────────────────────────
 *
 * Troca sempre, e o endereço anterior vira APELIDO: continua abrindo, com
 * redirecionamento permanente para o novo. É o mesmo desenho da migração 025,
 * que resolveu isto para o endereço do estúdio, com uma diferença que este
 * arquivo prende: apelido de galeria é único DENTRO do estúdio, não no mundo.
 * Duas fotógrafas podem ter, cada uma, uma `paula-bruno`.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

exigirBancoDeTeste();

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

const g = await galeriaDaRodada(db, { nome: "endereco", medias: 1, publicada: false });
const cookie = cookieDeSessao(g.tenant_id);

const {
  trocarEnderecoDaGaleria,
  resolverGaleriaDoEstudio,
  apelidosDaGaleria,
  esquecerApelidoDaGaleria,
  LIMITE_TROCAS_GALERIA,
} = await import("../src/lib/endereco-galeria.ts");

const limparApelidos = () =>
  db.query("delete from enderecos_antigos_galeria where galeria_id = $1", [g.id]);
const noAr = (v) => db.query("update galerias set publicada = $2 where id = $1", [g.id, v]);
const slugAgora = async () =>
  (await db.query("select slug from galerias where id = $1", [g.id])).rows[0].slug;

/*
 * ── A BANCADA NASCE PUBLICADA (16/09/2026) ───────────────────────────────
 *
 * Desde hoje o apelido só é guardado quando há link EM CIRCULAÇÃO — ver
 * `jaCirculou` em `lib/endereco-galeria.ts`. Galeria que nunca esteve no ar
 * troca de endereço e o anterior some, porque não há o que proteger.
 *
 * As etapas deste arquivo testam justamente a sobrevivência do apelido, então a
 * bancada tem de estar no ar. A regra nova ganhou etapas próprias no fim.
 */
await noAr(true);

console.log("O endereço da galeria:\n");

await etapa("a troca grava o endereço novo, em formato de endereço", async () => {
  await limparApelidos();
  const r = await trocarEnderecoDaGaleria(g.id, g.tenant_id, "  Paula e Bruno!!  ");
  if (!r.ok) throw new Error(`recusou: ${r.erro}`);
  const { rows } = await db.query("select slug from galerias where id = $1", [g.id]);
  if (rows[0].slug !== "paula-e-bruno") throw new Error(`gravou "${rows[0].slug}"`);
  return rows[0].slug;
});

await etapa("endereço já usado por outra galeria do mesmo estúdio é recusado", async () => {
  const outra = await galeriaDaRodada(db, { nome: "endereco-2", medias: 0, publicada: false });
  const r = await trocarEnderecoDaGaleria(g.id, g.tenant_id, outra.slug);
  if (r.ok) throw new Error("duas galerias do mesmo estúdio ficaram com o mesmo endereço");
  return r.erro;
});


/*
 * ── O QUE FAZ ESTA TROCA SER SEGURA ───────────────────────────────────────
 *
 * As três etapas abaixo são a promessa inteira: o link antigo continua abrindo,
 * ele leva para o novo, e ninguém mais pode tomá-lo. Sem qualquer uma delas, a
 * troca volta a ser o que era antes da 025 — quebrar link entregue.
 */
await etapa("o endereço anterior continua abrindo, e leva para o novo", async () => {
  await limparApelidos();
  await trocarEnderecoDaGaleria(g.id, g.tenant_id, "antes-de-tudo");
  await trocarEnderecoDaGaleria(g.id, g.tenant_id, "depois-de-tudo");

  const achado = await resolverGaleriaDoEstudio(g.tenant_id, "antes-de-tudo");
  if (!achado) throw new Error("o endereço antigo virou 404 — é o defeito que isto evita");
  if (!achado.ehAntigo) throw new Error("resolveu como endereço atual, sem redirecionar");
  if (achado.slugAtual !== "depois-de-tudo") {
    throw new Error(`mandou para "${achado.slugAtual}"`);
  }
  return "antes-de-tudo → depois-de-tudo";
});

await etapa("a CADEIA inteira sobrevive, não só a última troca", async () => {
  /* Uma coluna `slug_anterior` guardaria só a penúltima. O endereço mais
     ANTIGO é justamente o que está nos links mais espalhados. */
  const apelidos = (await apelidosDaGaleria(g.id)).map((a) => a.slug);
  if (!apelidos.includes("antes-de-tudo") || !apelidos.includes("paula-e-bruno")) {
    throw new Error(`guardou só ${JSON.stringify(apelidos)}`);
  }
  return apelidos.join(", ");
});

await etapa("apelido de galeria vale DENTRO do estúdio, não no mundo", async () => {
  /* Endereço de galeria mora em /g/<estudio>/<galeria>: duas fotógrafas podem
     ter, cada uma, uma "paula-bruno" sem conflito nenhum. Fazer o apelido
     global inventaria uma escassez que o endereço não tem. */
  const { rows: t } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status)
          values ($1, 'Outra', $2, 'x', $3, 'ativo') returning id`,
    [`outra-${g.id.slice(0, 8)}`, `outra-${g.id.slice(0, 8)}@teste.local`, String(1024 ** 4)],
  );
  const { rows: gv } = await db.query(
    `insert into galerias (tenant_id, slug, titulo, publicada, estado)
          values ($1, 'qualquer-coisa', 'Da outra', false, 'online') returning id`,
    [t[0].id],
  );
  try {
    const r = await trocarEnderecoDaGaleria(gv[0].id, t[0].id, "antes-de-tudo");
    if (!r.ok) throw new Error(`recusou o mesmo apelido em outro estúdio: ${r.erro}`);
    /* E cada um continua resolvendo para a SUA galeria. */
    const meu = await resolverGaleriaDoEstudio(g.tenant_id, "antes-de-tudo");
    const dela = await resolverGaleriaDoEstudio(t[0].id, "antes-de-tudo");
    if (meu?.galeriaId !== g.id) throw new Error("o meu apelido passou a apontar para outra");
    if (dela?.galeriaId !== gv[0].id) throw new Error("o dela não resolve");
    return "mesmo apelido, dois estúdios, duas galerias";
  } finally {
    await db.query("delete from galerias where id = $1", [gv[0].id]);
    await db.query("delete from tenants where id = $1", [t[0].id]);
  }
});

await etapa("outra galeria do MESMO estúdio não toma o apelido", async () => {
  /* Este é o vazamento de verdade: se a galeria B pudesse assumir o endereço
     que a galeria A entregou, o link do casal de A passaria a abrir as fotos
     do casamento de B — funcionando, e errado. */
  const outra = await galeriaDaRodada(db, { nome: "endereco-2", medias: 0, publicada: false });
  const r = await trocarEnderecoDaGaleria(outra.id, g.tenant_id, "antes-de-tudo");
  if (r.ok) throw new Error("uma galeria tomou o endereço antigo de outra do mesmo estúdio");
  return r.erro;
});

await etapa("retomar o próprio apelido é permitido", async () => {
  /* Quem trocou por engano precisa poder voltar. O apelido é dela; recusar
     seria prendê-la no endereço novo pelo mesmo motivo que a prendia no
     antigo. */
  const r = await trocarEnderecoDaGaleria(g.id, g.tenant_id, "antes-de-tudo");
  if (!r.ok) throw new Error(`recusou o próprio apelido: ${r.erro}`);
  if ((await slugAgora()) !== "antes-de-tudo") throw new Error("não voltou");
  return "voltou para antes-de-tudo";
});

await etapa("passar do limite de trocas é recusado, com o número no texto", async () => {
  await limparApelidos();
  for (let i = 0; i < LIMITE_TROCAS_GALERIA; i++) {
    const r = await trocarEnderecoDaGaleria(g.id, g.tenant_id, `troca-${i}`);
    if (!r.ok) throw new Error(`a troca ${i + 1} de ${LIMITE_TROCAS_GALERIA} falhou: ${r.erro}`);
  }
  const excedente = await trocarEnderecoDaGaleria(g.id, g.tenant_id, "uma-a-mais");
  if (excedente.ok) throw new Error("passou do limite sem reclamar");
  if (!excedente.erro.includes(String(LIMITE_TROCAS_GALERIA))) {
    throw new Error(`o texto não diz o limite: "${excedente.erro}"`);
  }
  return excedente.erro;
});

await etapa("galeria publicada TAMBÉM pode trocar — é o caso do pedido", async () => {
  await limparApelidos();
  const antes = await slugAgora();
  const r = await trocarEnderecoDaGaleria(g.id, g.tenant_id, "ja-entregue");
  if (!r.ok) throw new Error(`recusou: ${r.erro}`);
  const achado = await resolverGaleriaDoEstudio(g.tenant_id, antes);
  if (achado?.slugAtual !== "ja-entregue") {
    throw new Error("o link entregue antes da troca não leva para o endereço novo");
  }
  return "trocou, e o link antigo continua abrindo";
});

await etapa("galeria de outro estúdio não é alcançada pelo id", async () => {
  const { rows: t } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status)
          values ($1, 'Vizinho', $2, 'x', $3, 'ativo') returning id`,
    [`viz-end-${g.id.slice(0, 8)}`, `viz-end-${g.id.slice(0, 8)}@teste.local`, String(1024 ** 4)],
  );
  const { rows: gv } = await db.query(
    `insert into galerias (tenant_id, slug, titulo, publicada, estado)
          values ($1, $2, 'Do vizinho', false, 'online') returning id, slug`,
    [t[0].id, `viz-end-${g.id.slice(0, 8)}`],
  );
  try {
    const r = await trocarEnderecoDaGaleria(gv[0].id, g.tenant_id, "roubado");
    const { rows } = await db.query("select slug from galerias where id = $1", [gv[0].id]);
    if (r.ok || rows[0].slug !== gv[0].slug) {
      throw new Error("trocou o endereço da galeria de outro estúdio");
    }
    return "não encontrada";
  } finally {
    await db.query("delete from galerias where id = $1", [gv[0].id]);
    await db.query("delete from tenants where id = $1", [t[0].id]);
  }
});

/*
 * ── O APELIDO SÓ PROTEGE QUEM TEM O QUE PROTEGER (16/09/2026) ────────────
 *
 * Felipe: "quando alterar o endereço da galeria, apagar o antigo".
 *
 * O apelido nasceu para um risco real — o link vai para o WhatsApp do casal e é
 * repassado para a família — e continua valendo ali. Só que ele era criado
 * SEMPRE, inclusive na galeria que nunca foi publicada, onde não existe link
 * nenhum em circulação. Ali ele não protegia nada: ocupava o endereço, gastava
 * uma das três trocas e ainda aparecia na tela dizendo "também continua
 * abrindo". É exatamente o caso do `paula-bruno-2` que originou o recurso —
 * galeria criada por engano, corrigida antes de qualquer entrega.
 */
console.log("\nO endereço antigo que não precisa existir:\n");

await etapa("galeria que nunca foi publicada NÃO deixa apelido para trás", async () => {
  const nova = await galeriaDaRodada(db, { nome: "endereco-3", medias: 0, publicada: false });
  const antes = nova.slug;
  const r = await trocarEnderecoDaGaleria(nova.id, nova.tenant_id, "endereco-corrigido");
  if (!r.ok) throw new Error(`recusou: ${r.erro}`);

  const sobrou = await apelidosDaGaleria(nova.id);
  if (sobrou.length > 0) {
    throw new Error(`guardou ${JSON.stringify(sobrou.map((a) => a.slug))} sem ninguém ter o link`);
  }
  const achado = await resolverGaleriaDoEstudio(nova.tenant_id, antes);
  if (achado) throw new Error("o endereço anterior continua abrindo uma galeria nunca entregue");
  return "o anterior deixou de existir";
});

await etapa("a partir da SEGUNDA troca, o anterior é guardado", async () => {
  /* A primeira troca não deixou rastro, mas a segunda sim: a existência de um
     apelido é ela própria sinal de que a galeria já andou por aí. É o que
     impede a regra de apagar um endereço que já foi divulgado por outro
     caminho que não a publicação. */
  const nova = await galeriaDaRodada(db, { nome: "endereco-3", medias: 0, publicada: false });
  await db.query(
    "insert into enderecos_antigos_galeria (tenant_id, slug, galeria_id) values ($1,$2,$3) on conflict do nothing",
    [nova.tenant_id, `rastro-${nova.id.slice(0, 8)}`, nova.id],
  );
  const antes = (await db.query("select slug from galerias where id = $1", [nova.id])).rows[0].slug;
  const r = await trocarEnderecoDaGaleria(nova.id, nova.tenant_id, "com-rastro-anterior");
  if (!r.ok) throw new Error(`recusou: ${r.erro}`);
  const achado = await resolverGaleriaDoEstudio(nova.tenant_id, antes);
  if (achado?.slugAtual !== "com-rastro-anterior") {
    throw new Error("com rastro anterior, o endereço de saída deveria ter sido guardado");
  }
  return "guardado";
});

await etapa("apagar um endereço antigo faz ele parar de abrir", async () => {
  /* O caso oposto ao do typo: o link foi entregue, vazou, e trocar o endereço
     era justamente para revogá-lo. Enquanto o anterior continuasse abrindo, a
     troca não revogava nada. */
  await limparApelidos();
  const antes = await slugAgora();
  await trocarEnderecoDaGaleria(g.id, g.tenant_id, "endereco-para-revogar");
  if (!(await resolverGaleriaDoEstudio(g.tenant_id, antes))) {
    throw new Error("o apelido nem chegou a existir");
  }

  const r = await esquecerApelidoDaGaleria(g.id, g.tenant_id, antes);
  if (!r.ok) throw new Error("não apagou");
  if (await resolverGaleriaDoEstudio(g.tenant_id, antes)) {
    throw new Error("apagou e o endereço continua abrindo");
  }
  return `/${antes} parou de abrir`;
});

await etapa("apagar apelido de OUTRO estúdio não acontece", async () => {
  const outro = await galeriaDaRodada(db, { nome: "endereco-2", medias: 0, publicada: false });
  await db.query(
    "insert into enderecos_antigos_galeria (tenant_id, slug, galeria_id) values ($1,$2,$3) on conflict do nothing",
    [outro.tenant_id, "nao-e-meu", outro.id],
  );
  /* Mesmo estúdio na bancada, então o que separa é o `galeria_id`: apagar
     pedindo pela galeria errada não pode alcançar a linha da outra. */
  const r = await esquecerApelidoDaGaleria(g.id, g.tenant_id, "nao-e-meu");
  if (r.ok) throw new Error("apagou o apelido de outra galeria");
  const ainda = await resolverGaleriaDoEstudio(outro.tenant_id, "nao-e-meu");
  if (!ainda) throw new Error("o apelido da outra galeria sumiu mesmo assim");
  return "recusado";
});

console.log("\nNo link do cliente:\n");

await etapa("o link antigo redireciona para o novo, com 301", async () => {
  /* A prova que interessa não é a função — é o navegador do convidado. Se esta
     etapa cair, tudo acima continua verde e o link do casal continua morto. */
  await limparApelidos();
  await noAr(true);
  await db.query("update galerias set senha_hash = null where id = $1", [g.id]);
  const antes = await slugAgora();
  const r = await trocarEnderecoDaGaleria(g.id, g.tenant_id, "endereco-de-hoje");
  if (!r.ok) throw new Error(`a troca falhou: ${r.erro}`);

  const resposta = await fetch(`${BASE}/g/${g.tslug}/${antes}`, {
    redirect: "manual",
    cache: "no-store",
  });
  if (resposta.status !== 308 && resposta.status !== 301) {
    throw new Error(`o endereço antigo devolveu HTTP ${resposta.status}, não um redirecionamento`);
  }
  const destino = resposta.headers.get("location") ?? "";
  if (!destino.endsWith(`/g/${g.tslug}/endereco-de-hoje`)) {
    throw new Error(`redirecionou para "${destino}"`);
  }
  await noAr(false);
  return `${resposta.status} → ${destino}`;
});

await etapa("endereço que nunca existiu continua sendo 404", async () => {
  const r = await fetch(`${BASE}/g/${g.tslug}/isso-nunca-existiu`, {
    redirect: "manual",
    cache: "no-store",
  });
  if (r.status !== 404) throw new Error(`devolveu HTTP ${r.status}`);
  return "404";
});

console.log("\nNa tela de entrega:\n");

await etapa("a aba Entrega oferece a troca, publicada ou não", async () => {
  await noAr(true);
  const html = await (
    await fetch(`${BASE}/painel/galerias/${g.id}/entrega`, { headers: { cookie } })
  ).text();
  if (!/Endereço da galeria/.test(html)) {
    throw new Error("a aba não mostra o endereço da galeria para editar");
  }
  if (!/name="slug"/.test(html)) {
    throw new Error("mostra o endereço mas não deixa editar");
  }
  await noAr(false);
  return "campo editável mesmo com a galeria no ar";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o endereço da galeria tem problema" : "\n✓ endereço da galeria ok");
process.exit(falhou ? 1 : 0);
