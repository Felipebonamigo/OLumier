#!/usr/bin/env node
/**
 * Solta a quota presa por envio que nunca terminou.
 *
 *   node --env-file=.env.production --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/limpar-pendentes.mjs
 *
 * RODA TODO DIA às 04:30, como o SEGUNDO `ExecStart` do `fotonio-cofre.service`
 * — não existe unidade com o nome deste script, e é por isso que procurar por
 * `fotonio-pendentes` não acha nada. O log de produção mostra as execuções.
 *
 * Este parágrafo já disse "⚠ NÃO RODA SOZINHO", em 26/08/2026, e era falso: eu
 * procurei a agenda pelo NOME do script em vez de procurar o script dentro das
 * agendas, não achei, e escrevi a conclusão errada aqui. Ficou no repositório
 * por pouco tempo e é registrado porque o engano é atraente: unidade não se
 * chama como o script que ela chama, e `ops/fotonio-cofre.service` está
 * versionado dizendo o contrário desde sempre.
 *
 * Isso importa para quem for mexer no que vem abaixo: este código apaga linha de
 * banco sozinho, de madrugada, sem ninguém olhando. `scripts/testar-temporizadores.mjs`
 * agora prende as duas pontas.
 *
 * O PROBLEMA: a linha em `medias` nasce com `pronto = false` para reservar
 * espaço antes do envio começar — sem isso, dois uploads simultâneos furariam a
 * quota juntos. Mas se o envio morre no meio (aba fechada, internet caiu,
 * celular bloqueou), a reserva fica lá para sempre: o fotógrafo perde espaço do
 * plano por um arquivo que não existe, e não tem como ver nem soltar isso pelo
 * painel.
 *
 * O QUE FAZ: mídia pendente há mais de 24h vira uma de TRÊS coisas —
 *   - o arquivo ESTÁ no armazém → foi só a confirmação que se perdeu; confirma
 *     com o tamanho real e a foto aparece para o cliente;
 *   - o arquivo NÃO está → envio abandonado; remove a linha e devolve a quota;
 *   - não deu para PERGUNTAR → adia, e ela volta amanhã.
 *
 * A terceira entrou em 26/08/2026 junto com a correção do defeito, e é ela que
 * separa este script de um que perde foto. "Não achei" é resposta; "não
 * consegui perguntar" não é. Este script roda sozinho, de madrugada, sem
 * ninguém olhando — no dia em que o armazém tivesse instabilidade, tratar as
 * duas coisas igual apagaria o trabalho de um estúdio inteiro.
 *
 * A regra da decisão mora em `src/lib/pendentes.ts`, não aqui. Dentro do script
 * ela procurava o arquivo SEMPRE no R2, ignorando `medias.armazem`, e apagava
 * mídia do B2 que estava lá inteira — e não havia como testá-la sem um armazém
 * de verdade. `scripts/testar-pendentes.mjs` prende cada caso.
 *
 * As 24h não são chute: um filme grande em conexão ruim leva horas, e um envio
 * em partes pode ser retomado. Cortar cedo apagaria trabalho em andamento.
 */
import pg from "pg";
import { apagarObjetos } from "../src/lib/r2.ts";
import { abortarEnvioDoOriginal, armazemDe } from "../src/lib/armazem.ts";
import { decidirPendente } from "../src/lib/pendentes.ts";

const HORAS = Number(process.env.HORAS_PENDENTE ?? 24);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const { rows: pendentes } = await db.query(
    `select m.id, m.chave, m.chave_thumb, m.chave_preview, m.upload_id, m.armazem,
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
  let adiados = 0;
  let bytesLiberados = 0n;

  for (const m of pendentes) {
    /* A regra mora em `lib/pendentes.ts`, e não aqui, desde 26/08/2026: dentro
     * do script ela procurava o arquivo SEMPRE no R2 e apagava mídia do B2 que
     * estava lá inteira. Aqui era impossível testá-la sem um armazém de
     * verdade; lá é uma função de uma consulta injetável. */
    const decisao = await decidirPendente(m);

    if (decisao.acao === "resgatar") {
      // Estava tudo certo — só a confirmação se perdeu. Melhor entregar a foto
      // ao cliente do que apagar o trabalho de alguém.
      await db.query("update medias set bytes = $1, pronto = true, upload_id = null where id = $2", [
        decisao.bytes,
        m.id,
      ]);
      resgatados++;
      console.log(`  ↑ resgatado: ${m.nome_original} (${m.nome_estudio})`);
      continue;
    }

    if (decisao.acao === "adiar") {
      /* Não deu para PERGUNTAR ao armazém. A mídia fica e volta amanhã: o custo
       * de esperar é quota reservada, o de errar é a foto do casamento. Sai no
       * log porque adiamento que se repete todo dia é sintoma, não rotina. */
      adiados++;
      console.log(`  … adiado: ${m.nome_original} (${m.nome_estudio}) — o armazém não respondeu`);
      continue;
    }

    // Envio em partes inacabado ocupa espaço pago sem aparecer na listagem —
    // abortar é o que devolve esse espaço de verdade. Vai pelo despachante,
    // porque partes abertas no B2 não se abortam pelo R2.
    if (m.upload_id) {
      await abortarEnvioDoOriginal(m.chave, m.upload_id, armazemDe(m.armazem)).catch(() => {});
    }
    // As derivadas ficam no R2 sempre, por desenho — estas não passam pelo despachante.
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
    `  resumo: ${resgatados} resgatado(s), ${removidos} removido(s)` +
      `${adiados ? `, ${adiados} adiado(s)` : ""}, ` +
      `${gb >= 0.01 ? gb.toFixed(2) + " GB" : bytesLiberados + " B"} de quota devolvida`,
  );
} finally {
  await db.end();
}
