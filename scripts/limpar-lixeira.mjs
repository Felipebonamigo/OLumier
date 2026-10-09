#!/usr/bin/env node
/**
 * Destrói de vez o que passou do prazo na lixeira.
 *
 *   ... scripts/limpar-lixeira.mjs              → mostra o que venceu (não apaga)
 *   ... scripts/limpar-lixeira.mjs --aplicar    → apaga
 *   ... --aplicar --liberar-teto                  → à mão, depois de um alerta de teto
 *
 * Roda pelo temporizador do servidor, de madrugada. É o único lugar do sistema
 * que apaga arquivo de galeria de verdade — apagar no painel só move para a
 * lixeira.
 *
 * Aqui havia a ressalva de que o ESPELHO não era tocado, porque a segunda cópia
 * era o que sobrava quando tudo mais falhava. O espelho foi removido em
 * 27/08/2026 (ver `scripts/testar-sem-espelho.mjs`), então esta limpeza apaga a
 * única cópia existente. O prazo da lixeira é o que separa o engano do
 * definitivo — e é a última rede que sobrou.
 *
 * ── E O TESTE ABANDONADO (28/09/2026) ─────────────────────────────────────
 *
 * Depois da lixeira, a mesma rodada cuida dos testes grátis vencidos há mais
 * de um mês: avisa por e-mail, avisa de novo, e aos 60 dias apaga os arquivos
 * (`src/lib/testes-abandonados.ts`). Mora AQUI, e não num temporizador próprio,
 * porque o deploy publica os scripts mas não instala unidade nova do systemd —
 * um `.timer` novo ficaria no repositório sem nunca rodar. Esta unidade já
 * está instalada e já roda todo dia.
 */
import pg from "pg";
import { galeriasVencidasNaLixeira, destruirGaleria, PRAZO_LIXEIRA_DIAS } from "../src/lib/tenants.ts";
import { rodarLimpezaDeTestes, TETO_POR_RODADA } from "../src/lib/testes-abandonados.ts";
import { rodarRetencaoDeContasEncerradas } from "../src/lib/contas-encerradas.ts";
import { fechamentoDoMes, gravarFechamentoDoMes } from "../src/lib/fechamento-mensal.ts";

const APLICAR = process.argv.includes("--aplicar");
/* Só à mão, depois de conferir a lista do alerta — ver "o teto" em
   src/lib/testes-abandonados.ts. O temporizador nunca passa isto. */
const LIBERAR_TETO = process.argv.includes("--liberar-teto");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  /* Os pedidos de ZIP vencem em 12 h (migração 039) e não têm outro faxineiro.
     As entregas registradas ficam: a FK põe null no pedido, e os bytes seguem
     somando no painel. Corre sempre, mesmo sem --aplicar: é lixo, não galeria. */
  const { rowCount: pedidos } = await db.query(`delete from pedidos_zip where expira_em < now()`);
  if (pedidos) console.log(`pedidos de zip vencidos apagados: ${pedidos}`);

  const { rows: resumo } = await db.query(
    `select count(*)::int as na_lixeira,
            count(*) filter (where apagada_em < now() - ($1 || ' days')::interval)::int as vencidas
       from galerias where estado = 'lixeira'`,
    [PRAZO_LIXEIRA_DIAS],
  );
  console.log(`na lixeira: ${resumo[0].na_lixeira} · vencidas: ${resumo[0].vencidas}`);

  const vencidas = await galeriasVencidasNaLixeira();
  if (vencidas.length === 0) {
    console.log("✓ nada a destruir");
  } else {
    for (const g of vencidas) {
      console.log(`  ${g.titulo} — ${g.chaves.length} arquivo(s)`);
    }

    if (!APLICAR) {
      console.log(`\nNada foi apagado. Para apagar: --aplicar`);
    } else {
      let destruidas = 0;
      for (const g of vencidas) {
        await destruirGaleria(g.id);
        destruidas++;
      }
      console.log(`\n✓ ${destruidas} galeria(s) destruída(s) depois de ${PRAZO_LIXEIRA_DIAS} dias`);
    }
  }

  /* ── o teste abandonado ─────────────────────────────────────────────────
     Em bloco próprio: uma falha aqui não pode desfazer a limpeza da lixeira
     acima, nem o contrário. */
  console.log("\ntestes abandonados");
  try {
    const r = await rodarLimpezaDeTestes({ aplicar: APLICAR, liberarTeto: LIBERAR_TETO });
    if (!r.ligada) {
      console.log("  desligada — precisa do e-mail E da cobrança ligados; nada foi avisado nem apagado");
    } else {
      for (const l of r.linhas) console.log(`  ${l}`);
      console.log(
        `  ${APLICAR ? "✓" : "(simulação)"} avisos: ${r.avisos} · avisos finais: ${r.avisosFinais} · ` +
          `contas limpas: ${r.apagadas}` +
          (r.falhasDeEnvio ? ` · e-mails que não saíram: ${r.falhasDeEnvio} (tentam amanhã)` : "") +
          (r.travadasPeloTeto
            ? ` · PARADA PELO TETO (${r.travadasPeloTeto} > ${TETO_POR_RODADA}): nada apagado, alerta enviado`
            : ""),
      );
      if (r.travadasPeloTeto) process.exitCode = 1;
    }
  } catch (e) {
    console.error("  ✗ a limpeza dos testes falhou:", e);
    process.exitCode = 1;
  }

  /* ── a conta encerrada ──────────────────────────────────────────────────
     Cancelada ou inadimplente: três meses depois do fim do período pago, com
     quatro avisos (src/lib/contas-encerradas.ts). Bloco próprio pelo mesmo
     motivo do de cima. */
  console.log("\ncontas encerradas");
  try {
    const r = await rodarRetencaoDeContasEncerradas({ aplicar: APLICAR, liberarTeto: LIBERAR_TETO });
    if (!r.ligada) {
      console.log("  desligada — precisa do e-mail E da cobrança ligados; nada foi avisado nem apagado");
    } else {
      for (const l of r.linhas) console.log(`  ${l}`);
      console.log(
        `  ${APLICAR ? "✓" : "(simulação)"} avisos: ${r.avisos} · contas limpas: ${r.apagadas}` +
          (r.falhasDeEnvio ? ` · e-mails que não saíram: ${r.falhasDeEnvio} (tentam amanhã)` : "") +
          (r.travadasPeloTeto
            ? ` · PARADA PELO TETO (${r.travadasPeloTeto} > ${TETO_POR_RODADA}): nada apagado, alerta enviado`
            : ""),
      );
      if (r.travadasPeloTeto) process.exitCode = 1;
    }
  } catch (e) {
    console.error("  ✗ a limpeza das contas encerradas falhou:", e);
    process.exitCode = 1;
  }

  /* ── o fechamento mensal ────────────────────────────────────────────────
     Regrava a linha do mês CORRENTE da tabela `fechamentos_mensais` (migração
     068) — a memória da tela "Mês a mês" da Administração. Roda todo dia, e é
     por isso que a linha de um mês fechado é o retrato da madrugada do último
     dia dele. Mora AQUI pelo mesmo motivo do teste abandonado: o deploy não
     instala unidade nova do systemd, e esta já roda todo dia. Bloco próprio:
     uma falha aqui não desfaz a limpeza de cima. */
  console.log("\nfechamento mensal");
  try {
    if (APLICAR) {
      const { mes, numeros: n } = await gravarFechamentoDoMes();
      console.log(
        `  ✓ ${mes} gravado: ${n.estudios} contas · ${n.pagando} pagando · ${n.emTeste} em teste · ` +
          `resultado ${(n.resultadoCentavos / 100).toFixed(2).replace(".", ",")}`,
      );
    } else {
      const { mes, numeros: n } = await fechamentoDoMes();
      console.log(`  (simulação) ${mes}: ${n.estudios} contas · ${n.pagando} pagando — nada foi gravado`);
    }
  } catch (e) {
    console.error("  ✗ o fechamento mensal falhou:", e);
    process.exitCode = 1;
  }
} finally {
  await db.end();
  /* O pool de `src/lib/db.ts`, usado pelas funções do app acima. Sem fechar, o
     processo espera o tempo ocioso dele (30 s) antes de sair. */
  await globalThis._pgPool?.end();
}
