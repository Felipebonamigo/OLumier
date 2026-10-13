#!/usr/bin/env node
/**
 * Testa a VELOCIDADE REAL: as contas, o registro do envio e a leitura do
 * painel. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-velocidade.mjs
 *
 * Precisa do servidor de desenvolvimento rodando (a rota das medidas).
 *
 * Felipe, 30/09/2026, depois de uma queixa de download lento e outra de envio
 * que caía no mesmo dia: "temos que ter velocidade e funcionar". O envio não
 * deixava rastro nenhum — soubemos da Alícia por foto. O que esta suíte prende:
 *
 *   - amostra pequena não entra na conta (mede a ida e volta, não a banda);
 *   - a mediana e os 10% mais lentos saem certos, e na unidade do navegador;
 *   - a rota grava o lote com o navegador resumido, sem o user-agent inteiro;
 *   - galeria de OUTRO estúdio não vira vínculo (a medida fica, sem galeria);
 *   - sem sessão, ou com chave só de leitura, nada é gravado;
 *   - lote torto ou grande demais é recusado inteiro;
 *   - o painel lê o que a rota gravou.
 *
 * 13/10/2026 (migração 075), depois da Melannie (8,8 GB, 30 minutos mais lenta
 * que o Pixieset): o PUT do original ocupou 43% do tempo das seis vagas da fila
 * e o resto não tinha dono. O que esta suíte prende:
 *
 *   - as ETAPAS de cada foto (miniatura, preparo, original, confirmação,
 *     tentativas) são peneiradas, gravadas, e o painel as lê em média por
 *     estúdio, com o "perdido" que sobra do total;
 *   - navegador antigo, que não manda etapas, continua sendo gravado.
 *
 * 09/10/2026 (migração 069), depois de 153 "desistências" que eram quase todas
 * um estúdio no teto dos 10 GB do teste:
 *
 *   - a RECUSA do servidor fica marcada e fora das desistências de rede, e o
 *     painel a mostra agrupada por estúdio e motivo;
 *   - a LEVA (a pasta inteira, do primeiro ao último arquivo) é gravada e lida,
 *     e leva torta recusa o pedido.
 */
import pg from "pg";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

exigirBancoDeTeste();

const {
  resumoDeVelocidade,
  formatarVelocidade,
  navegadorResumido,
  lerMedidas,
  lerLeva,
  lerEtapas,
  formatarDuracaoCurta,
  tempoPerdido,
  SEM_ETAPAS,
  LOTE_MAXIMO_DE_MEDIDAS,
} = await import("../src/lib/velocidade-regras.ts");

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const { DATABASE_URL, SESSION_SECRET } = process.env;
if (!DATABASE_URL || !SESSION_SECRET) {
  console.error("✗ faltam DATABASE_URL ou SESSION_SECRET no .env.local");
  process.exit(1);
}

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
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const MB = 1024 * 1024;

console.log("A velocidade real — as contas\n");

await etapa("amostra pequena ou rápida demais para medir não entra", () => {
  const r = resumoDeVelocidade(
    [
      { bytes: 10 * MB, ms: 10_000 }, // 1 MB/s
      { bytes: 200 * 1024, ms: 900 }, // abaixo do piso de bytes
      { bytes: 30 * MB, ms: 150 }, // abaixo do piso de tempo
    ],
    MB,
  );
  if (!r) throw new Error("sem resumo");
  igual(r.n, 1, "amostras que valeram");
  igual(Math.round(r.mediana), MB, "mediana");
  igual(resumoDeVelocidade([{ bytes: 100, ms: 1000 }], MB), null, "nada acima do piso");
  igual(resumoDeVelocidade([]), null, "sem amostra");
  return "1 de 3";
});

await etapa("mediana e os 10% mais lentos", () => {
  /* Dez amostras de 1 a 10 MB/s, fora de ordem de propósito. */
  const amostras = [7, 2, 9, 1, 5, 10, 3, 8, 4, 6].map((v) => ({ bytes: v * MB, ms: 1000 }));
  const r = resumoDeVelocidade(amostras);
  igual(r.n, 10, "n");
  igual(r.mediana / MB, 6, "mediana (o sexto de dez)");
  igual(r.p10 / MB, 2, "p10 (o segundo de dez)");
  return `${formatarVelocidade(r.mediana)} · 10% abaixo de ${formatarVelocidade(r.p10)}`;
});

await etapa("a unidade é a do navegador", () => {
  igual(formatarVelocidade(470 * 1024), "470 KB/s", "KB/s");
  igual(formatarVelocidade(3.4 * MB), "3,4 MB/s", "MB/s com vírgula");
  igual(formatarVelocidade(MB), "1 MB/s", "exato");
  return "470 KB/s · 3,4 MB/s";
});

await etapa("o navegador vira resumo, não user-agent inteiro", () => {
  const casos = [
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "Safari · macOS"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", "Chrome · Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0", "Edge · Windows"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1", "Chrome · iPhone/iPad"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "Firefox · Linux"],
    [null, "desconhecido"],
  ];
  for (const [ua, esperado] of casos) igual(navegadorResumido(ua), esperado, String(ua).slice(0, 40));
  return `${casos.length} navegadores`;
});

await etapa("a peneira: lixo sai, o resto entra, falha não tem tempo", () => {
  const galeria = "0b8f5c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
  const r = lerMedidas([
    { galeriaId: galeria, bytes: 5 * MB, ms: 1234.6, ok: true },
    { galeriaId: "'; drop table x; --", bytes: MB, ms: 10, ok: true },
    { bytes: -1, ms: 10, ok: true },
    { bytes: "muito", ok: true },
    null,
    { bytes: 2 * MB, ms: 999, ok: false, erro: "x".repeat(500) },
  ]);
  igual(r.length, 3, "sobreviventes");
  igual(r[0].galeriaId, galeria, "uuid de verdade fica");
  igual(r[0].ms, 1235, "ms arredondado");
  igual(r[1].galeriaId, null, "texto que não é uuid vira sem galeria");
  igual(r[2].ms, null, "desistência não tem tempo de envio");
  igual(r[2].erro.length, 200, "erro com teto");
  igual(lerMedidas([]), null, "lote vazio");
  igual(lerMedidas({ bytes: 1 }), null, "não é lista");
  igual(lerMedidas(Array.from({ length: LOTE_MAXIMO_DE_MEDIDAS + 1 }, () => ({ bytes: 1, ok: true }))), null, "lote grande");
  return "3 de 6";
});

await etapa("recusa só vale em falha, e só quando o navegador diz", () => {
  const r = lerMedidas([
    { bytes: MB, ok: false, erro: "No período de teste o espaço é de 10 GB.", recusa: true },
    { bytes: MB, ok: false, erro: "conexão interrompida" },
    { bytes: MB, ok: false, erro: "x", recusa: "sim" },
    { bytes: MB, ms: 1000, ok: true, recusa: true },
  ]);
  igual(r[0].recusa, true, "recusa marcada");
  igual(r[1].recusa, false, "queda de rede");
  igual(r[2].recusa, false, "só true vale");
  igual(r[3].recusa, false, "sucesso não é recusa");
  return "1 de 4 é recusa";
});

await etapa("a peneira da leva", () => {
  const boa = lerLeva({ bytes: 300 * MB, ms: 60_000.4, arquivos: 30, falhas: 1, paralelos: 6 });
  igual(boa?.ms, 60_000, "ms arredondado");
  igual(boa?.arquivos, 30, "arquivos");
  igual(lerLeva({ bytes: 300 * MB, ms: 60_000, arquivos: 30, paralelos: 6 })?.falhas, 0, "sem falhas é zero");
  for (const torta of [
    null,
    [],
    "leva",
    { bytes: 0, ms: 1000, arquivos: 1, paralelos: 6 },
    { bytes: MB, ms: 0, arquivos: 1, paralelos: 6 },
    { bytes: MB, ms: 1000, arquivos: 0, paralelos: 6 },
    { bytes: MB, ms: 1000, arquivos: 1, paralelos: 0 },
    { bytes: MB, ms: 1000, arquivos: 1, falhas: -1, paralelos: 6 },
    { bytes: "muito", ms: 1000, arquivos: 1, paralelos: 6 },
  ]) {
    igual(lerLeva(torta), null, JSON.stringify(torta));
  }
  return "1 boa, 9 tortas";
});

await etapa("as etapas: lixo vira \"não medi\", o resto entra arredondado", () => {
  const boa = lerEtapas({
    esperaMs: 12.4,
    miniaturaMs: 800,
    preparoMs: 250.6,
    derivadasMs: 0,
    confirmarMs: 310,
    totalMs: 9000,
    tentativas: 2,
    semRede: true,
  });
  igual(boa.esperaMs, 12, "ms arredondado");
  igual(boa.preparoMs, 251, "ms arredondado para cima");
  igual(boa.derivadasMs, 0, "zero é uma medida");
  igual(boa.tentativas, 2, "tentativas");
  igual(boa.semRede, true, "sem rede");
  const torta = lerEtapas({
    esperaMs: -5,
    miniaturaMs: "muito",
    preparoMs: Infinity,
    derivadasMs: 1e12,
    confirmarMs: null,
    totalMs: "",
    tentativas: 0,
    semRede: "sim",
  });
  for (const [campo, valor] of Object.entries(torta)) igual(valor, null, `${campo} torto vira nulo`);
  for (const nada of [null, undefined, [], "etapas", 42]) {
    igual(JSON.stringify(lerEtapas(nada)), JSON.stringify(SEM_ETAPAS), `${JSON.stringify(nada)} vira sem etapas`);
  }
  return "1 boa, 8 campos tortos, 5 entradas sem etapas";
});

await etapa("o navegador antigo, sem etapas, continua entrando", () => {
  const [m] = lerMedidas([{ bytes: 5 * MB, ms: 1000, ok: true }]);
  igual(JSON.stringify(m.etapas), JSON.stringify(SEM_ETAPAS), "etapas ausentes");
  const [c] = lerMedidas([{ bytes: 5 * MB, ms: 1000, ok: true, etapas: { miniaturaMs: 700, totalMs: 2500, tentativas: 1 } }]);
  igual(c.etapas.miniaturaMs, 700, "etapa que veio");
  igual(c.etapas.preparoMs, null, "etapa que não veio");
  igual(c.etapas.semRede, null, "sem rede não veio");
  return "sem etapas e com etapas parciais";
});

await etapa("o tempo perdido é o que sobra, nunca negativo", () => {
  igual(tempoPerdido(12_900, [1000, 2000, 300, 5000, 400, 200]), 4000, "o que sobra");
  igual(tempoPerdido(12_900, [1000, null, null, 5000, null, null]), 6900, "etapa não medida não desconta");
  igual(tempoPerdido(1000, [900, 200]), 0, "soma passou do total por arredondamento");
  igual(tempoPerdido(null, [1, 2]), null, "sem total não há perdido");
  return "4 contas";
});

await etapa("a duração curta fala a língua da tela", () => {
  igual(formatarDuracaoCurta(420), "0,4 s", "décimos abaixo de 10 s");
  igual(formatarDuracaoCurta(9_960), "10,0 s", "arredonda sem virar 9,9");
  igual(formatarDuracaoCurta(12_400), "12 s", "segundos inteiros");
  igual(formatarDuracaoCurta(65_000), "1 min 5 s", "minuto e segundo");
  igual(formatarDuracaoCurta(120_000), "2 min", "minuto redondo");
  igual(formatarDuracaoCurta(119_600), "2 min", "59,6 s não vira 60 s");
  igual(formatarDuracaoCurta(-1), "—", "negativo");
  return "7 formas";
});

/* ── A rota e o painel ─────────────────────────────────────────────────── */

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const { estudioDaRodada, segundoEstudioDaRodada, galeriaDaRodada, limparRodada } = await import(
  "./fixture-de-teste.mjs"
);
const { gerarChave } = await import("../src/lib/chaves-api.ts");

try {
  const estudio = await estudioDaRodada(db);
  const vizinho = await segundoEstudioDaRodada(db);
  const minha = await galeriaDaRodada(db, { nome: "velocidade", medias: 0 });
  const dele = await galeriaDaRodada(db, { nome: "velocidade-vizinho", medias: 0, dono: vizinho });
  const cookie = cookieDeSessao(estudio.id);
  const SAFARI =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

  const postar = (corpo, cabecalhos = { cookie }) =>
    fetch(`${BASE}/api/envio/medidas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": SAFARI, ...cabecalhos },
      body: JSON.stringify(corpo),
    });
  const mandar = (medidas, cabecalhos) => postar({ medidas }, cabecalhos);
  const levas = async () =>
    (
      await db.query(
        "select bytes::float8 as bytes, ms, arquivos, falhas, paralelos, navegador from envios_levas where tenant_id = $1 order by id",
        [estudio.id],
      )
    ).rows;
  const linhas = async () =>
    (
      await db.query(
        "select galeria_id, bytes::float8 as bytes, ms, ok, erro, recusa, navegador from envios_medidos where tenant_id = $1 order by id",
        [estudio.id],
      )
    ).rows;

  console.log(`\nA velocidade real — a rota (${estudio.nome_estudio})\n`);

  await etapa("sem sessão, 401 e nada gravado", async () => {
    const r = await mandar([{ bytes: MB, ms: 1000, ok: true }], {});
    igual(r.status, 401, "status");
    igual((await linhas()).length, 0, "linhas");
    return "HTTP 401";
  });

  await etapa("chave só de leitura não grava", async () => {
    const chave = await gerarChave(estudio.id, "velocidade leitura", "leitura");
    const r = await mandar([{ bytes: MB, ms: 1000, ok: true }], { Authorization: `Bearer ${chave.segredo}` });
    igual(r.status, 401, "status");
    igual((await linhas()).length, 0, "linhas");
    return "HTTP 401";
  });

  await etapa("lote torto ou grande demais é recusado inteiro", async () => {
    const grande = Array.from({ length: LOTE_MAXIMO_DE_MEDIDAS + 1 }, () => ({ bytes: MB, ms: 1000, ok: true }));
    for (const lote of [grande, [], "nada", [{ bytes: "x" }]]) {
      const r = await mandar(lote);
      igual(r.status, 400, `status de ${JSON.stringify(lote).slice(0, 20)}`);
    }
    const torto = await fetch(`${BASE}/api/envio/medidas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: "{isto não é json",
    });
    igual(torto.status, 400, "json quebrado");
    igual((await linhas()).length, 0, "linhas");
    return "5 recusas, nada gravado";
  });

  await etapa("o lote é gravado, com o navegador resumido", async () => {
    const r = await mandar([
      { galeriaId: minha.id, bytes: 8 * MB, ms: 4000, ok: true },
      { galeriaId: minha.id, bytes: 12 * MB, ms: 3000, ok: true },
      { galeriaId: minha.id, bytes: 6 * MB, ms: null, ok: false, erro: "conexão interrompida" },
    ]);
    igual(r.status, 200, "status");
    const l = await linhas();
    igual(l.length, 3, "linhas");
    igual(l[0].galeria_id, minha.id, "galeria");
    igual(l[0].bytes, 8 * MB, "bytes");
    igual(l[0].ms, 4000, "ms");
    igual(l[2].ok, false, "desistência");
    igual(l[2].ms, null, "desistência sem tempo");
    igual(l[2].erro, "conexão interrompida", "erro");
    igual(l[0].navegador, "Safari · macOS", "navegador");
    return "2 envios e 1 desistência";
  });

  await etapa("galeria de outro estúdio não vira vínculo", async () => {
    const r = await mandar([{ galeriaId: dele.id, bytes: 2 * MB, ms: 1000, ok: true }]);
    igual(r.status, 200, "status");
    const l = await linhas();
    const ultima = l[l.length - 1];
    igual(ultima.galeria_id, null, "galeria do vizinho");
    igual(ultima.bytes, 2 * MB, "a medida fica");
    const { rows } = await db.query("select count(*)::int as n from envios_medidos where tenant_id = $1", [vizinho.id]);
    igual(rows[0].n, 0, "linhas no nome do vizinho");
    return "medida fica, vínculo não";
  });

  await etapa("a recusa é gravada marcada", async () => {
    const teto = "No período de teste o espaço é de 10 GB. Assine para liberar o espaço completo do seu plano.";
    const r = await mandar([
      { galeriaId: minha.id, bytes: 9 * MB, ok: false, erro: teto, recusa: true },
      { galeriaId: minha.id, bytes: 9 * MB, ok: false, erro: teto, recusa: true },
    ]);
    igual(r.status, 200, "status");
    const l = await linhas();
    const recusas = l.filter((x) => x.recusa);
    igual(recusas.length, 2, "recusas");
    igual(l.filter((x) => !x.ok && !x.recusa).length, 1, "a queda de rede de antes continua queda");
    return "2 recusas, 1 queda";
  });

  await etapa("a leva é gravada, sozinha ou com medidas", async () => {
    const sozinha = await postar({ leva: { bytes: 250 * MB, ms: 50_000, arquivos: 10, falhas: 1, paralelos: 6 } });
    igual(sozinha.status, 200, "status da leva sozinha");
    const junto = await postar({
      medidas: [{ galeriaId: minha.id, bytes: 5 * MB, ms: 2000, ok: true }],
      leva: { bytes: 60 * MB, ms: 30_000, arquivos: 4, paralelos: 6 },
    });
    igual(junto.status, 200, "status junto");
    const l = await levas();
    igual(l.length, 2, "levas");
    igual(l[0].bytes, 250 * MB, "bytes");
    igual(l[0].falhas, 1, "falhas");
    igual(l[1].falhas, 0, "falhas ausentes viram zero");
    igual(l[0].navegador, "Safari · macOS", "navegador");
    return "2 levas";
  });

  await etapa("leva torta recusa o pedido inteiro", async () => {
    const antes = (await linhas()).length;
    for (const corpo of [
      { leva: { bytes: 0, ms: 1, arquivos: 1, paralelos: 6 } },
      { leva: "x" },
      { medidas: [{ bytes: MB, ms: 1000, ok: true }], leva: { ms: 1000 } },
      {},
    ]) {
      const r = await postar(corpo);
      igual(r.status, 400, `status de ${JSON.stringify(corpo).slice(0, 40)}`);
    }
    igual((await levas()).length, 2, "levas");
    igual((await linhas()).length, antes, "medidas");
    const intrusa = await postar({ leva: { bytes: MB, ms: 1000, arquivos: 1, paralelos: 6 } }, {});
    igual(intrusa.status, 401, "sem sessão");
    return "4 recusas e 1 sem sessão, nada gravado";
  });

  await etapa("as etapas são gravadas junto da medida", async () => {
    const etapas = (extra = {}) => ({
      esperaMs: 1000,
      miniaturaMs: 2000,
      preparoMs: 300,
      derivadasMs: 400,
      confirmarMs: 200,
      totalMs: 12_900,
      tentativas: 1,
      semRede: false,
      ...extra,
    });
    /* Seis fotos que subiram (o piso do painel é de cinco), duas delas com a
       tentativa refeita, uma delas depois de ficar sem rede. O PUT de cada
       uma foi de 5 s; o total, 12,9 s: sobram 4 s perdidos em todas. */
    const fotos = [
      etapas(),
      etapas(),
      etapas(),
      etapas(),
      etapas({ tentativas: 2 }),
      etapas({ tentativas: 3, semRede: true }),
    ].map((e) => ({ galeriaId: minha.id, bytes: 8 * MB, ms: 5000, ok: true, etapas: e }));
    const r = await mandar(fotos);
    igual(r.status, 200, "status");
    const { rows } = await db.query(
      `select espera_ms, miniatura_ms, preparo_ms, derivadas_ms, confirmar_ms, total_ms, tentativas, sem_rede
         from envios_medidos where tenant_id = $1 and total_ms is not null order by id`,
      [estudio.id],
    );
    igual(rows.length, 6, "linhas com etapas");
    igual(rows[0].miniatura_ms, 2000, "miniatura");
    igual(rows[0].total_ms, 12_900, "total");
    igual(rows[0].tentativas, 1, "tentativas");
    igual(rows[0].sem_rede, false, "sem rede");
    igual(rows[5].tentativas, 3, "foto refeita duas vezes");
    igual(rows[5].sem_rede, true, "ficou sem rede");
    /* As do começo do arquivo, de antes das etapas, ficaram sem elas. */
    const antigas = await db.query(
      "select count(*)::int as n from envios_medidos where tenant_id = $1 and total_ms is null",
      [estudio.id],
    );
    if (antigas.rows[0].n < 3) throw new Error(`as linhas de antes deviam seguir sem etapas: ${antigas.rows[0].n}`);
    return "6 fotos com etapas; as de antes seguem sem";
  });

  await etapa("etapa torta não derruba a medida", async () => {
    const r = await mandar([
      {
        galeriaId: minha.id,
        bytes: 4 * MB,
        ms: 2000,
        ok: true,
        etapas: { esperaMs: "dois", miniaturaMs: -1, totalMs: 1e15, tentativas: "x", semRede: "talvez" },
      },
    ]);
    igual(r.status, 200, "status");
    const { rows } = await db.query(
      "select espera_ms, miniatura_ms, total_ms, tentativas, sem_rede from envios_medidos where tenant_id = $1 order by id desc limit 1",
      [estudio.id],
    );
    for (const [campo, valor] of Object.entries(rows[0])) igual(valor, null, `${campo} torto vira nulo`);
    return "a medida entra, as etapas tortas viram nulas";
  });

  await etapa("o painel lê o que a rota gravou", async () => {
    const { velocidadeReal } = await import("../src/lib/velocidade.ts");
    const v = await velocidadeReal();
    /* O banco de teste é compartilhado: outras rodadas somam amostras. As
       nossas três de sucesso passam do piso, então o total é pelo menos 3. */
    if (!v.envio || v.envio.n < 3) throw new Error(`envio: ${JSON.stringify(v.envio)}`);
    if (v.falhas.n < 1 || v.falhas.estudios < 1) throw new Error(`falhas: ${JSON.stringify(v.falhas)}`);
    const nossa = v.falhas.ultimas.find((f) => f.estudio === estudio.nome_estudio);
    if (nossa && nossa.navegador !== "Safari · macOS") throw new Error(`navegador: ${nossa.navegador}`);
    if (v.falhas.ultimas.some((f) => f.erro?.startsWith("No período de teste"))) {
      throw new Error("recusa do plano apareceu entre as quedas de rede");
    }
    const grupo = v.recusas.grupos.find((g) => g.estudio === estudio.nome_estudio);
    if (!grupo || grupo.n !== 2) throw new Error(`recusas agrupadas: ${JSON.stringify(v.recusas)}`);
    /* A leva de 250 MB em 50 s passa do piso (20 MB, 3 arquivos). */
    if (!v.leva || v.leva.n < 2) throw new Error(`leva: ${JSON.stringify(v.leva)}`);
    /* As etapas: seis fotos com 1 s de espera, 2 s de miniatura, 0,3 s de
       preparo, 5 s de PUT, 0,4 s de miniaturas e 0,2 s de confirmação em 12,9 s
       — sobram 4 s perdidos em cada uma. */
    const tabela = await velocidadeReal(30, 7, 1000);
    const dele = tabela.etapas.porEstudio.find((e) => e.estudio === estudio.nome_estudio);
    if (!dele) throw new Error(`o estúdio não aparece nas etapas: ${JSON.stringify(tabela.etapas.porEstudio.map((e) => e.estudio))}`);
    igual(dele.n, 6, "fotos nas etapas");
    igual(Math.round(dele.esperaMs), 1000, "espera média");
    igual(Math.round(dele.miniaturaMs), 2000, "miniatura média");
    igual(Math.round(dele.preparoMs), 300, "preparo médio");
    igual(Math.round(dele.envioMs), 5000, "PUT médio");
    igual(Math.round(dele.derivadasMs), 400, "miniaturas médias");
    igual(Math.round(dele.confirmarMs), 200, "confirmação média");
    igual(Math.round(dele.perdidoMs), 4000, "perdido médio");
    igual(Math.round(dele.totalMs), 12_900, "total médio");
    igual(Math.round(dele.comRetentativa * 100), 33, "fotos com 2ª tentativa (2 de 6)");
    igual(Math.round(dele.comQuedaDeRede * 100), 17, "fotos que ficaram sem rede (1 de 6)");
    if (!tabela.etapas.geral || tabela.etapas.geral.n < 6) throw new Error(`geral: ${JSON.stringify(tabela.etapas.geral)}`);
    /* O estúdio do vizinho não tem foto medida por etapa: abaixo do piso, fora. */
    if (tabela.etapas.porEstudio.some((e) => e.estudio === vizinho.nome_estudio)) {
      throw new Error("estúdio sem fotos medidas apareceu nas etapas");
    }
    return `envio ${formatarVelocidade(v.envio.mediana)} (n=${v.envio.n}) · pasta ${formatarVelocidade(v.leva.mediana)} (n=${v.leva.n}) · ${v.falhas.n} queda(s) · ${v.recusas.n} recusa(s)`;
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ a velocidade real tem problema" : "\n✓ a velocidade real é medida e aparece no painel");
process.exitCode = falhou ? 1 : 0;
