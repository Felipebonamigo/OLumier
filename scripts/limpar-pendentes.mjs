#!/usr/bin/env node
/**
 * Solta a quota presa por envio que nunca terminou. Roda todo dia no servidor.
 *
 *   node --env-file=.env.production --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/limpar-pendentes.mjs
 *
 * O PROBLEMA: a linha em `medias` nasce com `pronto = false` para reservar
 * espaço antes do envio começar — sem isso, dois uploads simultâneos furariam a
 * quota juntos. Mas se o envio morre no meio (aba fechada, internet caiu,
 * celular bloqueou), a reserva fica lá para sempre: o fotógrafo perde espaço do
 * plano por um arquivo que não existe, e não tem como ver nem soltar isso pelo
 * painel.
 *
 * O QUE FAZ: mídia pendente há mais de 24h vira uma de duas coisas —
 *   - o arquivo ESTÁ no bucket → foi só a confirmação que se perdeu; confirma
 *     com o tamanho real e a foto aparece para o cliente;
 *   - o arquivo NÃO está → envio abandonado; remove a linha e devolve a quota.
 *
 * As 24h não são chute: um filme grande em conexão ruim leva horas, e um envio
 * em partes pode ser retomado. Cortar cedo apagaria trabalho em andamento.
 */
import pg from "pg";
import { conferirObjeto, apagarObjetos, abortarEnvioEmPartes } from "../src/lib/r2.ts";

const HORAS = Number(process.env.HORAS_PENDENTE ?? 24);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const { rows: pendentes } = await db.query(
    `select m.id, m.chave, m.chave_thumb, m.chave_preview, m.upload_id,
            m.nome_original, m.bytes, m.tenant_id, t.nome_estudio
       from medias m
       join tenants t on t.id = m.tenant_id
      where m.pronto = false
        and m.criado_em < now() - ($1 || ' hours')::interval`,
    [String(HORAS)],
  );

  if (pendentes.length === 0) {
    console.log(`[${new Date().toISOString()}] nenhum envio pendente há mais de ${HORAS}h`);
    process.exit(0);
  }

  console.log(
    `[${new Date().toISOString()}] ${pendentes.length} envio(s) parado(s) há mais de ${HORAS}h`,
  );

  let resgatados = 0;
  let removidos = 0;
  let bytesLiberados = 0n;

  for (const m of pendentes) {
    let chegou = null;
    try {
      chegou = await conferirObjeto(m.chave);
    } catch {
      chegou = null;
    }

    if (chegou) {
      // Estava tudo certo — só a confirmação se perdeu. Melhor entregar a foto
      // ao cliente do que apagar o trabalho de alguém.
      await db.query("update medias set bytes = $1, pronto = true, upload_id = null where id = $2", [
        chegou.bytes,
        m.id,
      ]);
      resgatados++;
      console.log(`  ↑ resgatado: ${m.nome_original} (${m.nome_estudio})`);
      continue;
    }

    // Envio em partes inacabado ocupa espaço pago sem aparecer na listagem —
    // abortar é o que devolve esse espaço de verdade.
    if (m.upload_id) {
      await abortarEnvioEmPartes(m.chave, m.upload_id).catch(() => {});
    }
    await apagarObjetos(
      [m.chave_thumb, m.chave_preview].filter(Boolean),
    ).catch(() => {});

    await db.query("delete from medias where id = $1", [m.id]);
    removidos++;
    bytesLiberados += BigInt(m.bytes ?? 0);
    console.log(`  × removido: ${m.nome_original} (${m.nome_estudio})`);
  }

  const gb = Number(bytesLiberados) / 1024 ** 3;
  console.log(
    `  resumo: ${resgatados} resgatado(s), ${removidos} removido(s), ` +
      `${gb >= 0.01 ? gb.toFixed(2) + " GB" : bytesLiberados + " B"} de quota devolvida`,
  );
} finally {
  await db.end();
}
