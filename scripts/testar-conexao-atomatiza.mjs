#!/usr/bin/env node
/**
 * Testa o que a conexão com o Atomatiza destrava na chave de API. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-conexao-atomatiza.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * O Atomatiza (contratos, agenda, cobrança) cria aqui a galeria de um contrato
 * e depois pergunta como ela está. Três coisas precisam ficar presas:
 *
 *   - IDEMPOTÊNCIA: o mesmo contrato pedindo duas vezes recebe a MESMA galeria
 *     (migração 026). Botão clicado duas vezes não pode fabricar "ana-pedro-2".
 *   - ISOLAMENTO: a referência é única POR ESTÚDIO, nunca global — dois
 *     estúdios podem ter contratos com o mesmo id lá.
 *   - `noAr` CALCULADO: o outro lado vai dizer "as fotos estão prontas" a um
 *     casal. A resposta tem de ser a régua da página pública, não a coluna
 *     `publicada` crua.
 *
 * E a aresta da lixeira: apagar a galeria LIBERA a referência (para recriar do
 * contrato sem esperar a purga), e o restauro de uma galeria cuja referência
 * já foi reocupada volta SEM o vínculo — ver `restaurarGaleria`.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { gerarChave } from "../src/lib/chaves-api.ts";
import { restaurarGaleria } from "../src/lib/tenants.ts";
import { marca, enderecoDaGaleria } from "../src/config/marca.ts";

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

/*
 * Dois estúdios PRÓPRIOS, criados por esta execução — ver o aviso no topo de
 * `testar-tudo.mjs`. Este teste depende do estado exato de (origem, origem_ref)
 * e não pode dividir bancada com ninguém.
 */
const carimbo = Date.now();
const novoEstudio = async (apelido) => {
  const { rows: [t] } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, status)
          values ($1, $2, $3, 'scrypt:x:y', 'ativo')
       returning id, slug, nome_estudio`,
    [`conexao-${apelido}-${carimbo}`, `Estúdio Conexão ${apelido}`, `conexao-${apelido}-${carimbo}@teste.local`],
  );
  return t;
};
const estudio = await novoEstudio("a");
const outro = await novoEstudio("b");

const criadas = { chaves: [], galerias: [], tenants: [estudio.id, outro.id] };
const novaChave = async (tenantId, escopo) => {
  const c = await gerarChave(tenantId, `conexao-atomatiza ${escopo}`, escopo);
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

console.log(`\nConexão com o Atomatiza — ${estudio.nome_estudio}\n`);

const deEnvio = await novaChave(estudio.id, "envio");
const deLeitura = await novaChave(estudio.id, "leitura");
const doOutro = await novaChave(outro.id, "envio");

// O id do contrato lá é opaco aqui — um uuid de mentira serve exatamente igual.
const contrato = `contrato-${carimbo}`;

await etapa("/api/conta sem chave é 401", async () => {
  igual((await chamar("/api/conta")).status, 401, "status");
});

await etapa("/api/conta diz de quem é a chave", async () => {
  const r = await chamar("/api/conta", { chave: deLeitura });
  igual(r.status, 200, "status");
  const conta = await r.json();
  igual(conta.tenantId, estudio.id, "tenantId");
  igual(conta.slug, estudio.slug, "slug");
  igual(conta.nomeEstudio, estudio.nome_estudio, "nomeEstudio");
  igual(conta.dominio, marca.dominio, "dominio");
  igual(conta.escopo, "leitura", "escopo da chave de leitura");
  const deEnvioConta = await (await chamar("/api/conta", { chave: deEnvio })).json();
  igual(deEnvioConta.escopo, "envio", "escopo da chave de envio");
  return `${conta.nomeEstudio} · ${conta.slug}.${conta.dominio}`;
});

let galeria = null;

await etapa("criar com referência externa guarda a procedência", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deEnvio,
    corpo: { titulo: "Ana e Pedro", referenciaExterna: contrato },
  });
  igual(r.status, 201, "status");
  galeria = await r.json();
  criadas.galerias.push(galeria.id);
  igual(galeria.estudioSlug, estudio.slug, "estudioSlug");
  igual(galeria.url, enderecoDaGaleria(estudio.slug, galeria.slug), "url canônica");
  const { rows: [g] } = await db.query("select origem, origem_ref from galerias where id = $1", [galeria.id]);
  igual(g.origem, "atomatiza", "origem");
  igual(g.origem_ref, contrato, "origem_ref");
  return galeria.url;
});

await etapa("a criação registra o evento de auditoria", async () => {
  const { rows } = await db.query(
    "select detalhe from eventos where alvo_id = $1 and acao = 'galeria.criada-de-fora'",
    [galeria.id],
  );
  igual(rows.length, 1, "eventos");
  igual(rows[0].detalhe.origem_ref, contrato, "detalhe.origem_ref");
});

await etapa("a mesma referência devolve a MESMA galeria", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deEnvio,
    corpo: { titulo: "Ana e Pedro", referenciaExterna: contrato },
  });
  igual(r.status, 200, "status — repetição não é criação");
  const g = await r.json();
  igual(g.id, galeria.id, "id");
  const { rows } = await db.query(
    "select id from galerias where tenant_id = $1 and origem_ref = $2",
    [estudio.id, contrato],
  );
  igual(rows.length, 1, "linhas no banco");
});

await etapa("a referência é única POR ESTÚDIO, não global", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: doOutro,
    corpo: { titulo: "Contrato homônimo", referenciaExterna: contrato },
  });
  igual(r.status, 201, "status");
  const g = await r.json();
  criadas.galerias.push(g.id);
  if (g.id === galeria.id) throw new Error("o outro estúdio recebeu a galeria alheia");
});

await etapa("referência longa demais é recusada", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deEnvio,
    corpo: { titulo: "x", referenciaExterna: "r".repeat(201) },
  });
  igual(r.status, 400, "status");
});

await etapa("sem referência, nada muda para o plugin", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deEnvio,
    corpo: { titulo: "Coleção do Lightroom" },
  });
  igual(r.status, 201, "status");
  const g = await r.json();
  criadas.galerias.push(g.id);
  const { rows: [linha] } = await db.query("select origem from galerias where id = $1", [g.id]);
  igual(linha.origem, null, "origem fica nula");
});

await etapa("GET /api/galerias/{id} responde como está a entrega", async () => {
  const r = await chamar(`/api/galerias/${galeria.id}`, { chave: deLeitura });
  igual(r.status, 200, "status");
  const g = await r.json();
  igual(g.publicada, false, "publicada");
  igual(g.noAr, false, "rascunho não está no ar");
  igual(g.origemRef, contrato, "origemRef");
  igual(g.url, galeria.url, "url");
});

await etapa("noAr é a régua da página pública, não a coluna crua", async () => {
  await db.query("update galerias set publicada = true, estado = 'online' where id = $1", [galeria.id]);
  let g = await (await chamar(`/api/galerias/${galeria.id}`, { chave: deLeitura })).json();
  igual(g.noAr, true, "publicada e online");

  // Publicada, mas no cofre: o link do casal NÃO abre, e a rota tem de dizer isso.
  await db.query("update galerias set estado = 'arquivada' where id = $1", [galeria.id]);
  g = await (await chamar(`/api/galerias/${galeria.id}`, { chave: deLeitura })).json();
  igual(g.publicada, true, "a coluna continua true");
  igual(g.noAr, false, "no cofre não está no ar");

  // Publicada, mas vencida: mesmo caso.
  await db.query(
    "update galerias set estado = 'online', expira_em = now() - interval '1 day' where id = $1",
    [galeria.id],
  );
  g = await (await chamar(`/api/galerias/${galeria.id}`, { chave: deLeitura })).json();
  igual(g.noAr, false, "vencida não está no ar");

  await db.query("update galerias set expira_em = null where id = $1", [galeria.id]);
  return "cofre e prazo vencido derrubam o noAr";
});

await etapa("galeria de outro estúdio é 404, id torto também", async () => {
  igual((await chamar(`/api/galerias/${galeria.id}`, { chave: doOutro })).status, 404, "alheia");
  igual((await chamar("/api/galerias/nao-e-uuid", { chave: deLeitura })).status, 404, "id torto");
});

await etapa("a lista traz a procedência para o seletor de vínculo", async () => {
  const { galerias } = await (await chamar("/api/galerias", { chave: deLeitura })).json();
  const g = galerias.find((x) => x.id === galeria.id);
  if (!g) throw new Error("galeria criada não está na lista");
  igual(g.origem, "atomatiza", "origem");
  igual(g.origem_ref, contrato, "origem_ref");
});

await etapa("apagar a galeria LIBERA a referência do contrato", async () => {
  await db.query("update galerias set estado = 'lixeira', apagada_em = now() where id = $1", [galeria.id]);
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deEnvio,
    corpo: { titulo: "Ana e Pedro", referenciaExterna: contrato },
  });
  igual(r.status, 201, "status — recriar sem esperar a purga");
  const g = await r.json();
  criadas.galerias.push(g.id);
  if (g.id === galeria.id) throw new Error("devolveu a galeria da lixeira");
  return `recriada como ${g.slug}`;
});

await etapa("restaurar a antiga não briga com a recriada", async () => {
  await restaurarGaleria(estudio.id, galeria.id);
  const { rows: [velha] } = await db.query(
    "select estado, origem, origem_ref from galerias where id = $1",
    [galeria.id],
  );
  igual(velha.estado, "online", "restaurada");
  igual(velha.origem, null, "o vínculo ficou com a recriada");
  const { rows } = await db.query(
    "select id from galerias where tenant_id = $1 and origem_ref = $2 and estado <> 'lixeira'",
    [estudio.id, contrato],
  );
  igual(rows.length, 1, "uma dona só para a referência");
});

/*
 * Limpeza: só o que este teste criou. Eventos ficam — a tabela recusa delete
 * por gatilho, de propósito (ver src/lib/eventos.ts), e evento órfão de teste
 * num banco de teste é exatamente o custo que ela anuncia.
 */
if (criadas.galerias.length > 0) {
  await db.query("delete from galerias where id = any($1::uuid[])", [criadas.galerias]);
}
await db.query("delete from galerias where tenant_id = any($1::uuid[])", [criadas.tenants]);
if (criadas.chaves.length > 0) {
  await db.query("delete from chaves_api where id = any($1::uuid[])", [criadas.chaves]);
}
await db.query("delete from tenants where id = any($1::uuid[])", [criadas.tenants]);
await db.end();

console.log(falhou ? "\n✗ conexão com o Atomatiza com falha\n" : "\n✓ conexão com o Atomatiza ok\n");
process.exit(falhou ? 1 : 0);
