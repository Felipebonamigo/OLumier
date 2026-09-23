#!/usr/bin/env node
/**
 * O endereço (slug) da GALERIA, e o que acontece com o anterior. Uso:
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
 * não pode transformar um link em circulação numa página de erro.
 *
 * ── AS DUAS RESPOSTAS ANTERIORES ──────────────────────────────────────────
 *
 * A troca começou permitida só enquanto a galeria não tivesse sido publicada
 * nem aberta: seguro e pela metade, porque quem errou o endereço e só percebeu
 * depois de entregar continuava preso a ele. Depois, o endereço de saída virou
 * APELIDO (migração 030): continuava abrindo e redirecionava para o novo.
 *
 * ── A REGRA DE HOJE: TROCAR APAGA (16/09/2026) ────────────────────────────
 *
 * Felipe: "quando alterar o endereço da galeria, apagar o antigo" e, perguntado
 * sobre a galeria já entregue, "pode apagar sempre o endereço antigo".
 *
 * Este arquivo prende as duas metades disso. A metade nova: trocar apaga, e
 * apaga TODOS os anteriores, inclusive os que a galeria carregava de trocas
 * feitas antes da regra. A metade velha que ficou de pé: os apelidos gravados
 * antes de hoje continuam abrindo até alguém trocar de endereço ou apertar
 * "apagar" — não se mata de uma vez um link que está na mão de outra pessoa.
 * Como nenhuma troca cria apelido, as etapas que testam essa herança plantam a
 * linha na mão, e isso é a marca de que aquele código é legado que só esvazia.
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
} = await import("../src/lib/endereco-galeria.ts");

const limparApelidos = () =>
  db.query("delete from enderecos_antigos_galeria where galeria_id = $1", [g.id]);
const noAr = (v) => db.query("update galerias set publicada = $2 where id = $1", [g.id, v]);
const slugAgora = async () =>
  (await db.query("select slug from galerias where id = $1", [g.id])).rows[0].slug;

/* Um apelido de ANTES de 16/09/2026. Nenhuma troca cria isto hoje; quem quiser
   testar a herança planta a linha, que é exatamente o ponto. */
const plantarApelido = (slug, galeriaId = g.id, tenantId = g.tenant_id) =>
  db.query(
    "insert into enderecos_antigos_galeria (tenant_id, slug, galeria_id) values ($1,$2,$3) on conflict do nothing",
    [tenantId, slug, galeriaId],
  );

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
 * ── O PEDIDO DO FELIPE, QUE É A REGRA INTEIRA ─────────────────────────────
 *
 * "pode apagar sempre o endereço antigo". As três etapas abaixo são isso: o
 * anterior morre, os anteriores dele também, e morre igual com a galeria no ar
 * — que é o caso em que a consequência dói, e por isso é o que precisa estar
 * escrito num teste e não só num comentário.
 */
console.log("\nTrocar apaga o anterior:\n");

await etapa("o endereço anterior deixa de abrir", async () => {
  await limparApelidos();
  await trocarEnderecoDaGaleria(g.id, g.tenant_id, "antes-de-tudo");
  await trocarEnderecoDaGaleria(g.id, g.tenant_id, "depois-de-tudo");

  if (await resolverGaleriaDoEstudio(g.tenant_id, "antes-de-tudo")) {
    throw new Error("o endereço anterior continua abrindo");
  }
  if ((await apelidosDaGaleria(g.id)).length > 0) throw new Error("guardou apelido");
  return "antes-de-tudo deixou de existir";
});

await etapa("a troca leva junto os apelidos herdados, não só o que está saindo", async () => {
  /* "Trocar o endereço apaga o antigo" não conviveria com um apelido de três
     trocas atrás continuando no ar: a pessoa acabou de ler que o anterior
     morre, e a tela seguiria listando endereços vivos. */
  await limparApelidos();
  await plantarApelido("heranca-um");
  await plantarApelido("heranca-dois");
  const antes = await slugAgora();

  const r = await trocarEnderecoDaGaleria(g.id, g.tenant_id, "endereco-de-agora");
  if (!r.ok) throw new Error(`recusou: ${r.erro}`);

  const sobrou = (await apelidosDaGaleria(g.id)).map((a) => a.slug);
  if (sobrou.length > 0) throw new Error(`sobrou ${JSON.stringify(sobrou)}`);
  for (const morto of [antes, "heranca-um", "heranca-dois"]) {
    if (await resolverGaleriaDoEstudio(g.tenant_id, morto)) {
      throw new Error(`/${morto} continua abrindo`);
    }
  }
  return "três endereços apagados numa troca";
});

await etapa("galeria publicada troca igual, e o link entregue morre", async () => {
  /* É a parte cara do pedido, e está aqui para ninguém descobri-la em
     produção: com a galeria no ar, trocar o endereço mata o link que já está
     no WhatsApp do casal. A tela avisa e pergunta antes — ver
     `components/endereco-da-galeria.tsx`. */
  await limparApelidos();
  await noAr(true);
  const antes = await slugAgora();
  const r = await trocarEnderecoDaGaleria(g.id, g.tenant_id, "ja-entregue");
  if (!r.ok) throw new Error(`recusou: ${r.erro}`);
  if (await resolverGaleriaDoEstudio(g.tenant_id, antes)) {
    throw new Error("o endereço entregue continua abrindo — a troca não revogou nada");
  }
  await noAr(false);
  return `/${antes} parou de abrir`;
});

/*
 * ── O QUE FICOU DAS TROCAS DE ANTES (16/09/2026) ──────────────────────────
 *
 * Nenhuma troca cria apelido desde hoje, mas quem trocou antes carrega os seus,
 * e eles continuam abrindo: apagar todos na subida mataria de uma vez, sem
 * aviso e sem volta, links que hoje funcionam. Estas etapas plantam a linha na
 * mão porque não há mais como fabricá-la pelo produto.
 */
console.log("\nOs apelidos herdados:\n");

await etapa("apelido gravado antes da regra continua abrindo e leva para o novo", async () => {
  await limparApelidos();
  const atual = await slugAgora();
  await plantarApelido("link-antigo-no-whatsapp");

  const achado = await resolverGaleriaDoEstudio(g.tenant_id, "link-antigo-no-whatsapp");
  if (!achado) throw new Error("virou 404 — é o link que ninguém tem como reenviar");
  if (!achado.ehAntigo) throw new Error("resolveu como endereço atual, sem redirecionar");
  if (achado.slugAtual !== atual) throw new Error(`mandou para "${achado.slugAtual}"`);
  return `link-antigo-no-whatsapp → ${atual}`;
});

await etapa("apelido de galeria vale DENTRO do estúdio, não no mundo", async () => {
  /* Endereço de galeria mora em /g/<estudio>/<galeria>: duas fotógrafas podem
     ter, cada uma, uma "paula-bruno" sem conflito nenhum. A chave da 030 é
     (tenant_id, slug) por isso, e é isto que esta etapa prende. */
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
    await plantarApelido("link-antigo-no-whatsapp", gv[0].id, t[0].id);
    const meu = await resolverGaleriaDoEstudio(g.tenant_id, "link-antigo-no-whatsapp");
    const dela = await resolverGaleriaDoEstudio(t[0].id, "link-antigo-no-whatsapp");
    if (meu?.galeriaId !== g.id) throw new Error("o meu apelido passou a apontar para outra");
    if (dela?.galeriaId !== gv[0].id) throw new Error("o dela não resolve");
    return "mesmo apelido, dois estúdios, duas galerias";
  } finally {
    await db.query("delete from galerias where id = $1", [gv[0].id]);
    await db.query("delete from tenants where id = $1", [t[0].id]);
  }
});

await etapa("outra galeria do MESMO estúdio não toma um apelido que ainda abre", async () => {
  /* Este é o vazamento de verdade: se a galeria B pudesse assumir o endereço
     que a galeria A entregou, o link do casal de A passaria a abrir as fotos
     do casamento de B — funcionando, e errado. */
  const outra = await galeriaDaRodada(db, { nome: "endereco-2", medias: 0, publicada: false });
  const r = await trocarEnderecoDaGaleria(outra.id, g.tenant_id, "link-antigo-no-whatsapp");
  if (r.ok) throw new Error("uma galeria tomou o endereço antigo de outra do mesmo estúdio");
  return r.erro;
});

await etapa("retomar um endereço que já foi seu é permitido, e sem laço", async () => {
  /* Quem trocou por engano precisa poder voltar. O apelido é dela; recusar
     seria prendê-la no endereço novo pelo mesmo motivo que a prendia no
     antigo. E a linha antiga tem de sumir: uma que dissesse "este endereço é
     antigo" mandaria o visitante para si mesmo. */
  const r = await trocarEnderecoDaGaleria(g.id, g.tenant_id, "link-antigo-no-whatsapp");
  if (!r.ok) throw new Error(`recusou o próprio apelido: ${r.erro}`);
  if ((await slugAgora()) !== "link-antigo-no-whatsapp") throw new Error("não voltou");
  const achado = await resolverGaleriaDoEstudio(g.tenant_id, "link-antigo-no-whatsapp");
  if (achado?.ehAntigo) throw new Error("o endereço vigente ficou marcado como antigo — laço");
  return "voltou, e sem redirecionar para si mesmo";
});

await etapa("apagar um endereço antigo faz ele parar de abrir", async () => {
  /* Serve agora, sem esperar a próxima troca: quando o link vazou, a pressa é
     essa. */
  await limparApelidos();
  await plantarApelido("endereco-que-vazou");
  if (!(await resolverGaleriaDoEstudio(g.tenant_id, "endereco-que-vazou"))) {
    throw new Error("o apelido nem chegou a existir");
  }

  const r = await esquecerApelidoDaGaleria(g.id, g.tenant_id, "endereco-que-vazou");
  if (!r.ok) throw new Error("não apagou");
  if (await resolverGaleriaDoEstudio(g.tenant_id, "endereco-que-vazou")) {
    throw new Error("apagou e o endereço continua abrindo");
  }
  return "/endereco-que-vazou parou de abrir";
});

await etapa("apagar apelido de OUTRA galeria não acontece", async () => {
  const outro = await galeriaDaRodada(db, { nome: "endereco-2", medias: 0, publicada: false });
  await plantarApelido("nao-e-meu", outro.id, outro.tenant_id);
  /* Mesmo estúdio na bancada, então o que separa é o `galeria_id`: apagar
     pedindo pela galeria errada não pode alcançar a linha da outra. */
  const r = await esquecerApelidoDaGaleria(g.id, g.tenant_id, "nao-e-meu");
  if (r.ok) throw new Error("apagou o apelido de outra galeria");
  const ainda = await resolverGaleriaDoEstudio(outro.tenant_id, "nao-e-meu");
  if (!ainda) throw new Error("o apelido da outra galeria sumiu mesmo assim");
  return "recusado";
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

console.log("\nNo link do cliente:\n");

await etapa("o endereço trocado hoje devolve 404 no navegador", async () => {
  /* A prova que interessa não é a função — é o navegador de quem tem o link.
     Esta etapa é a consequência do pedido, vista de fora. */
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
  if (resposta.status !== 404) {
    throw new Error(`o endereço trocado devolveu HTTP ${resposta.status}, não 404`);
  }
  return `/${antes} → 404`;
});

await etapa("o apelido herdado ainda redireciona, com 301", async () => {
  await plantarApelido("entregue-mes-passado");
  const resposta = await fetch(`${BASE}/g/${g.tslug}/entregue-mes-passado`, {
    redirect: "manual",
    cache: "no-store",
  });
  if (resposta.status !== 308 && resposta.status !== 301) {
    throw new Error(`o apelido herdado devolveu HTTP ${resposta.status}, não um redirecionamento`);
  }
  const destino = resposta.headers.get("location") ?? "";
  if (!destino.endsWith(`/g/${g.tslug}/endereco-de-hoje`)) {
    throw new Error(`redirecionou para "${destino}"`);
  }
  await limparApelidos();
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

await etapa("a tela avisa que trocar apaga o anterior", async () => {
  /* O texto antigo prometia o contrário — "trocar o endereço mantém o anterior
     abrindo". Deixá-lo ali seria pior que nunca ter prometido: a pessoa leria
     uma garantia, apertaria Salvar e mataria o link do casal. */
  const html = await (
    await fetch(`${BASE}/painel/galerias/${g.id}/entrega`, { headers: { cookie } })
  ).text();
  if (/mant[ée]m o\s+anterior abrindo/i.test(html)) {
    throw new Error("a tela ainda promete que o endereço anterior continua abrindo");
  }
  if (!/apaga o anterior/i.test(html)) {
    throw new Error("a tela não diz que trocar apaga o endereço anterior");
  }
  return "o aviso está na tela";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o endereço da galeria tem problema" : "\n✓ endereço da galeria ok");
process.exit(falhou ? 1 : 0);
