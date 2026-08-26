#!/usr/bin/env node
/**
 * Testa o domínio próprio do estúdio. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-dominio-proprio.mjs
 *
 * `carolinetedesco.com.br` servindo a vitrine no lugar do subdomínio nosso.
 *
 * ── O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ────────────────────────────────
 * Aceitar um domínio é autorizar o Caddy a pedir certificado para ele. O
 * porteiro (`api/tls/permitir`) existe porque, sem trava, alguém apontando mil
 * domínios ao nosso IP queima a cota da Let's Encrypt — que é por SERVIDOR, e
 * neste servidor moram Padelizou, Atomatiza, Poke Panda e Bonamigo. Um estúdio
 * digitando o domínio errado não pode derrubar a emissão dos outros.
 *
 * Por isso as três famílias de teste abaixo, em ordem de gravidade:
 *
 *   1. NÃO PODE RECLAMAR O QUE NÃO É DELE — em especial os nossos próprios
 *      domínios. Um estúdio com `dominio_proprio = olumier.com.br` passaria a
 *      responder pelo endereço da plataforma inteira.
 *   2. PROVA DE POSSE ANTES DA EMISSÃO — só domínio com TXT conferido libera o
 *      porteiro. `dominio_proprio` preenchido não basta.
 *   3. O NOME DO REGISTRO É CONGELADO — ele mora na zona DNS do CLIENTE. Trocar
 *      o prefixo depois quebra a verificação de todo mundo que já apontou, e
 *      não temos como editar a zona deles. A marca já mudou duas vezes
 *      (Fotônio → Olumier → Galeria Átomo); o prefixo não acompanha.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

exigirBancoDeTeste();

const mod = await import("../src/lib/dominio-proprio.ts");
const { DOMINIOS_ATENDIDOS } = await import("../src/config/dominios.ts");

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
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
  }
};

console.log("Domínio próprio:\n");

/* ── 1. normalizar o que a pessoa digita ────────────────────────────────── */

console.log("o que o fotógrafo digita");

await etapa("tira esquema, www, barra, porta e caixa", () => {
  for (const bruto of [
    "HTTPS://WWW.Carolinetedesco.com.BR/",
    "  carolinetedesco.com.br  ",
    "http://carolinetedesco.com.br",
    "www.carolinetedesco.com.br",
    "carolinetedesco.com.br:443",
    "carolinetedesco.com.br/portfolio",
  ]) {
    igual(mod.normalizarDominio(bruto), "carolinetedesco.com.br", `“${bruto}”`);
  }
  return "6 formas viram uma";
});

await etapa("recusa o que não é domínio", () => {
  for (const ruim of [
    "",
    "   ",
    "localhost",
    "carolinetedesco",
    "192.168.0.1",
    "carol inetedesco.com.br",
    "-carol.com.br",
    "carol-.com.br",
    "carol..com.br",
    "a".repeat(64) + ".com.br",
    "http://",
    "javascript:alert(1)",
  ]) {
    igual(mod.normalizarDominio(ruim), null, `“${ruim}” devia ser recusado`);
  }
  return "12 entradas ruins recusadas";
});

/* ── 2. o que NÃO pode ser reclamado ────────────────────────────────────── */

console.log("\nnão pode reclamar o que não é dele");

await etapa("nenhum domínio NOSSO pode virar domínio de estúdio", () => {
  for (const nosso of DOMINIOS_ATENDIDOS) {
    igual(mod.podeSerDominioDeEstudio(nosso), false, `“${nosso}”`);
    igual(mod.podeSerDominioDeEstudio(`www.${nosso}`), false, `“www.${nosso}”`);
    /* O subdomínio é o caso pior: quem reclamasse `sirius.olumier.com.br`
     * passaria a responder pelo endereço de OUTRO estúdio, com certificado
     * legítimo e sem nenhum aviso para o dono. */
    igual(mod.podeSerDominioDeEstudio(`sirius.${nosso}`), false, `“sirius.${nosso}”`);
  }
  return `${DOMINIOS_ATENDIDOS.length} domínios nossos barrados, com www e subdomínio`;
});

await etapa("o parecido continua barrado — sufixo com ponto, nunca includes", () => {
  /* `olumier.com.br.golpe.net` contém o nosso nome e é de outra pessoa. Aqui a
   * resposta é o INVERSO da checagem acima: é domínio de fora legítimo, então
   * PODE ser reclamado por quem o possui — e a prova de posse decide. O que não
   * pode é ele ser tratado como se fosse nosso. */
  igual(mod.podeSerDominioDeEstudio("olumier.com.br.golpe.net"), true, "domínio de fora");
});

await etapa("domínio comum de estúdio passa", () => {
  for (const bom of ["carolinetedesco.com.br", "sirius.fotografia.br", "estudio.com"]) {
    igual(mod.podeSerDominioDeEstudio(bom), true, `“${bom}”`);
  }
});

/* ── 3. o registro TXT, e por que ele é congelado ───────────────────────── */

console.log("\no registro que prova a posse");

await etapa("o nome do registro NÃO segue a marca", async () => {
  const nome = mod.nomeDoRegistroTxt("carolinetedesco.com.br");

  /* Se um dia alguém trocar a marca de novo e este teste ficar vermelho, a
   * correção NÃO é atualizar o esperado: é devolver a constante ao valor
   * antigo. O registro mora na zona DNS do cliente e nós não a editamos. */
  igual(nome, "_verificacao-galeria.carolinetedesco.com.br", "nome do registro");

  const { marca } = await import("../src/config/marca.ts");
  const simples = marca.nomeSimples.toLowerCase();
  if (nome.includes(simples)) {
    throw new Error(
      `o prefixo carrega o nome da marca (“${simples}”) — na próxima troca de marca ` +
        `a verificação de quem já apontou o DNS quebraria`,
    );
  }
  return nome;
});

await etapa("o valor esperado carrega o token do estúdio", () => {
  const v = mod.valorDoRegistroTxt("abc123");
  if (!v.includes("abc123")) throw new Error(`valor sem o token: ${v}`);
  igual(mod.confereValorTxt([v], "abc123"), true, "casa com o próprio token");
  igual(mod.confereValorTxt([v], "outro"), false, "não casa com token alheio");
});

await etapa("aceita o TXT partido em pedaços, como alguns provedores devolvem", () => {
  /* `dns.resolveTxt` devolve string[][] — um array de PEDAÇOS por registro.
   * Provedor que parte o valor em dois entregaria ["galeria-veri", "ficacao=abc"],
   * e comparar pedaço a pedaço nunca casaria. */
  const v = mod.valorDoRegistroTxt("abc123");
  const meio = Math.floor(v.length / 2);
  igual(mod.confereValorTxt([v.slice(0, meio), v.slice(meio)], "abc123"), true, "juntou os pedaços");
});

await etapa("ignora os outros TXT da zona em vez de falhar", () => {
  /* Toda zona tem SPF, verificação do Google, do Facebook. Achar o nosso no
   * meio é o caso normal, não a exceção. */
  const v = mod.valorDoRegistroTxt("abc123");
  const zona = [["v=spf1 include:_spf.google.com ~all"], ["google-site-verification=xyz"], [v]];
  igual(mod.confereValorTxtNaZona(zona, "abc123"), true, "achou no meio dos outros");
  igual(mod.confereValorTxtNaZona([["v=spf1 ~all"]], "abc123"), false, "não inventa");
});

await etapa("o token é longo e aleatório o bastante para não ser adivinhado", () => {
  const a = mod.novoToken();
  const b = mod.novoToken();
  if (a === b) throw new Error("dois tokens iguais");
  if (a.length < 24) throw new Error(`token curto demais: ${a.length} caracteres`);
  return `${a.length} caracteres`;
});

/* ── 4. banco: reclamar, verificar, resolver ────────────────────────────── */

console.log("\nno banco");

const { rows: ts } = await db.query("select id, slug from tenants order by criado_em limit 2");
if (ts.length < 2) {
  console.error("✗ preciso de 2 estúdios no banco de teste");
  process.exit(1);
}
const [estudioA, estudioB] = ts;
const DOM = `teste-dominio-${Date.now()}.com.br`;

const limpar = async () => {
  await db.query(
    `update tenants set dominio_proprio = null, dominio_token = null,
            dominio_verificado_em = null where id = any($1)`,
    [[estudioA.id, estudioB.id]],
  );
};

await etapa("reclamar guarda o domínio e um token, ainda NÃO verificado", async () => {
  await limpar();
  const r = await mod.reclamarDominio(estudioA.id, `  HTTPS://WWW.${DOM}/  `);
  if (!r.ok) throw new Error(`recusou: ${r.erro}`);
  igual(r.dominio, DOM, "normalizado ao gravar");
  if (!r.token) throw new Error("não gerou token");

  const { rows } = await db.query(
    "select dominio_proprio, dominio_token, dominio_verificado_em from tenants where id = $1",
    [estudioA.id],
  );
  igual(rows[0].dominio_proprio, DOM, "gravado");
  igual(rows[0].dominio_verificado_em, null, "nasce não verificado");
});

await etapa("o mesmo domínio não pode ser reclamado por dois estúdios", async () => {
  const r = await mod.reclamarDominio(estudioB.id, DOM);
  if (r.ok) throw new Error("deixou o segundo estúdio reclamar o mesmo domínio");
  return r.erro;
});

await etapa("reclamar um domínio NOSSO é recusado antes de tocar o banco", async () => {
  const r = await mod.reclamarDominio(estudioB.id, DOMINIOS_ATENDIDOS[0]);
  if (r.ok) throw new Error("deixou reclamar o domínio da plataforma");
  const { rows } = await db.query("select dominio_proprio from tenants where id = $1", [
    estudioB.id,
  ]);
  igual(rows[0].dominio_proprio, null, "não gravou nada");
});

await etapa("NÃO verificado não resolve para estúdio nenhum", async () => {
  mod.limparCacheDominios();
  igual(await mod.estudioDoDominioProprio(DOM), null, "resolveu sem prova de posse");
});

await etapa("NÃO verificado não libera o porteiro do certificado", async () => {
  igual(await mod.dominioLiberaCertificado(DOM), false, "liberou sem prova");
});

await etapa("verificado resolve para o estúdio dono", async () => {
  await db.query("update tenants set dominio_verificado_em = now() where id = $1", [estudioA.id]);
  mod.limparCacheDominios();
  igual(await mod.estudioDoDominioProprio(DOM), estudioA.slug, "slug");
  igual(await mod.dominioLiberaCertificado(DOM), true, "porteiro");
});

await etapa("resolve sem ligar para caixa nem www", async () => {
  mod.limparCacheDominios();
  igual(await mod.estudioDoDominioProprio(`WWW.${DOM.toUpperCase()}`), estudioA.slug, "www e caixa");
});

await etapa("host desconhecido devolve null, e não estoura", async () => {
  igual(await mod.estudioDoDominioProprio("nao-existe-aqui.com.br"), null, "desconhecido");
});

/*
 * O cache negativo não é otimização: sem ele, um robô varrendo com Host
 * aleatório vira uma consulta ao banco POR REQUISIÇÃO, e o proxy roda em quase
 * toda requisição do site.
 */
await etapa("host desconhecido repetido não bate no banco toda vez", async () => {
  mod.limparCacheDominios();
  const antes = mod.consultasAoBanco();
  for (let i = 0; i < 5; i++) await mod.estudioDoDominioProprio("nao-existe-aqui.com.br");
  const gastou = mod.consultasAoBanco() - antes;
  if (gastou !== 1) throw new Error(`${gastou} consultas para 5 pedidos do mesmo host`);
  return "5 pedidos, 1 consulta";
});

await etapa("soltar o domínio para de resolver e de liberar certificado", async () => {
  await mod.soltarDominio(estudioA.id);
  mod.limparCacheDominios();
  igual(await mod.estudioDoDominioProprio(DOM), null, "resolveu depois de solto");
  igual(await mod.dominioLiberaCertificado(DOM), false, "porteiro depois de solto");
});

await limpar();
await db.end();

if (falhou) {
  console.error("\n✗ domínio próprio com problema");
  process.exit(1);
}
console.log("\n✓ domínio próprio ok");
