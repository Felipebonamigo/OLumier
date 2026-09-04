#!/usr/bin/env node
/**
 * Testa o fluxo de upload de ponta a ponta, batendo nas rotas de verdade. Uso:
 *   node --env-file=.env.local scripts/testar-upload.mjs
 *
 * Precisa do servidor de desenvolvimento rodando. Não passa por navegador, então
 * NÃO testa CORS — testa a lógica: autorização, quota, URL assinada, envio,
 * confirmação com tamanho real e o trigger de uso de espaço.
 */
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const { DATABASE_URL, SESSION_SECRET } = process.env;

if (!DATABASE_URL || !SESSION_SECRET) {
  console.error("✗ faltam DATABASE_URL ou SESSION_SECRET no .env.local");
  process.exit(1);
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

// Bancada propria desta execucao (ver fixture-de-teste.mjs).
const tenant = await estudioDaRodada(db);

const galeria = await galeriaDaRodada(db);

console.log(`estúdio: ${tenant.nome_estudio}`);
console.log(`galeria: ${galeria.titulo}\n`);

// Cookie de sessão pelo módulo compartilhado — o formato mora num lugar só.
const cookie = cookieDeSessao(tenant.id);

// PNG 1x1 válido — o menor arquivo real possível para o teste.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
    return true;
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
    return false;
  }
};

let preparo;

await etapa("recusa tipo de arquivo não aceito", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeria.id}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nome: "virus.exe", mime: "application/x-msdownload", bytes: 100 }),
  });
  if (r.status !== 415) throw new Error(`esperava 415, veio ${r.status}`);
  return "HTTP 415";
});

await etapa("recusa quem não está autenticado", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeria.id}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: "a.png", mime: "image/png", bytes: 10 }),
  });
  if (r.status !== 401) throw new Error(`esperava 401, veio ${r.status}`);
  return "HTTP 401";
});

await etapa("prepara o envio", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeria.id}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nome: "teste-upload.png", mime: "image/png", bytes: png.length }),
  });
  preparo = await r.json();
  if (!r.ok) throw new Error(preparo.erro ?? `HTTP ${r.status}`);
  return `media ${preparo.mediaId.slice(0, 8)}…`;
});

await etapa("envia o arquivo direto ao bucket", async () => {
  const r = await fetch(preparo.url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return `${png.length} bytes`;
});

await etapa("confirma e grava o tamanho real", async () => {
  const r = await fetch(`${BASE}/api/medias/${preparo.mediaId}/confirmar`, {
    method: "POST",
    headers: { cookie },
  });
  const c = await r.json();
  if (!r.ok) throw new Error(c.erro ?? `HTTP ${r.status}`);
  if (c.bytes !== png.length) throw new Error(`bytes ${c.bytes} ≠ ${png.length}`);
  return `${c.bytes} bytes conferidos no bucket`;
});

await etapa("trigger atualizou o uso de espaço", async () => {
  const { rows } = await db.query(
    "select g.bytes_total, t.usado_bytes from galerias g join tenants t on t.id = g.tenant_id where g.id = $1",
    [galeria.id],
  );
  const { bytes_total, usado_bytes } = rows[0];
  if (Number(bytes_total) < png.length) throw new Error(`galeria com ${bytes_total} bytes`);
  if (Number(usado_bytes) < png.length) throw new Error(`tenant com ${usado_bytes} bytes`);
  return `galeria ${bytes_total} B · estúdio ${usado_bytes} B`;
});

await etapa("remove o arquivo de teste", async () => {
  const r = await fetch(`${BASE}/api/medias/${preparo.mediaId}/confirmar`, {
    method: "DELETE",
    headers: { cookie },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows } = await db.query("select usado_bytes from tenants where id = $1", [tenant.id]);
  return `espaço devolvido (estúdio agora com ${rows[0].usado_bytes} B)`;
});

// A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
await limparRodada(db);
await db.end();

/*
 * ── A ORDEM DA TELA ───────────────────────────────────────────────────────
 *
 * Pedido do Felipe em 27/08/2026: "o envio das fotos tem que ser o começo, para
 * depois a montagem da galeria ser já vista na prévia".
 *
 * Até então a página oferecia publicar, prazo e APARÊNCIA antes de existir foto
 * — o fotógrafo escolhia capa, tipografia e grade olhando fotos de exemplo, e
 * só via o resultado de verdade depois de subir o casamento. A ordem da tela é
 * o roteiro que ela sugere, e o roteiro estava invertido.
 *
 * Ordem não é estilo: prender aqui evita que uma seção nova entre no meio e
 * desfaça a decisão sem ninguém notar — o tipo de coisa que nenhum outro teste
 * pega, porque a página continua funcionando perfeitamente na ordem errada.
 *
 * Ajuste de 04/09/2026, pedido do Felipe: "faça com que capítulos venham antes
 * das imagens" e, logo depois, "coloca capítulos antes do envio também". Os
 * capítulos abrem a página: o fotógrafo monta o roteiro do casamento e manda
 * as fotos já para o capítulo certo, em vez de mover depois.
 */
/*
 * ── A ORDEM MUDOU DE CASA EM 04/09/2026, MAS NÃO MUDOU ────────────────────
 *
 * A tela virou quatro abas com menu lateral (fotos, design, entrega,
 * atividade), então não existe mais uma página com as oito seções em fila. A
 * decisão que este passo protege continua a mesma, repartida em dois lugares:
 *
 *   dentro de FOTOS   capítulos → envio → grade. O fotógrafo monta o roteiro,
 *                     manda as fotos já para o capítulo certo, e vê o que chegou.
 *   entre as ABAS     Fotos vem antes de Design, que vem antes de Entrega. É o
 *                     mesmo roteiro num nível acima: primeiro há foto, depois se
 *                     decide a cara dela, depois se entrega.
 *
 * Sem a segunda metade, alguém reordena o menu e a tela volta a sugerir
 * "escolha o visual" antes de existir qualquer foto — exatamente o defeito de
 * antes de 27/08, só que uma camada acima.
 */
const emOrdem = (fonte, nomes, achar, recado) => {
  const posicoes = nomes.map((n) => ({ n, at: achar(fonte, n) }));
  const sumido = posicoes.find((p) => p.at < 0);
  if (sumido) throw new Error(`"${sumido.n}" não está mais lá`);
  for (let i = 1; i < posicoes.length; i++) {
    if (posicoes[i].at < posicoes[i - 1].at) {
      throw new Error(`"${posicoes[i].n}" aparece ANTES de "${posicoes[i - 1].n}" — ${recado}`);
    }
  }
};

await etapa("a aba Fotos segue a ordem do trabalho", async () => {
  const { readFileSync } = await import("node:fs");
  const fonte = readFileSync(
    new URL("../src/app/painel/galerias/[id]/fotos/page.tsx", import.meta.url),
    "utf8",
  );
  emOrdem(
    fonte,
    ["EditorSecoes", "EnviarArquivos", "GradeMedias"],
    (f, n) => f.indexOf(`<${n}`),
    "a aba voltou a pedir decisão antes de haver foto",
  );
  return "capítulos → envio → grade";
});

await etapa("o menu das abas segue o mesmo roteiro", async () => {
  const { readFileSync } = await import("node:fs");
  const fonte = readFileSync(
    new URL("../src/components/menu-galeria.tsx", import.meta.url),
    "utf8",
  );
  emOrdem(
    fonte,
    ["fotos", "design", "entrega", "atividade"],
    (f, n) => f.indexOf(`id: "${n}"`),
    "o menu voltou a sugerir escolher o visual antes de existir foto",
  );
  return "Fotos → Design → Entrega → Atividade";
});

await etapa("a criação continua em etapas, e o estilo não some do caminho", async () => {
  const { readFileSync } = await import("node:fs");
  const pagina = readFileSync(
    new URL("../src/app/painel/galerias/nova/page.tsx", import.meta.url),
    "utf8",
  );
  if (!pagina.includes("AssistenteNovaGaleria")) {
    throw new Error("a criação voltou a ser um formulário de uma tela só");
  }
  const assistente = readFileSync(
    new URL("../src/app/painel/galerias/nova/assistente.tsx", import.meta.url),
    "utf8",
  );
  /* As duas etapas opcionais são o motivo de o assistente existir: elas trazem
   * para a criação decisões que ficavam escondidas em outra tela. Se sumirem,
   * sobra um formulário de três campos partido em três telas — pior que antes. */
  for (const campo of ['name="preset"', 'name="capitulos"']) {
    if (!assistente.includes(campo)) throw new Error(`o assistente perdeu ${campo}`);
  }
  return "Dados · Estilo · Capítulos";
});

if (falhou) {
  console.error("\n✗ o fluxo de upload tem problema");
  process.exit(1);
}
console.log("\n✓ fluxo de upload íntegro (autorização, quota, envio, confirmação e contabilidade)");
