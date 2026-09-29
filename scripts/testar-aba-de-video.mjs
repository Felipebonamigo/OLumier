#!/usr/bin/env node
/**
 * A ABA VÍDEO — só existe quando há vídeo, e é onde a capa se escolhe. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-aba-de-video.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (29/09/2026) ─────────────────────────────────────────────────
 *
 * Juan: "podemos adicionar algum sistema de 'vídeo' na aba de menu da galeria,
 * que só aparece quando tem algum vídeo na galeria. Essa configuração de vídeo
 * permite escolher uma capa thumbnail para o vídeo ali. Ou automaticamente
 * definir uma capa."
 *
 * A automática foi consertada antes (o quadro vinha em branco e era gravado
 * assim mesmo). Esta é a manual, e ela é a saída para os casos em que a
 * automática não tem como funcionar: codec que o navegador não decodifica,
 * filme que abre em preto, ou os 41 vídeos de produção que já subiram com capa
 * branca antes do conserto.
 *
 * ── DE ONDE SAI O QUADRO, E POR QUE NÃO DO ARMAZÉM ───────────────────────
 *
 * Do arquivo que o fotógrafo ainda tem no computador. Ler do armazém obrigaria
 * o navegador a BAIXAR o filme — e um vídeo com o índice no fim do arquivo
 * precisa vir inteiro antes de o navegador conseguir buscar um quadro. Do
 * disco, o filme nunca sai da máquina: sobem 50 KB de miniatura.
 *
 * E o mesmo seletor aceita IMAGEM. É isso que dá saída ao codec que o navegador
 * não abre: o fotógrafo escolhe o JPG que ele mesmo exportou. `gerarDerivadas`
 * já sabe fazer as duas coisas — não nasce derivação nova.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, segundoEstudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
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

const g = await galeriaDaRodada(db, { nome: "aba-de-video", medias: 2 });
const cookie = cookieDeSessao(g.tenant_id);
const pegar = (caminho) => fetch(`${BASE}${caminho}`, { headers: { cookie }, cache: "no-store" });

console.log("A aba Vídeo:\n");

await etapa("galeria só de fotos NÃO mostra a aba", async () => {
  const html = await (await pegar(`/painel/galerias/${g.id}/fotos`)).text();
  if (/\/video"/.test(html)) throw new Error("a aba apareceu numa galeria sem vídeo nenhum");
  return "sem aba";
});

/* Um vídeo sem capa: é o estado dos 41 de produção depois do mutirão. */
const base = `${g.tenant_id}/${g.id}`;
const { rows: [video] } = await db.query(
  `insert into medias (galeria_id, tenant_id, chave, nome_original, mime, tipo,
                       bytes, largura, altura, pronto, ordem)
   values ($1,$2,$3,'filme.mp4','video/mp4','video',5000,1920,1080,true,9)
   returning id`,
  [g.id, g.tenant_id, `${base}/filme.mp4`],
);

await etapa("com vídeo, a aba aparece no menu da galeria", async () => {
  const html = await (await pegar(`/painel/galerias/${g.id}/fotos`)).text();
  if (!new RegExp(`/painel/galerias/${g.id}/video`).test(html)) {
    throw new Error("a aba não apareceu depois de entrar um vídeo");
  }
  return "aba presente";
});

await etapa("a aba lista o vídeo e diz que ele está sem capa", async () => {
  const r = await pegar(`/painel/galerias/${g.id}/video`);
  if (!r.ok) throw new Error(`a aba respondeu ${r.status}`);
  const html = await r.text();
  if (!html.includes("filme.mp4")) throw new Error("o vídeo não aparece na lista");
  if (!/sem capa/i.test(html)) throw new Error("não diz que este vídeo está sem capa");
  return "listado";
});

await etapa("a aba não assina o ORIGINAL do filme", async () => {
  /*
   * A divisão em abas nasceu para cada uma pagar só o que é dela
   * (`menu-galeria.tsx`). Uma aba que assinasse o filme inteiro de cada vídeo
   * desfaria isso — e não precisa: aqui só se mostra a capa, e a nova vem do
   * disco do fotógrafo.
   */
  const html = await (await pegar(`/painel/galerias/${g.id}/video`)).text();
  const assinaturas = html.match(/X-Amz-Signature/g) ?? [];
  if (/filme\.mp4\?/.test(html) || /filme\.mp4&/.test(html)) {
    throw new Error("a aba assinou o original do filme");
  }
  return `${assinaturas.length} assinatura(s), nenhuma do filme`;
});

console.log("\nA rota que grava a capa:\n");

const posta = (id, corpo, ck = cookie) =>
  fetch(`${BASE}/api/medias/${id}/poster`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: ck },
    body: JSON.stringify(corpo),
  });

await etapa("sem sessão, recusa", async () => {
  const r = await fetch(`${BASE}/api/medias/${video.id}/poster`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (r.status !== 401) throw new Error(`esperava 401, veio ${r.status}`);
  return "401";
});

await etapa("mídia de OUTRO estúdio não existe para esta sessão", async () => {
  const outro = await segundoEstudioDaRodada(db);
  const r = await posta(video.id, {}, cookieDeSessao(outro.id));
  /* 404 e não 403: confirmar que o id existe já é contar demais. */
  if (r.status !== 404) throw new Error(`esperava 404, veio ${r.status}`);
  return "404";
});

await etapa("FOTO não aceita capa por esta rota", async () => {
  /*
   * A capa de uma foto é a própria foto. Deixar passar abriria um caminho para
   * trocar a miniatura de uma foto por outra imagem qualquer — o casal veria na
   * grade uma coisa e no lightbox outra.
   */
  const { rows: [foto] } = await db.query(
    "select id from medias where galeria_id = $1 and tipo = 'foto' limit 1",
    [g.id],
  );
  const r = await posta(foto.id, {});
  if (r.status !== 400) throw new Error(`esperava 400, veio ${r.status}`);
  return "400";
});

await etapa("vídeo do próprio estúdio recebe a URL de envio", async () => {
  const r = await posta(video.id, {});
  if (!r.ok) throw new Error(`esperava 200, veio ${r.status}`);
  const d = await r.json();
  if (!d.url || !/X-Amz-Signature/.test(d.url)) throw new Error("não veio URL assinada");
  /* A chave é CALCULADA pelo servidor a partir da linha da mídia — o navegador
     não manda chave nenhuma, então não há o que forjar. */
  if (d.chave && !d.chave.startsWith(`${g.tenant_id}/`)) {
    throw new Error(`a chave saiu fora do estúdio: ${d.chave}`);
  }
  return "assinada";
});

await etapa("confirmar sem o arquivo ter chegado NÃO grava a coluna", async () => {
  /*
   * A ordem é a defesa: gravar antes de o objeto existir faria a galeria do
   * casal assinar uma URL para o nada e mostrar imagem quebrada, em vez de cair
   * no ramo "sem capa", que ao menos desenha o filme.
   */
  const r = await fetch(`${BASE}/api/medias/${video.id}/poster`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({}),
  });
  if (r.ok) throw new Error(`o PUT aceitou sem o objeto existir (${r.status})`);
  const { rows } = await db.query("select chave_thumb from medias where id = $1", [video.id]);
  if (rows[0].chave_thumb) throw new Error("gravou a coluna mesmo sem arquivo");
  return `recusou com ${r.status}`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a aba de vídeo não fecha" : "\n✓ aba de vídeo ok");
process.exitCode = falhou ? 1 : 0;
