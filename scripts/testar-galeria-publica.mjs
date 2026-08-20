#!/usr/bin/env node
/**
 * Testa a galeria pública de ponta a ponta. Uso:
 *   node --env-file=.env.local scripts/testar-galeria-publica.mjs
 *
 * Cobre o que mais importa nesta parte: galeria despublicada não abre, senha
 * errada não passa, senha certa libera, e o acesso fica registrado.
 */
import { createHash, createHmac } from "node:crypto";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const { DATABASE_URL, SESSION_SECRET } = process.env;
if (!DATABASE_URL || !SESSION_SECRET) {
  console.error("✗ faltam DATABASE_URL ou SESSION_SECRET");
  process.exit(1);
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const { rows } = await db.query(
  `select g.id, g.slug as gslug, g.titulo, t.slug as tslug
     from galerias g join tenants t on t.id = g.tenant_id
    order by g.criado_em limit 1`,
);
if (rows.length === 0) {
  console.error("✗ nenhuma galeria no banco");
  process.exit(1);
}
const { id: galeriaId, gslug, tslug, titulo } = rows[0];
const url = `${BASE}/g/${tslug}/${gslug}`;
console.log(`galeria: ${titulo}\nlink:    ${url}\n`);

const SENHA = "anaepedro";
const hashDaSenha = (s) => {
  const sal = createHash("sha256").update(SESSION_SECRET).digest("hex").slice(0, 16);
  return createHash("sha256").update(sal + s).digest("hex");
};

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

/**
 * Texto visível da página. Decodifica as entidades HTML porque o React escapa a
 * saída — "Ana & Pedro" chega como "Ana &amp; Pedro". Esse escape é justamente o
 * que impede XSS, então o teste é que precisa se adaptar.
 */
const textoDe = async (r) =>
  (await r.text())
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

await etapa("galeria despublicada não abre", async () => {
  await db.query("update galerias set publicada = false, senha_hash = null where id = $1", [galeriaId]);
  const r = await fetch(url, { redirect: "manual" });
  if (r.status !== 404) throw new Error(`esperava 404, veio ${r.status}`);
  return "HTTP 404";
});

await etapa("publicada e sem senha abre para qualquer um", async () => {
  await db.query("update galerias set publicada = true where id = $1", [galeriaId]);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const txt = await textoDe(r);
  if (!txt.includes(titulo)) throw new Error("título não apareceu na página");
  if (!txt.includes("entregue com")) throw new Error("selo do rodapé não apareceu");
  return "título e selo presentes";
});

await etapa("com senha, mostra o portão em vez das fotos", async () => {
  await db.query("update galerias set senha_hash = $1 where id = $2", [hashDaSenha(SENHA), galeriaId]);
  const r = await fetch(url);
  const txt = await textoDe(r);
  if (!txt.includes("protegida")) throw new Error("não mostrou o portão de senha");
  return "portão exibido";
});

await etapa("cookie forjado não abre a galeria", async () => {
  const falso = `${Date.now() + 60000}.${"0".repeat(64)}`;
  const r = await fetch(url, { headers: { cookie: `g_${galeriaId.slice(0, 8)}=${falso}` } });
  const txt = await textoDe(r);
  if (!txt.includes("protegida")) throw new Error("cookie inválido passou!");
  return "barrado";
});

/*
 * A assinatura da liberação inclui uma MARCA da senha atual. É o que faz trocar
 * a senha expulsar quem já entrou — antes o cookie sobrevivia à troca por sete
 * dias, mantendo dentro exatamente quem o fotógrafo queria barrar.
 */
const marcaDaSenha = (h) =>
  createHash("sha256").update(h ?? "sem-senha").digest("hex").slice(0, 12);

const cookieLiberado = (senhaHash, expira = Date.now() + 60000) => {
  const assinatura = createHmac("sha256", SESSION_SECRET)
    .update(`${galeriaId}.${expira}.${marcaDaSenha(senhaHash)}`)
    .digest("hex");
  return `g_${galeriaId.slice(0, 8)}=${expira}.${assinatura}`;
};

await etapa("cookie assinado corretamente abre", async () => {
  const { rows: s } = await db.query("select senha_hash from galerias where id = $1", [galeriaId]);
  const r = await fetch(url, { headers: { cookie: cookieLiberado(s[0].senha_hash) } });
  const txt = await textoDe(r);
  if (txt.includes("protegida")) throw new Error("ainda pede senha");
  if (!txt.includes(titulo)) throw new Error("não mostrou a galeria");
  return "galeria liberada";
});

await etapa("TROCAR a senha invalida quem já tinha entrado", async () => {
  const { rows: s } = await db.query("select senha_hash from galerias where id = $1", [galeriaId]);
  const cookieAntigo = cookieLiberado(s[0].senha_hash);

  // O fotógrafo descobre que o link vazou e troca a senha.
  await db.query("update galerias set senha_hash = $1 where id = $2", [
    hashDaSenha("senha-nova-depois-do-vazamento"),
    galeriaId,
  ]);

  const r = await fetch(url, { headers: { cookie: cookieAntigo } });
  const txt = await textoDe(r);
  if (!txt.includes("protegida")) {
    throw new Error("o cookie antigo ainda abre — trocar a senha não expulsou ninguém");
  }

  // Devolve a senha original para as etapas seguintes.
  await db.query("update galerias set senha_hash = $1 where id = $2", [
    hashDaSenha(SENHA),
    galeriaId,
  ]);
  return "cookie antigo deixa de valer";
});

/*
 * "Não permitir download" precisa APAGAR o link, não só esconder o botão.
 *
 * Antes, a página assinava a URL do original para toda mídia e o componente só
 * escondia os botões — o link ia no HTML do mesmo jeito, válido por 6 horas.
 * Bastava abrir "ver código-fonte" para baixar tudo em resolução cheia numa
 * galeria com download bloqueado.
 */
await etapa("com download bloqueado, o original de foto COM prévia não vai no HTML", async () => {
  await db.query(
    "update galerias set permite_download = false, senha_hash = null, publicada = true, estado = 'online' where id = $1",
    [galeriaId],
  );
  const bruto = await (await fetch(url)).text();

  // Só as que TÊM derivada. Foto sem prévia é exibida a partir do próprio
  // original — o link precisa estar lá, senão a foto não carrega. Ver o aviso
  // em src/components/publicar-galeria.tsx sobre o alcance real deste botão.
  const { rows } = await db.query(
    `select chave from medias
      where galeria_id = $1 and pronto and chave_preview is not null`,
    [galeriaId],
  );
  if (rows.length === 0) throw new Error("a galeria de teste não tem foto com prévia gerada");

  for (const r of rows) {
    const original = encodeURIComponent(r.chave).replace(/%2F/g, "/");
    if (bruto.includes(original)) {
      throw new Error(`o link do original vazou mesmo com download bloqueado: ${r.chave}`);
    }
  }
  return `${rows.length} original(is) fora do HTML`;
});

await etapa("com download liberado, a URL do original volta a aparecer", async () => {
  await db.query("update galerias set permite_download = true where id = $1", [galeriaId]);
  const bruto = await (await fetch(url)).text();
  const { rows } = await db.query(
    `select chave from medias
      where galeria_id = $1 and pronto and chave_preview is not null limit 1`,
    [galeriaId],
  );
  const original = encodeURIComponent(rows[0].chave).replace(/%2F/g, "/");
  if (!bruto.includes(original)) {
    throw new Error("o download está liberado mas o link não foi gerado");
  }
  return "link presente quando deve estar";
});

/*
 * A prévia do painel aponta para a rota pública, e o fotógrafo escolhe a
 * aparência enquanto a galeria ainda é RASCUNHO — antes ela mostrava a página de
 * 404, fazendo o recurso parecer quebrado no momento em que era mais útil.
 *
 * A permissão vem da SESSÃO, nunca do parâmetro. Estes testes existem para o
 * `?previa=1` não virar, por descuido, um jeito de abrir rascunho alheio.
 */
const sessaoDe = (tenantId) => {
  const exp = Date.now() + 300000;
  const d = `${tenantId}.${exp}`;
  return `fotonio_sessao=${d}.${createHmac("sha256", SESSION_SECRET).update(d).digest("hex")}`;
};

await etapa("prévia: rascunho com senha abre para o DONO e para mais ninguém", async () => {
  const { rows: t } = await db.query("select tenant_id from galerias where id = $1", [galeriaId]);
  const dono = t[0].tenant_id;

  await db.query("update galerias set publicada = false, senha_hash = $1 where id = $2", [
    hashDaSenha(SENHA),
    galeriaId,
  ]);

  const outro = await db.query(
    `insert into tenants (slug,nome_estudio,email,senha_hash) values ($1,'Outro',$2,'x') returning id`,
    [`previa-${Date.now()}`, `previa-${Date.now()}@teste`],
  );

  try {
    const status = async (u, cookie) =>
      (await fetch(u, { headers: cookie ? { cookie } : {}, redirect: "manual" })).status;

    if ((await status(url)) !== 404) throw new Error("rascunho abriu para visitante comum");
    if ((await status(`${url}?previa=1`)) !== 404) {
      throw new Error("o parâmetro sozinho abriu o rascunho — vira porta dos fundos");
    }
    if ((await status(`${url}?previa=1`, sessaoDe(outro.rows[0].id))) !== 404) {
      throw new Error("sessão de OUTRO estúdio abriu o rascunho");
    }
    if ((await status(`${url}?previa=1`, sessaoDe(dono))) !== 200) {
      throw new Error("o dono não conseguiu ver a própria prévia");
    }
    return "só a sessão do dono abre";
  } finally {
    await db.query("delete from tenants where id = $1", [outro.rows[0].id]);
    await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [galeriaId]);
  }
});

await etapa("prévia do dono NÃO conta como abertura do cliente", async () => {
  // O número de aberturas é a prova de que o casal recebeu; o fotógrafo
  // conferindo o próprio trabalho não pode inflar essa prova.
  const { rows: t } = await db.query("select tenant_id from galerias where id = $1", [galeriaId]);
  const conta = async () =>
    (await db.query("select count(*)::int n from acessos where galeria_id = $1", [galeriaId]))
      .rows[0].n;

  const antes = await conta();
  await fetch(`${url}?previa=1`, { headers: { cookie: sessaoDe(t[0].tenant_id) } });
  if ((await conta()) !== antes) throw new Error("a prévia do dono foi contada como entrega");

  // E o visitante comum CONTINUA sendo contado.
  await fetch(url);
  if ((await conta()) <= antes) throw new Error("parou de contar o visitante de verdade");
  return "conta o casal, não o fotógrafo";
});

await etapa("galeria no cofre avisa em vez de sumir", async () => {
  await db.query("update galerias set estado = 'arquivada' where id = $1", [galeriaId]);
  const r = await fetch(url);
  const txt = await textoDe(r);
  if (!txt.includes("cofre")) throw new Error("não avisou sobre o cofre");
  await db.query("update galerias set estado = 'online' where id = $1", [galeriaId]);
  return "aviso correto";
});

await etapa("registra acesso do cliente", async () => {
  const antes = await db.query("select count(*)::int n from acessos where galeria_id = $1", [galeriaId]);
  const r = await fetch(`${BASE}/api/g/${galeriaId}/acesso`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "baixou_tudo" }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const depois = await db.query("select count(*)::int n from acessos where galeria_id = $1", [galeriaId]);
  if (depois.rows[0].n <= antes.rows[0].n) throw new Error("nada foi registrado");
  const { rows: ip } = await db.query(
    "select ip_hash from acessos where galeria_id = $1 order by criado_em desc limit 1",
    [galeriaId],
  );
  return `${depois.rows[0].n} registros · ip guardado como hash: ${ip[0].ip_hash ? "sim" : "sem ip"}`;
});

await etapa("recusa ação inventada no registro", async () => {
  const r = await fetch(`${BASE}/api/g/${galeriaId}/acesso`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "apagar_tudo" }),
  });
  if (r.status !== 400) throw new Error(`esperava 400, veio ${r.status}`);
  return "HTTP 400";
});

// Deixa a galeria como estava para o Felipe testar à mão.
await db.query("update galerias set senha_hash = null, publicada = true where id = $1", [galeriaId]);
await db.end();

if (falhou) {
  console.error("\n✗ a galeria pública tem problema");
  process.exit(1);
}
console.log(`\n✓ galeria pública íntegra — deixei publicada e SEM senha em ${url}`);
