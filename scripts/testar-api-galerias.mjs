#!/usr/bin/env node
/**
 * Testa as rotas de galeria e capítulo que a chave de API destrava. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-api-galerias.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * Por que estas rotas existem: criar galeria e criar capítulo viviam SÓ como
 * server action (`src/app/painel/actions.ts`), que usa `redirect()` e
 * `revalidatePath`. Server action não é chamável de fora do React — nem por Lua,
 * nem por curl. Sem estas rotas a chave de API autorizaria um plugin que não
 * teria onde publicar. Ver docs/chave-de-api.md.
 *
 * O que precisa ficar preso aqui:
 *   - escopo: chave de leitura NÃO cria nada;
 *   - isolamento: a lista de um estúdio não mostra galeria do outro;
 *   - o PORTÃO DE COBRANÇA. Nas rotas antigas ele vinha de graça, porque mora
 *     no corpo delas. Estas nasceram vazias, e rota nova que esquece o
 *     `podeEnviar` transforma a chave de API em desvio do paywall.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { gerarChave, revogarChave } from "../src/lib/chaves-api.ts";
import { buscarTenantPorId } from "../src/lib/tenants.ts";
import { situacaoDoTenant } from "../src/lib/assinatura.ts";
import { asaasConfigurado } from "../src/lib/asaas.ts";

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

const { rows: ts } = await db.query("select id, nome_estudio from tenants order by criado_em limit 2");
if (ts.length < 2) {
  console.error("✗ preciso de dois estúdios no banco de teste");
  process.exit(1);
}
const [estudio, outro] = ts;

/*
 * Um estúdio descartável e JÁ CANCELADO, só para o portão de cobrança.
 *
 * Mexer no `status` de um estúdio existente seria mais curto e sujaria o banco
 * de quem estiver testando ao mesmo tempo — este repositório costuma ter duas
 * sessões no mesmo banco de desenvolvimento.
 */
const marca = Date.now();
const { rows: [morto] } = await db.query(
  `insert into tenants (slug, nome_estudio, email, senha_hash, status, pago_ate)
        values ($1, 'Estúdio Cancelado', $2, 'scrypt:x:y', 'cancelado', null)
     returning id`,
  [`cancelado-${marca}`, `cancelado-${marca}@teste.local`],
);

const criadas = { chaves: [], galerias: [], tenants: [morto.id] };
const novaChave = async (tenantId, escopo) => {
  const c = await gerarChave(tenantId, `api-galerias ${escopo}`, escopo);
  criadas.chaves.push(c.id);
  return c.segredo;
};

const chamar = (caminho, { metodo = "GET", chave, corpo } = {}) =>
  fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      ...(chave ? { authorization: `Bearer ${chave}` } : {}),
      ...(corpo ? { "content-type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

console.log(`\nRotas de galeria pela chave de API — ${estudio.nome_estudio}\n`);

const deEnvio = await novaChave(estudio.id, "envio");
const deLeitura = await novaChave(estudio.id, "leitura");

await etapa("sem chave nenhuma, 401 em tudo", async () => {
  igual((await chamar("/api/galerias")).status, 401, "GET galerias");
  igual((await chamar("/api/galerias", { metodo: "POST", corpo: { titulo: "x" } })).status, 401, "POST galerias");
});

await etapa("chave inválida não abre", async () => {
  igual((await chamar("/api/galerias", { chave: "ga_000000_naoexiste" })).status, 401, "GET");
});

await etapa("chave de leitura lista as galerias do estúdio", async () => {
  const r = await chamar("/api/galerias", { chave: deLeitura });
  igual(r.status, 200, "status");
  const { galerias } = await r.json();
  if (!Array.isArray(galerias)) throw new Error("resposta sem array `galerias`");
  return `${galerias.length} galeria(s)`;
});

await etapa("a lista não mostra galeria de outro estúdio", async () => {
  const { rows } = await db.query("select id from galerias where tenant_id = $1", [outro.id]);
  const alheias = new Set(rows.map((g) => g.id));
  const { galerias } = await (await chamar("/api/galerias", { chave: deLeitura })).json();
  const vazadas = galerias.filter((g) => alheias.has(g.id));
  if (vazadas.length > 0) throw new Error(`${vazadas.length} galeria(s) do outro estúdio na lista`);
  return `${alheias.size} do outro estúdio ficaram de fora`;
});

await etapa("chave de LEITURA não cria galeria", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deLeitura,
    corpo: { titulo: "Não deveria existir" },
  });
  igual(r.status, 401, "status");
  const { rows } = await db.query("select id from galerias where titulo = $1", ["Não deveria existir"]);
  igual(rows.length, 0, "galerias criadas");
});

let galeriaId = null;

await etapa("chave de envio cria a galeria", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deEnvio,
    corpo: { titulo: `Publicada pelo plugin ${marca}`, subtitulo: "Gramado, RS", dataEvento: "2026-09-12" },
  });
  igual(r.status, 201, "status");
  const g = await r.json();
  if (!g.id || !g.slug) throw new Error(`resposta sem id/slug: ${JSON.stringify(g)}`);
  galeriaId = g.id;
  criadas.galerias.push(g.id);
  const { rows } = await db.query("select tenant_id from galerias where id = $1", [g.id]);
  igual(rows[0].tenant_id, estudio.id, "dono da galeria");
  return g.slug;
});

await etapa("galeria sem título é recusada", async () => {
  igual(
    (await chamar("/api/galerias", { metodo: "POST", chave: deEnvio, corpo: { titulo: "  " } })).status,
    400,
    "status",
  );
});

await etapa("chave de envio cria o capítulo", async () => {
  const r = await chamar(`/api/galerias/${galeriaId}/secoes`, {
    metodo: "POST",
    chave: deEnvio,
    corpo: { nome: "Cerimônia" },
  });
  igual(r.status, 201, "status");
  const s = await r.json();
  if (!s.id) throw new Error("resposta sem id");
  const { rows } = await db.query("select galeria_id from secoes where id = $1", [s.id]);
  igual(rows[0].galeria_id, galeriaId, "capítulo na galeria certa");
});

await etapa("capítulo repetido é recusado, mesmo com outra caixa", async () => {
  const r = await chamar(`/api/galerias/${galeriaId}/secoes`, {
    metodo: "POST",
    chave: deEnvio,
    corpo: { nome: "cerimônia" },
  });
  igual(r.status, 409, "status");
});

await etapa("capítulo em galeria de outro estúdio não é criado", async () => {
  const { rows } = await db.query("select id from galerias where tenant_id = $1 limit 1", [outro.id]);
  if (rows.length === 0) return "outro estúdio sem galeria — nada a provar";
  const r = await chamar(`/api/galerias/${rows[0].id}/secoes`, {
    metodo: "POST",
    chave: deEnvio,
    corpo: { nome: "Invasão" },
  });
  igual(r.status, 404, "status");
});

/*
 * ── O PORTÃO DE COBRANÇA, EM DOIS NÍVEIS ──────────────────────────────────
 *
 * `situacaoDoTenant` abre para todo mundo quando a cobrança está DESLIGADA
 * (assinatura.ts:79) — "nada a cobrar, nada a bloquear". Em desenvolvimento o
 * Asaas não está configurado, então a rota devolve 201 mesmo para um estúdio
 * cancelado, e isso está CERTO.
 *
 * Se o teste parasse aqui, a cobertura seria zero justamente no ponto que a
 * revisão marcou como o mais fácil de esquecer numa rota nova. Então ele prova
 * a regra no nível em que ela existe (a função), e só exige o 402 pela rota
 * quando a cobrança estiver mesmo ligada — anunciando quando pula, porque "não
 * rodou" e "quebrou" não podem ter a mesma cor.
 */
await etapa("a regra de cobrança recusa estúdio cancelado", async () => {
  const conta = await buscarTenantPorId(morto.id);
  const ligada = situacaoDoTenant(conta, true);
  igual(ligada.podeEnviar, false, "com a cobrança ligada");
  const desligada = situacaoDoTenant(conta, false);
  igual(desligada.podeEnviar, true, "com a cobrança desligada");
  return "recusa quando ligada, libera quando desligada";
});

await etapa("PORTÃO na rota: estúdio cancelado não cria galeria", async () => {
  const chaveMorta = await novaChave(morto.id, "envio");
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: chaveMorta,
    corpo: { titulo: "Não pode nascer" },
  });

  if (!asaasConfigurado()) {
    /* Não é falha: a rota chama `tenantQuePodeEnviar`, e ele libera de propósito
     * quando não há o que cobrar. Com ASAAS_API_KEY no ambiente, este passo
     * passa a exigir o 402 de verdade. */
    igual(r.status, 201, "sem cobrança ligada, cria mesmo");
    await db.query("delete from galerias where tenant_id = $1", [morto.id]);
    return "PULADO — cobrança desligada nesta instalação";
  }

  igual(r.status, 402, "status");
  const { rows } = await db.query("select id from galerias where tenant_id = $1", [morto.id]);
  igual(rows.length, 0, "galerias do cancelado");
  return "402, e nada foi criado";
});

await etapa("chave revogada perde o acesso na hora", async () => {
  const c = await gerarChave(estudio.id, "revogar em rota", "envio");
  criadas.chaves.push(c.id);
  igual((await chamar("/api/galerias", { chave: c.segredo })).status, 200, "antes");
  await revogarChave(c.id, estudio.id);
  igual((await chamar("/api/galerias", { chave: c.segredo })).status, 401, "depois");
});

/* Limpeza: só o que este teste criou. */
if (criadas.galerias.length > 0) {
  await db.query("delete from galerias where id = any($1::uuid[])", [criadas.galerias]);
}
if (criadas.chaves.length > 0) {
  await db.query("delete from chaves_api where id = any($1::uuid[])", [criadas.chaves]);
}
await db.query("delete from tenants where id = any($1::uuid[])", [criadas.tenants]);
await db.end();

console.log(falhou ? "\n✗ rotas de galeria com falha\n" : "\n✓ rotas de galeria ok\n");
process.exit(falhou ? 1 : 0);
