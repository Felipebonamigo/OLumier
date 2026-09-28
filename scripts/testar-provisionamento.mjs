#!/usr/bin/env node
/**
 * Testa o PROVISIONAMENTO — o Atomatiza criando a conta pelo fotógrafo. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *        --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *        scripts/testar-provisionamento.mjs
 *
 * Esta é a única porta do sistema que CRIA CONTA sem ninguém preencher
 * formulário, e ela é aberta por um segredo de plataforma em vez de pela
 * credencial de um estúdio. Isso muda o que precisa ficar preso:
 *
 *   - RETRY NÃO FABRICA CONTA. A resposta pode se perder depois de a conta
 *     nascer; o fotógrafo clica de novo. Se a segunda chamada criasse outro
 *     estúdio, ele acabaria com as galerias espalhadas em dois — e sem jeito
 *     de juntar. É o defeito mais caro possível aqui, e o mais fácil de não
 *     notar, porque em teste manual ninguém clica duas vezes.
 *
 *   - QUEM JÁ TEM CONTA É RECUSADO, nunca duplicado. Mesmo motivo.
 *
 *   - A SENHA NÃO É ESCOLHIDA POR NINGUÉM DE FORA. A conta nasce inalcançável
 *     por senha; o acesso vem pelo link de recuperação. Se um dia alguém
 *     "simplificar" isso mandando a senha no corpo do pedido, o outro produto
 *     passa a saber a senha das contas daqui, para sempre.
 *
 *   - O SEGREDO É CONFERIDO. Sem ele configurado, a porta fica FECHADA — nunca
 *     aberta por omissão.
 *
 * Ver src/lib/provisionamento.ts e docs/chave-de-api.md.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

await exigirBancoDeTeste();

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

/* O segredo precisa existir ANTES de importar o módulo: ele lê o ambiente na
 * chamada, mas a porta fechada é justamente um dos casos a provar — então o
 * teste mexe em `process.env` entre as etapas, de propósito. */
process.env.PROVISIONAMENTO_SEGREDO = "segredo-de-plataforma-so-do-teste-0123456789";

const { provisionarEstudio, segredoConfere, provisionamentoConfigurado } = await import(
  "../src/lib/provisionamento.ts"
);
const { buscarTenantPorId } = await import("../src/lib/tenants.ts");
const { conferirChave } = await import("../src/lib/chaves-api.ts");

const MARCA = `prov${Date.now().toString(36)}`;
const criados = [];

console.log(`\nProvisionamento — marca da rodada: ${MARCA}\n`);

// ── a porta ─────────────────────────────────────────────────────────────────

await etapa("sem segredo configurado, a porta fica FECHADA", () => {
  const antes = process.env.PROVISIONAMENTO_SEGREDO;
  delete process.env.PROVISIONAMENTO_SEGREDO;
  const ligado = provisionamentoConfigurado();
  /* E o confere devolve false mesmo para string vazia — senão um ambiente com
   * a variável em branco viraria "qualquer um entra". */
  const vazioPassa = segredoConfere("");
  process.env.PROVISIONAMENTO_SEGREDO = antes;
  igual(ligado, false, "configurado");
  igual(vazioPassa, false, "vazio confere");
  return "503 antes de qualquer coisa";
});

await etapa("segredo errado não passa, certo passa", () => {
  igual(segredoConfere("outra-coisa-qualquer"), false, "errado");
  igual(segredoConfere(null), false, "ausente");
  igual(segredoConfere(process.env.PROVISIONAMENTO_SEGREDO), true, "certo");
});

// ── criar ───────────────────────────────────────────────────────────────────

let primeiro;
await etapa("cria a conta, em teste, e devolve chave utilizável", async () => {
  const r = await provisionarEstudio({
    nomeEstudio: "Estúdio Provisionado",
    email: `${MARCA}@teste.local`,
    origem: "atomatiza",
    referencia: `contrato-${MARCA}`,
  });
  if (!r.ok) throw new Error(`recusou: ${r.motivo}`);
  primeiro = r;
  criados.push(r.conta.id);

  igual(r.jaExistia, false, "jaExistia");
  igual(r.conta.origem, "atomatiza", "origem");
  igual(r.conta.origemRef, `contrato-${MARCA}`, "origem_ref");

  /* A chave tem de FUNCIONAR — devolver uma string com cara de chave não
   * prova nada. E com escopo de envio, que é o que a ponte precisa. */
  const conf = await conferirChave(r.chave);
  if (!conf) throw new Error("a chave devolvida não confere");
  igual(conf.tenantId, r.conta.id, "dona da chave");
  igual(conf.escopo, "envio", "escopo");
  return `${r.conta.slug} · chave válida`;
});

await etapa("a senha não é conhecida por ninguém — a conta nasce inalcançável", async () => {
  const { rows } = await db.query("select senha_hash from tenants where id = $1", [
    primeiro.conta.id,
  ]);
  const h = rows[0]?.senha_hash;
  if (!h) throw new Error("senha_hash vazio — a conta ficaria alcançável por hash previsível");
  /* O resultado NÃO pode conter a senha em claro, e nenhum campo da resposta
   * pode carregá-la. É o que impede o outro produto de saber a senha daqui. */
  if (JSON.stringify(primeiro).includes("senha")) {
    throw new Error("a resposta do provisionamento carrega algo chamado senha");
  }
  return "hash presente, senha desconhecida";
});

await etapa("o convite de definir senha foi registrado", async () => {
  const { rows } = await db.query(
    "select origem, usado_em from recuperacoes where tenant_id = $1",
    [primeiro.conta.id],
  );
  igual(rows.length, 1, "pedidos criados");
  igual(rows[0].origem, "provisionamento", "origem do pedido");
  igual(rows[0].usado_em, null, "ainda não usado");
  return "link de senha pendente, como deve";
});

// ── o retry, que é o que importa ────────────────────────────────────────────

await etapa("REPETIR com a mesma referência devolve o MESMO estúdio", async () => {
  const r = await provisionarEstudio({
    nomeEstudio: "Estúdio Provisionado",
    email: `${MARCA}@teste.local`,
    origem: "atomatiza",
    referencia: `contrato-${MARCA}`,
  });
  if (!r.ok) throw new Error(`recusou o retry: ${r.motivo}`);
  igual(r.jaExistia, true, "jaExistia");
  igual(r.conta.id, primeiro.conta.id, "mesmo estúdio");

  const { rows } = await db.query("select count(*)::int as n from tenants where origem_ref = $1", [
    `contrato-${MARCA}`,
  ]);
  igual(rows[0].n, 1, "quantos estúdios com esta referência");

  /* Chave NOVA, e a antiga continua valendo: quem repetiu não perde a conexão
   * que por acaso já tinha gravado. */
  if (r.chave === primeiro.chave) throw new Error("devolveu a mesma chave — o segredo não pode ser relido");
  if (!(await conferirChave(primeiro.chave))) throw new Error("a chave anterior parou de valer");
  return "um estúdio só, chave nova";
});

await etapa("o índice do banco também barra a segunda conta", async () => {
  let barrou = false;
  try {
    await db.query(
      `insert into tenants (slug, nome_estudio, email, senha_hash, plano_id, quota_bytes, origem, origem_ref)
       values ($1, 'Impostor', $2, 'x', 'inicial', 0, 'atomatiza', $3)`,
      [`impostor-${MARCA}`, `impostor-${MARCA}@teste.local`, `contrato-${MARCA}`],
    );
  } catch (e) {
    barrou = e.code === "23505";
  }
  if (!barrou) throw new Error("o índice único de origem não existe ou não pegou");
  return "23505, como deve";
});

// ── quem já tem conta ───────────────────────────────────────────────────────

await etapa("e-mail que já tem conta é RECUSADO, nunca duplicado", async () => {
  const r = await provisionarEstudio({
    nomeEstudio: "Outro Nome",
    email: `${MARCA}@teste.local`,
    origem: "atomatiza",
    /* Referência DIFERENTE: é o caso do fotógrafo que já era cliente daqui e
     * tenta ligar pelo Atomatiza. Não pode virar uma segunda conta. */
    referencia: `contrato-outro-${MARCA}`,
  });
  igual(r.ok, false, "ok");
  igual(r.motivo, "email_ja_usado", "motivo");

  const { rows } = await db.query("select count(*)::int as n from tenants where email = $1", [
    `${MARCA}@teste.local`,
  ]);
  igual(rows[0].n, 1, "contas com este e-mail");
  return "uma conta só, e o outro lado sabe o que dizer";
});

await etapa("o e-mail é normalizado — maiúsculas não criam conta paralela", async () => {
  const r = await provisionarEstudio({
    nomeEstudio: "Outro Nome",
    email: `${MARCA.toUpperCase()}@TESTE.LOCAL`,
    origem: "atomatiza",
    referencia: `contrato-caixa-${MARCA}`,
  });
  igual(r.ok, false, "ok");
  igual(r.motivo, "email_ja_usado", "motivo");
  return "recusado igual";
});

// ── limpeza ─────────────────────────────────────────────────────────────────

if (criados.length > 0) {
  await db.query("delete from chaves_api where tenant_id = any($1::uuid[])", [criados]);
  await db.query("delete from recuperacoes where tenant_id = any($1::uuid[])", [criados]);
  await db.query("delete from eventos where tenant_id = any($1::uuid[])", [criados]);
  await db.query("delete from tenants where id = any($1::uuid[])", [criados]);
}
await db.query("delete from tenants where email like $1", [`%${MARCA}%`]);
await db.end();

console.log(falhou ? "\n✗ provisionamento com falha\n" : "\n✓ provisionamento ok\n");
process.exit(falhou ? 1 : 0);
