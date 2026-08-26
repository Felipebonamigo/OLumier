#!/usr/bin/env node
/**
 * Manda para o cofre as galerias que venceram. Roda todo dia no servidor
 * (temporizador do systemd). Uso manual:
 *   node --env-file=.env.production --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/arquivar-vencidas.mjs
 *
 * Só muda o estado — nenhum arquivo é apagado. A galeria sai do ar e volta em um
 * clique pelo painel.
 *
 * ── POR QUE ISTO AQUI É CASCA ─────────────────────────────────────────────
 * Até 26/08/2026 este script rodava um `update` inline, com o MESMO SQL que
 * `src/lib/cofre.ts` já tinha. Duas implementações da mesma regra — e a que
 * rodava de verdade era a pior das duas: a do lib registra o arquivamento na
 * auditoria com ator 'sistema', e a de cá não registrava nada.
 *
 * A diferença aparece no dia em que o cliente do estúdio reclama que a galeria
 * saiu do ar. O registro é o que prova que foi o PRAZO — o mesmo que o fotógrafo
 * escolheu e combinou — e não alguém que apertou um botão. Sem ele, arquivamento
 * automático e manual ficam indistinguíveis depois do fato.
 *
 * Agora o script é só a casca: decide quando roda e escreve o log. A regra mora
 * em um lugar só. Ver `arquivarVencidas` e `estudiosAcimaDoEspaco`.
 */
import { arquivarVencidas, estudiosAcimaDoEspaco } from "../src/lib/cofre.ts";
import { pool } from "../src/lib/db.ts";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

try {
  const arquivadas = await arquivarVencidas();
  const quando = new Date().toISOString();

  if (arquivadas.length === 0) {
    // Registra mesmo sem trabalho: log silencioso esconde tarefa que parou de rodar.
    console.log(`${quando} nenhuma galeria venceu`);
  } else {
    console.log(`${quando} ${arquivadas.length} galeria(s) para o cofre:`);
    for (const g of arquivadas) console.log(`  - ${g.estudio}: ${g.titulo}`);
  }

  /*
   * Arquivar nunca é recusado: com espaço único (migração 016) mover a galeria
   * de estado não muda um byte do total ocupado. O prazo também foi combinado
   * com o casal, e segurar a galeria no ar quebraria o combinado.
   *
   * O que este bloco faz é outra coisa: mostrar quem passou do espaço
   * contratado. Estourar não bloqueia nada — só o próximo upload é recusado —,
   * então sem este aviso o operador só descobriria pela fatura.
   */
  const acima = await estudiosAcimaDoEspaco();
  if (acima.length > 0) {
    const gb = (b) => (Number(b) / 1024 ** 3).toFixed(1);
    console.log(`${quando} ⚠ ${acima.length} estúdio(s) acima do espaço contratado:`);
    for (const a of acima) {
      console.log(`  ! ${a.nome_estudio} (${a.email}): ${gb(a.usado)} GB de ${gb(a.limite)} GB`);
    }
  }
} catch (e) {
  console.error(`${new Date().toISOString()} FALHOU: ${e.message}`);
  process.exitCode = 1;
} finally {
  /* O pool de `lib/db.ts` fica pendurado no globalThis e seguraria o processo
   * vivo depois do último `console.log` — num temporizador oneshot isso é uma
   * tarefa que nunca termina. */
  await pool().end();
}
