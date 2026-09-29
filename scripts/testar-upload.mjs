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

/*
 * ── O NAVEGADOR QUE NÃO SABE O QUE É UM HEIC (29/09/2026) ─────────────────
 *
 * A Carol tentou subir uma galeria nova e recebeu "0 de 74 — 33 com erro", e
 * subindo. Nada no servidor: a recusa é 415, resposta esperada, não exceção.
 *
 * A causa é o Windows. `File.type` sai do registro do sistema, e o Windows não
 * traz mime para `.heic`/`.heif` sem a extensão da Microsoft instalada — o
 * navegador manda string VAZIA. O servidor lia só o mime, não achava no mapa e
 * recusava TODOS os arquivos, com uma mensagem que culpa o arquivo ("tipo não
 * aceito") por uma lacuna do sistema operacional. E a zona de envio anuncia
 * HEIC na própria tela.
 *
 * O nome do arquivo é a única pista que sempre chega. Ele não vale MAIS que o
 * mime — vale QUANDO o mime não diz nada. A ordem importa: mime conhecido
 * manda, porque é o único dos dois que o navegador conferiu.
 */
await etapa("HEIC sem mime (Windows) é aceito pela extensão", async () => {
  for (const nome of ["IMG_4471.HEIC", "familia.heif", "foto.heic"]) {
    const r = await fetch(`${BASE}/api/galerias/${galeria.id}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ nome, mime: "", bytes: 2_500_000 }),
    });
    if (r.status === 415) {
      const { erro } = await r.json();
      throw new Error(`${nome} recusado: ${erro}`);
    }
    if (!r.ok) throw new Error(`${nome}: HTTP ${r.status}`);
  }
  return "3 aceitos";
});

await etapa("extensão desconhecida continua recusada, mesmo sem mime", async () => {
  /* A saída pela extensão não pode virar porta dos fundos: sem mime E sem
     extensão conhecida, a recusa é a mesma de sempre. */
  for (const nome of ["virus.exe", "backup.zip", "sem-extensao"]) {
    const r = await fetch(`${BASE}/api/galerias/${galeria.id}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ nome, mime: "", bytes: 100 }),
    });
    if (r.status !== 415) throw new Error(`${nome} passou com ${r.status}`);
  }
  return "3 recusados";
});

await etapa("mime conhecido continua mandando na decisão", async () => {
  /* Extensão mentindo (um JPEG chamado .png) segue o MIME, que é o que o
     navegador de fato conferiu. */
  const r = await fetch(`${BASE}/api/galerias/${galeria.id}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nome: "retrato.png", mime: "image/jpeg", bytes: 1000 }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return "mime vence a extensão";
});

/*
 * ── A TELA AVISA ANTES, EM VEZ DE DEIXAR TENTAR (29/09/2026) ──────────────
 *
 * A Carol arrastou 74 fotos e recebeu "0 de 74 — 33 com erro", com o motivo
 * escondido numa lista que só aparece expandindo a barra. A trava do servidor
 * estava certa — o e-mail da conta nova dela nunca foi confirmado — mas quem
 * usa não descobre isso arrastando uma pasta de casamento e vendo erro subir.
 *
 * Felipe: "para que os usuários não tenham o mesmo erro, não permita que eles
 * tentem publicar as imagens sem ter confirmado o e-mail".
 *
 * A trava do servidor FICA (ela é quem protege de verdade, e um cliente pode
 * chamar a rota sem passar pela tela). O que muda é a tela deixar de oferecer
 * o que vai recusar.
 */
/*
 * A NEGATIVA NÃO É EXERCITÁVEL AQUI, e é honesto dizer por quê: a regra é
 * "e-mail LIGADO e não confirmado", e no desenvolvimento o envio de e-mail está
 * desligado — então não existe estado pendente para reproduzir por HTTP. As
 * três combinações da regra já estão presas, puras, em
 * `testar-cadastro-protegido.mjs`. O que falta prender é a LIGAÇÃO: a aba Fotos
 * consultar essa regra e não desenhar o que vai ser recusado.
 */
await etapa("a aba Fotos decide o envio pela mesma regra do aviso do painel", async () => {
  const { readFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const raiz = path.resolve(import.meta.dirname, "..");
  const pagina = readFileSync(
    path.join(raiz, "src/app/painel/galerias/[id]/fotos/page.tsx"),
    "utf8",
  );
  if (!/precisaConfirmarEmail/.test(pagina)) {
    throw new Error("a aba Fotos não pergunta se o e-mail está pendente");
  }
  /* E que a zona de envio dependa dessa resposta — não basta importar. */
  const trecho = pagina.match(/<EnviarArquivos[^]*?\/>/)?.[0] ?? "";
  if (!trecho) throw new Error("não achei a zona de envio na página");
  const antesDaZona = pagina.slice(0, pagina.indexOf("<EnviarArquivos"));
  if (!/emailPendente|precisaConfirmarEmail\(/.test(antesDaZona)) {
    throw new Error("a zona de envio não olha o estado do e-mail antes de aparecer");
  }
  /* E que exista explicação no lugar dela: sumir sem dizer por quê é pior que
     o erro de antes. */
  if (!/EnvioBloqueadoPorEmail|confirm/i.test(pagina)) {
    throw new Error("sumiu o envio e não explicou por quê");
  }
  return "pergunta antes de oferecer";
});

await etapa("com o e-mail confirmado, a zona de envio volta", async () => {
  const html = await (
    await fetch(`${BASE}/painel/galerias/${galeria.id}/fotos`, {
      headers: { cookie },
      cache: "no-store",
    })
  ).text();
  if (!/Arraste a pasta do casamento aqui/.test(html)) {
    throw new Error("a zona de envio não voltou para quem confirmou");
  }
  return "envio normal";
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

/*
 * ── APAGAR TUDO DE UMA VEZ (05/09/2026) ───────────────────────────────────
 *
 * Juan: "botei as fotos aqui e fui pro design, daí parou de subir. Mas como
 * encerrou no meio, quero excluir as que já subiram e refazer a ação". A saída
 * dele era remover 519 arquivos um a um, clicando em "remover" em cada cartão.
 *
 * As duas etapas abaixo são a mesma rota vista dos dois lados: ela apaga tudo
 * da galeria de quem pediu, e NÃO enxerga a galeria de mais ninguém.
 */
/*
 * ── A FILA NÃO PODE VOLTAR PARA DENTRO DA ABA ─────────────────────────────
 *
 * O envio do Juan morreu quando ele foi para o Design, e a causa era o LUGAR:
 * a fila vivia no componente da rota `/fotos`, que é desmontado ao trocar de
 * aba. Mover para o layout resolveu — e é o tipo de correção que uma
 * "simplificação" futura desfaz sem perceber, porque o código volta a
 * funcionar na aba Fotos.
 */
await etapa("a fila de envio mora no layout, não na aba", async () => {
  const { readFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const raiz = path.resolve(import.meta.dirname, "..");
  const layout = readFileSync(
    path.join(raiz, "src/app/painel/galerias/[id]/layout.tsx"),
    "utf8",
  );
  if (!/<ProvedorDeEnvio/.test(layout)) {
    throw new Error("o layout não monta o ProvedorDeEnvio — trocar de aba mata o envio de novo");
  }
  const zona = readFileSync(path.join(raiz, "src/components/enviar-arquivos.tsx"), "utf8");
  if (/useState<ItemFila|emParalelo\(/.test(zona)) {
    throw new Error("a fila voltou para dentro da aba Fotos");
  }
  if (!/useEnvio\(\)/.test(zona)) {
    throw new Error("a zona de arrastar não fala com o provedor");
  }
  return "provedor no layout, zona de arrastar sem estado de envio";
});

console.log("\nApagar todas as fotos:\n");

await etapa("apaga todas as fotos da galeria de uma vez", async () => {
  const { rows: antes } = await db.query(
    "select count(*)::int as n from medias where galeria_id = $1",
    [galeria.id],
  );
  if (antes[0].n === 0) throw new Error("a bancada veio sem foto — o teste não provaria nada");

  const r = await fetch(`${BASE}/api/galerias/${galeria.id}/medias`, {
    method: "DELETE",
    headers: { cookie },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const corpo = await r.json();

  const { rows: depois } = await db.query(
    "select count(*)::int as n from medias where galeria_id = $1",
    [galeria.id],
  );
  if (depois[0].n !== 0) throw new Error(`sobraram ${depois[0].n} de ${antes[0].n}`);
  if (corpo.apagadas !== antes[0].n) {
    throw new Error(`disse ter apagado ${corpo.apagadas}, eram ${antes[0].n}`);
  }
  return `${corpo.apagadas} de uma vez`;
});

await etapa("não apaga foto de galeria de outro estúdio", async () => {
  /* Um tenant DE VERDADE, inserido à mão: `estudioDaRodada` guarda o primeiro
     e devolve sempre o mesmo, então pedir "outro estúdio" por ali devolveria
     este — e o teste passaria a apagar as próprias fotos, provando nada. */
  const { rows: tv } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status)
          values ($1, 'Vizinho', $2, 'x', $3, 'ativo') returning id`,
    [`vizinho-${galeria.id.slice(0, 8)}`, `vizinho-${galeria.id.slice(0, 8)}@teste.local`, String(1024 ** 4)],
  );
  const vizinho = tv[0];
  const { rows: gv } = await db.query(
    `insert into galerias (tenant_id, slug, titulo, publicada, estado)
          values ($1, $2, 'Galeria do vizinho', false, 'online') returning id`,
    [vizinho.id, `vizinho-apagar-tudo-${galeria.id.slice(0, 8)}`],
  );
  const alheia = gv[0].id;
  try {
    for (let i = 0; i < 2; i++) {
      await db.query(
        `insert into medias (galeria_id, tenant_id, nome_original, mime, tipo, bytes, chave, ordem, pronto)
              values ($1, $2, $3, 'image/jpeg', 'foto', 1024, $4, $5, true)`,
        [alheia, vizinho.id, `vizinho-${i}.jpg`, `${vizinho.id}/${alheia}/vizinho-${i}.jpg`, i],
      );
    }
    const r = await fetch(`${BASE}/api/galerias/${alheia}/medias`, {
      method: "DELETE",
      headers: { cookie },
    });
    const { rows } = await db.query(
      "select count(*)::int as n from medias where galeria_id = $1",
      [alheia],
    );
    if (rows[0].n !== 2) throw new Error(`apagou ${2 - rows[0].n} foto(s) de outro estúdio!`);
    if (r.status !== 404) throw new Error(`devolveu HTTP ${r.status}, esperava 404`);
    return "404, e as duas fotos continuam lá";
  } finally {
    await db.query("delete from galerias where id = $1", [alheia]);
    await db.query("delete from tenants where id = $1", [vizinho.id]);
  }
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
