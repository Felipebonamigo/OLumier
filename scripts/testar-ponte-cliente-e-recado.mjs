#!/usr/bin/env node
/**
 * AS DUAS METADES QUE FALTAVAM DA PONTE COM O ATOMATIZA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-ponte-cliente-e-recado.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (Juan, 01/10/2026) ───────────────────────────────────────────
 *
 * "Ter a possibilidade de conectar uma galeria com um cartão/cliente/contrato do
 * Atomatiza. Essa função já recolherá os dados automaticamente, como o email por
 * exemplo. Além disso, já integrará o feedback que as pessoas deram na galeria,
 * dentro do próprio sistema Atomatiza. Talvez como um 'registro de contato'."
 *
 * A ponte já existia: a chave de API por estúdio, `POST /api/galerias` com
 * `referenciaExterna` (o id do contrato), o retrato da entrega na ficha e o canal
 * de avisos. Faltavam duas metades, e são as deste arquivo:
 *
 *   1. O CLIENTE. A galeria nascia do contrato sem saber quem é o casal, e o
 *      fotógrafo redigitava na aba Entrega o e-mail que o Atomatiza já tinha.
 *
 *   2. O RECADO. O "feedback" do pedido é a área de recados (migração 058), que
 *      nasceu depois da ponte. O Atomatiza não tinha como saber que alguém
 *      escreveu, nem como ler.
 *
 * ── A DECISÃO QUE ESTE ARQUIVO PRENDE, E É A MAIS IMPORTANTE ──────────────
 *
 * O TEXTO DO RECADO NÃO VIAJA NO AVISO. O aviso diz "tem recado novo" e nada
 * mais; quem quiser o texto BUSCA, com a chave de API do próprio estúdio
 * (`GET /api/galerias/<id>/recados`).
 *
 * Isso mantém a regra 2 do canal (`lib/avisos.ts`: "o que vai no aviso é o
 * mínimo — nem título, nem endereço, nem nada do casal") e fecha o pior caso: um
 * aviso forjado não consegue escrever a palavra de ninguém dentro do CRM de um
 * estúdio. Ele consegue, no máximo, provocar uma busca autenticada que devolve
 * exatamente o que já era daquele estúdio.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { gerarChave } from "../src/lib/chaves-api.ts";
import { createServer } from "node:http";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
};
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const g = await galeriaDaRodada(db, { nome: "ponte", medias: 2 });
/* Escopo "leitura": a rota dos recados é de leitura, e o Atomatiza já usa
   chave de escopo largo para criar galeria. Ver `chaves-api.ts`. */
/* Escopo "envio": e a chave que o Atomatiza cola, e e ela que cria a galeria do
   contrato. A rota de leitura dos recados aceita as duas (ver escopoAtende). */
const chave = await gerarChave(g.tenant_id, "ponte de teste", "envio");
const comChave = (caminho, init = {}) =>
  fetch(`${BASE}${caminho}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${chave.segredo}`,
      ...(init.headers ?? {}),
    },
  });

/* Um servidor de mentira para receber os avisos — o mesmo recurso que o
   `testar-aviso-de-saida` usa: o canal é HTTP, então o teste pode ser o outro
   lado em vez de simular a nossa metade dele. */
const recebidos = [];
const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (p) => (corpo += p));
  req.on("end", () => {
    recebidos.push({
      corpo,
      estudio: req.headers["x-atomo-estudio"] ?? null,
      assinatura: req.headers["x-atomo-assinatura"] ?? null,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
const urlDoCanal = `http://127.0.0.1:${servidor.address().port}/galeria/aviso`;

console.log("A ponte com o Atomatiza:\n");

/* ── 1. O CLIENTE VEM DO CONTRATO ───────────────────────────────────────── */

const CONTRATO = `c0a80101-0000-4000-8000-${Date.now().toString().slice(-12)}`;
let galeriaDaPonte = null;

await etapa("criar a galeria do contrato guarda o cliente", async () => {
  const r = await comChave("/api/galerias", {
    method: "POST",
    body: JSON.stringify({
      titulo: "Casamento da ponte",
      dataEvento: "2026-12-20",
      referenciaExterna: CONTRATO,
      cliente: { nome: "Ana e Davi", email: "AnaEDavi@Exemplo.com" },
    }),
  });
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  galeriaDaPonte = corpo.id;
  const { rows: [linha] } = await db.query(
    "select cliente_nome, cliente_email, origem, origem_ref from galerias where id = $1",
    [galeriaDaPonte],
  );
  igual(linha.cliente_nome, "Ana e Davi", "nome");
  /* Minúsculas: é o mesmo endereço, e guardar como veio faria a tela sugerir
     "AnaEDavi@" enquanto a fila de e-mails grava "anaedavi@". */
  igual(linha.cliente_email, "anaedavi@exemplo.com", "e-mail");
  igual(linha.origem_ref, CONTRATO, "referência do contrato");
  return linha.cliente_email;
});

await etapa("a aba Entrega nasce com o cliente preenchido", async () => {
  const { cookieDeSessao } = await import("./sessao-de-teste.mjs");
  const r = await fetch(`${BASE}/painel/galerias/${galeriaDaPonte}/entrega`, {
    headers: { cookie: cookieDeSessao(g.tenant_id) },
    cache: "no-store",
  });
  igual(r.status, 200, "status");
  const html = await r.text();
  if (!html.includes("anaedavi@exemplo.com")) {
    throw new Error("o e-mail do contrato não aparece pré-preenchido na Entrega");
  }
  return "pré-preenchido";
});

await etapa("e-mail que não é e-mail NÃO derruba a criação da galeria", async () => {
  /*
   * O cliente vem de outro sistema, e lá o campo pode estar vazio ou com "a
   * combinar". Recusar a criação por isso faria o botão "criar a galeria desta
   * venda" falhar por causa de um campo que ninguém precisava preencher.
   */
  const r = await comChave("/api/galerias", {
    method: "POST",
    body: JSON.stringify({
      titulo: "Sem e-mail",
      referenciaExterna: `${CONTRATO}-b`,
      cliente: { nome: "A combinar", email: "a combinar" },
    }),
  });
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  const { rows: [linha] } = await db.query(
    "select cliente_nome, cliente_email from galerias where id = $1",
    [corpo.id],
  );
  igual(linha.cliente_nome, "A combinar", "nome");
  igual(linha.cliente_email, null, "e-mail descartado");
  return "nome fica, e-mail inválido some";
});

/* ── 2. O RECADO CHEGA AO OUTRO LADO ───────────────────────────────────── */

const FRASE = "Vocês entenderam exatamente o que a gente queria";

/** Liga o canal de avisos deste estúdio apontando para o servidor de mentira. */
async function ligarCanal() {
  const { temCripto } = await import("../src/lib/cripto.ts");
  /* Sem AVISOS_ENC_KEY nao da para guardar segredo de canal, e a bancada local
     nao tem a chave. A etapa PULA dizendo isso, em vez de estourar — e as duas
     etapas de carga do aviso, que nao dependem de rede, continuam valendo. */
  if (!temCripto) return false;
  const { registrarCanal } = await import("../src/lib/avisos.ts");
  await registrarCanal(g.tenant_id, urlDoCanal, "segredo-de-teste-com-32-caracteres!!");
  return true;
}

/** Deixa um recado na galeria da ponte, identificando-se antes. */
async function deixarRecado(texto) {
  await db.query(
    "update galerias set publicada = true, senha_hash = null, recado_ativo = true where id = $1",
    [galeriaDaPonte],
  );
  const r = await fetch(`${BASE}/api/g/${galeriaDaPonte}/eu`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nome: `Convidado ${Date.now()}`, motivo: "recado" }),
  });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  const envio = await fetch(`${BASE}/api/g/${galeriaDaPonte}/recado`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ texto }),
  });
  return envio;
}

await etapa("o corpo do aviso NÃO leva o texto do casal", async () => {
  /*
   * A regra 2 do canal, conferida sem rede, sem banco e sem o segredo — e é por
   * isso que `corpoDoAvisoDeRecado` existe como função. Numa bancada sem
   * `AVISOS_ENC_KEY` o envio inteiro pula; esta etapa continua valendo, e ela é a
   * que impede alguém de acrescentar `texto` ao aviso num dia apressado.
   */
  const { corpoDoAvisoDeRecado } = await import("../src/lib/avisos.ts");
  const corpo = corpoDoAvisoDeRecado({
    galeriaId: galeriaDaPonte,
    referenciaExterna: CONTRATO,
    recados: 3,
    ocorridoEm: new Date("2026-10-02T12:00:00Z"),
  });
  igual(corpo.evento, "recado.novo", "evento");
  igual(corpo.referenciaExterna, CONTRATO, "referência do contrato");
  igual(corpo.recados, 3, "contador absoluto");
  igual(corpo.ocorridoEm, "2026-10-02T12:00:00.000Z", "quando o fato aconteceu");
  /* O que NÃO pode estar lá — a lista é explícita de propósito. */
  for (const proibido of ["texto", "notas", "nome", "email", "url", "titulo"]) {
    if (proibido in corpo) {
      throw new Error(`o aviso leva \`${proibido}\` — é dado do casal numa requisição`);
    }
  }
  return Object.keys(corpo).join(", ");
});

await etapa("recado numa galeria da ponte avisa o outro lado", async () => {
  const ligou = await ligarCanal();
  recebidos.length = 0;
  const envio = await deixarRecado(FRASE);
  if (!envio.ok) throw new Error(`mandar recado: HTTP ${envio.status}`);
  if (!ligou) return "gravado; aviso pulado por falta de AVISOS_ENC_KEY nesta bancada";

  /*
   * ESPERAR, e não supor que já chegou.
   *
   * A rota manda o aviso com `after` — DEPOIS de responder ao casal, para não
   * somar o teto de quatro segundos do canal ao clique de quem está no celular.
   * Então quando a resposta volta o aviso ainda pode estar no ar, e conferir na
   * hora daria um vermelho que não é defeito nenhum.
   */
  const esperarOAviso = async () => {
    for (let i = 0; i < 40; i++) {
      const achados = recebidos
        .map((x) => JSON.parse(x.corpo))
        .filter((a) => a.evento === "recado.novo");
      if (achados.length > 0) return achados;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    return [];
  };
  const doRecado = await esperarOAviso();
  igual(doRecado.length, 1, "avisos de recado");
  igual(doRecado[0].referenciaExterna, CONTRATO, "referência");
  igual(doRecado[0].galeriaId, galeriaDaPonte, "galeria");
  if (JSON.stringify(doRecado[0]).includes(FRASE)) {
    throw new Error("o texto do recado foi no aviso");
  }
  if (!recebidos[0].assinatura) throw new Error("o aviso foi sem assinatura");
  return `recado.novo, ${doRecado[0].recados} recado(s)`;
});

await etapa("recado em galeria SEM contrato não avisa ninguém", async () => {
  const ligou = await ligarCanal();
  await db.query(
    "update galerias set publicada = true, senha_hash = null, recado_ativo = true where id = $1",
    [g.id],
  );
  recebidos.length = 0;
  const r = await fetch(`${BASE}/api/g/${g.id}/eu`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nome: `Solta ${Date.now()}`, motivo: "recado" }),
  });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  const envio = await fetch(`${BASE}/api/g/${g.id}/recado`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ texto: "galeria sem contrato" }),
  });
  if (!envio.ok) throw new Error(`HTTP ${envio.status}`);
  /* Um segundo de folga: provar AUSÊNCIA exige dar tempo de a coisa aparecer. Sem
     isso a etapa passaria mesmo com o aviso saindo, só por ser mais rápida que
     ele. */
  await new Promise((ok) => setTimeout(ok, 1000));
  igual(recebidos.length, 0, "avisos");
  return ligou ? "silêncio, como deve ser" : "silêncio (canal desligado nesta bancada)";
});

/* ── 3. QUEM TEM A CHAVE LÊ OS RECADOS ─────────────────────────────────── */

await etapa("a chave de API do estúdio lê os recados da galeria dele", async () => {
  const r = await comChave(`/api/galerias/${galeriaDaPonte}/recados`);
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`);
  if (!Array.isArray(corpo.recados)) throw new Error("a resposta não traz uma lista");
  const meu = corpo.recados.find((x) => x.texto === FRASE);
  if (!meu) throw new Error("o recado não veio na lista");
  if (!meu.id || !meu.quando) throw new Error("o recado veio sem id ou sem data");
  /* `desde` existe para o outro lado não reimportar o que já importou. */
  const sem = await comChave(`/api/galerias/${galeriaDaPonte}/recados?desde=${meu.quando}`);
  const corpo2 = await sem.json();
  if (corpo2.recados.some((x) => x.id === meu.id)) {
    throw new Error("`desde` não cortou o que já era conhecido");
  }
  return `${corpo.recados.length} recado(s)`;
});

await etapa("sem chave, ninguém lê recado", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeriaDaPonte}/recados`);
  igual(r.status, 401, "status");
});

await etapa("a chave de um estúdio NÃO lê a galeria de outro", async () => {
  /* O vazamento que importa: recado é a palavra do cliente de alguém. */
  const { segundoEstudioDaRodada } = await import("./fixture-de-teste.mjs");
  const outro = await segundoEstudioDaRodada(db);
  const chaveAlheia = await gerarChave(outro.id, "chave do vizinho", "leitura");
  const r = await fetch(`${BASE}/api/galerias/${galeriaDaPonte}/recados`, {
    headers: { authorization: `Bearer ${chaveAlheia.segredo}` },
  });
  if (r.status === 200) {
    const corpo = await r.json();
    if (JSON.stringify(corpo).includes(FRASE)) {
      throw new Error("a chave do vizinho leu o recado do cliente de outro estúdio");
    }
    throw new Error("a rota respondeu 200 para a chave de outro estúdio");
  }
  igual(r.status, 404, "status");
});

servidor.close();
await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a ponte não fecha" : "\n✓ a ponte com o Atomatiza ok");
process.exitCode = falhou ? 1 : 0;
