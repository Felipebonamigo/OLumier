#!/usr/bin/env node
/**
 * Há algo a contar aos administradores sobre a entrega? Uso (no VPS):
 *
 *   cd /opt/fotonio && /usr/local/bin/node --env-file=.env.production \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/avisos-da-entrega.mjs
 *
 * Quem chama é o vigia (`ops/fotonio-vigia.sh`), uma vez por semana. Este
 * script NÃO envia nada: calcula as mesmas contas do painel de administração
 * e, se houver aviso de erro, imprime o e-mail em duas linhas JSON — assunto e
 * texto — para o vigia mandar pelo mesmo caminho do Resend que ele já usa para
 * "site fora do ar", e que já foi provado em produção. Um segundo caminho de
 * envio seria um segundo lugar para a chave estar errada.
 *
 * Saídas:
 *   0  imprimiu um e-mail (duas linhas JSON)
 *   3  nada a contar esta semana
 *   1  falhou ao calcular (banco fora, por exemplo) — o vigia tenta de novo
 *
 * Ver `src/lib/relatorio-semanal.ts` para o que entra e o porquê.
 */
import { panoramaDosEstudios, entregaDeZipDoMes } from "../src/lib/admin.ts";
import { resumoDaPlataforma } from "../src/lib/metricas-admin.ts";
import { resumoDeTrafego } from "../src/lib/metricas-entrega.ts";
import { zipRemotoConfigurado } from "../src/lib/zip-remoto.ts";
import { relatorioDaEntrega } from "../src/lib/relatorio-semanal.ts";
import { marca } from "../src/config/marca.ts";
import { pool } from "../src/lib/db.ts";

let codigo = 1;
try {
  const [estudios, somas] = await Promise.all([panoramaDosEstudios(), entregaDeZipDoMes()]);
  const r = resumoDaPlataforma(estudios, new Date());
  const trafego = resumoDeTrafego(somas, {
    bytesGuardados: r.bytesGuardados,
    custoDoGuardadoCentavos: r.custoMensalCentavos,
    servidorConfigurado: zipRemotoConfigurado(),
  });
  const relatorio = relatorioDaEntrega(trafego.avisos, `https://${marca.dominio}/painel/admin`);
  if (relatorio) {
    console.log(JSON.stringify(relatorio.assunto));
    console.log(JSON.stringify(relatorio.texto));
    codigo = 0;
  } else {
    codigo = 3;
  }
} catch (e) {
  console.error("avisos-da-entrega:", e instanceof Error ? e.message : e);
  codigo = 1;
} finally {
  await pool().end().catch(() => {});
}
process.exit(codigo);
