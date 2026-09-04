#!/usr/bin/env node
/**
 * O painel da galeria em abas. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-painel-abas.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── POR QUE A TELA FOI PARTIDA (04/09/2026) ────────────────────────────────
 *
 * A tela da galeria empilhava ONZE seções numa página só, e o sócio resumiu:
 * "a organização da criação da galeria está confusa". Ele apontou o Pixieset,
 * que tem menu lateral e vai por partes.
 *
 * O ganho não é só de organização. A página antiga fazia OITO consultas ao
 * banco e assinava uma URL por foto antes de desenhar qualquer coisa — numa
 * galeria de 600 fotos, 600 assinaturas para quem entrou só para trocar a
 * senha. Com uma rota por aba, cada uma carrega só o que usa, e é isso que a
 * etapa "Entrega não carrega miniatura" prende: sem ela, alguém junta tudo de
 * novo num layout compartilhado e o ganho desaparece sem ninguém notar.
 *
 * ── A ETAPA QUE MAIS IMPORTA ───────────────────────────────────────────────
 *
 * "galeria de outro estúdio não abre em aba nenhuma". Quatro rotas novas são
 * quatro portas para a mesma galeria, e basta UMA sem tranca. Layout que
 * redireciona não basta como única defesa: cada página busca os próprios dados
 * e precisa da mesma cláusula `tenant_id` no `where`.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada, marcaDaRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
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
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const ABAS = ["fotos", "design", "entrega", "atividade"];

/** O que só pode aparecer na aba certa — um pedaço de texto de cada seção. */
const MARCA_DA_ABA = {
  fotos: "Arraste a pasta do casamento aqui",
  design: "Ajustar em detalhe",
  entrega: "Entrega ao cliente",
  atividade: "Acessos do cliente",
};

const g = await galeriaDaRodada(db, { nome: "abas", medias: 3 });
const cookie = cookieDeSessao(g.tenant_id);

/* Um SEGUNDO estúdio, com galeria própria: é o que permite perguntar "a sessão
 * do estúdio A abre a galeria do estúdio B?". Um id inexistente não serviria —
 * ele dá 404 mesmo numa rota que tenha esquecido o filtro de tenant. */
const marca = marcaDaRodada();
const { rows: [outro] } = await db.query(
  `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status)
        values ($1, 'Estúdio Vizinho', $2, 'x', $3, 'ativo') returning id`,
  [`vizinho-${marca}`, `vizinho-${marca}@teste.local`, String(1024 ** 4)],
);
const { rows: [galeriaVizinha] } = await db.query(
  `insert into galerias (tenant_id, slug, titulo, estado, publicada)
        values ($1, $2, 'Galeria do vizinho', 'online', false) returning id`,
  [outro.id, `vizinha-${marca}`],
);

const pegar = (caminho, opcoes = {}) =>
  fetch(`${BASE}${caminho}`, { redirect: "manual", headers: { cookie }, ...opcoes });

console.log("\nPainel da galeria em abas\n");

await etapa("o endereço antigo da galeria continua abrindo, e cai em Fotos", async () => {
  /* Link já compartilhado, aba do navegador aberta há dias, favorito do
   * fotógrafo: nada disso pode virar 404 por causa da reorganização. */
  const r = await pegar(`/painel/galerias/${g.id}`);
  if (r.status !== 307 && r.status !== 308) throw new Error(`status ${r.status}`);
  const destino = r.headers.get("location") ?? "";
  if (!destino.endsWith(`/painel/galerias/${g.id}/fotos`)) throw new Error(`foi para ${destino}`);
  return `${r.status} → /fotos`;
});

await etapa("as quatro abas abrem", async () => {
  for (const aba of ABAS) {
    const r = await pegar(`/painel/galerias/${g.id}/${aba}`);
    igual(r.status, 200, `aba ${aba}`);
  }
  return ABAS.join(", ");
});

await etapa("o menu lateral aparece em todas, com as quatro entradas", async () => {
  for (const aba of ABAS) {
    const html = await (await pegar(`/painel/galerias/${g.id}/${aba}`)).text();
    for (const outra of ABAS) {
      if (!html.includes(`/painel/galerias/${g.id}/${outra}`)) {
        throw new Error(`em "${aba}" falta o link para "${outra}"`);
      }
    }
  }
});

await etapa('"Ver como o cliente vê" aparece nas quatro abas, e abre a prévia do dono', async () => {
  /*
   * O botão existia e era o problema: morava dentro do editor de aparência,
   * atrás de um rótulo pequeno. O sócio pediu "um botão de visualização mais
   * fácil de ver". No cabeçalho ele serve às quatro abas, porque "como está
   * ficando?" não pertence a nenhuma delas em particular.
   *
   * `?previa=1` é o que faz o RASCUNHO abrir para o dono — sem ele, a galeria
   * que ainda não foi publicada devolveria 404 justamente para quem a monta.
   */
  const esperado = `/g/${g.tslug}/${g.gslug}?previa=1`;
  for (const aba of ABAS) {
    const html = await (await pegar(`/painel/galerias/${g.id}/${aba}`)).text();
    const limpo = html.replaceAll("&amp;", "&").replaceAll("\\", "");
    if (!limpo.includes(esperado)) throw new Error(`"${aba}" não tem o link da prévia`);
    if (!limpo.includes("Ver como o cliente vê")) throw new Error(`"${aba}" não tem o botão`);
  }
  return esperado;
});

await etapa("cada aba mostra a SUA seção, e não as das outras", async () => {
  for (const aba of ABAS) {
    const html = await (await pegar(`/painel/galerias/${g.id}/${aba}`)).text();
    if (!html.includes(MARCA_DA_ABA[aba])) {
      throw new Error(`"${aba}" não mostra "${MARCA_DA_ABA[aba]}"`);
    }
    for (const outra of ABAS) {
      if (outra !== aba && html.includes(MARCA_DA_ABA[outra])) {
        throw new Error(`"${aba}" está mostrando a seção de "${outra}"`);
      }
    }
  }
});

await etapa("Entrega NÃO assina miniatura nenhuma — é o ganho de carregar por partes", async () => {
  const entrega = await (await pegar(`/painel/galerias/${g.id}/entrega`)).text();
  if (entrega.includes("_thumb.webp")) {
    throw new Error("a aba Entrega ainda carrega as miniaturas da galeria");
  }
  /* E a de Fotos carrega, senão a comparação não prova nada. */
  const fotos = await (await pegar(`/painel/galerias/${g.id}/fotos`)).text();
  if (!fotos.includes("_thumb.webp")) throw new Error("a aba Fotos perdeu as miniaturas");
  return "Entrega sem miniatura, Fotos com";
});

await etapa("galeria de OUTRO estúdio não abre em aba nenhuma", async () => {
  for (const aba of [...ABAS, ""]) {
    const caminho = `/painel/galerias/${galeriaVizinha.id}${aba ? `/${aba}` : ""}`;
    const r = await pegar(caminho);
    if (r.status !== 404) {
      throw new Error(`${caminho} devolveu ${r.status} para a sessão de outro estúdio`);
    }
  }
  return `${ABAS.length + 1} rotas conferidas`;
});

await etapa("sem sessão, nenhuma aba abre", async () => {
  for (const aba of ABAS) {
    const r = await fetch(`${BASE}/painel/galerias/${g.id}/${aba}`, { redirect: "manual" });
    if (r.status !== 307 && r.status !== 308) {
      throw new Error(`aba ${aba} devolveu ${r.status} sem cookie`);
    }
  }
});

await db.query("delete from galerias where id = $1", [galeriaVizinha.id]);
await db.query("delete from tenants where id = $1", [outro.id]);
await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ painel em abas com falha\n" : "\n✓ painel em abas ok\n");
process.exit(falhou ? 1 : 0);
