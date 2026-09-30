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
 */
import pg from "pg";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

exigirBancoDeTeste();

const { resumoDeVelocidade, formatarVelocidade, navegadorResumido, lerMedidas, LOTE_MAXIMO_DE_MEDIDAS } =
  await import("../src/lib/velocidade-regras.ts");

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

  const mandar = (medidas, cabecalhos = { cookie }) =>
    fetch(`${BASE}/api/envio/medidas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": SAFARI, ...cabecalhos },
      body: JSON.stringify({ medidas }),
    });
  const linhas = async () =>
    (
      await db.query(
        "select galeria_id, bytes::float8 as bytes, ms, ok, erro, navegador from envios_medidos where tenant_id = $1 order by id",
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

  await etapa("o painel lê o que a rota gravou", async () => {
    const { velocidadeReal } = await import("../src/lib/velocidade.ts");
    const v = await velocidadeReal();
    /* O banco de teste é compartilhado: outras rodadas somam amostras. As
       nossas três de sucesso passam do piso, então o total é pelo menos 3. */
    if (!v.envio || v.envio.n < 3) throw new Error(`envio: ${JSON.stringify(v.envio)}`);
    if (v.falhas.n < 1 || v.falhas.estudios < 1) throw new Error(`falhas: ${JSON.stringify(v.falhas)}`);
    const nossa = v.falhas.ultimas.find((f) => f.estudio === estudio.nome_estudio);
    if (nossa && nossa.navegador !== "Safari · macOS") throw new Error(`navegador: ${nossa.navegador}`);
    return `envio ${formatarVelocidade(v.envio.mediana)} (n=${v.envio.n}) · ${v.falhas.n} desistência(s)`;
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ a velocidade real tem problema" : "\n✓ a velocidade real é medida e aparece no painel");
process.exitCode = falhou ? 1 : 0;
