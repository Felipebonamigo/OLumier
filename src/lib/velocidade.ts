import "server-only";
import { consultar } from "./db";
import { resumoDeVelocidade, type ResumoDeVelocidade } from "./velocidade-regras";

/**
 * A velocidade real, lida do banco — ver `velocidade-regras.ts` para as contas
 * e a migração 053 para o porquê.
 */

/* ZIP abaixo de 20 MB mede a ida e volta, não a banda. */
const PISO_DOWNLOAD = 20 * 1024 * 1024;
/* Foto abaixo de 1 MB idem. */
const PISO_ENVIO = 1024 * 1024;

export interface VelocidadeReal {
  /** ZIP que já estava pronto no disco do servidor: é a velocidade da entrega. */
  downloadDoDisco: ResumoDeVelocidade | null;
  /** ZIP montado enquanto saía: inclui a leitura dos originais no armazém. */
  downloadMontando: ResumoDeVelocidade | null;
  /** Envio do original, por arquivo (a fila manda três ao mesmo tempo). */
  envio: ResumoDeVelocidade | null;
  falhas: {
    n: number;
    estudios: number;
    /** As mais recentes, para ver padrão (mesmo estúdio? mesmo navegador?). */
    ultimas: { estudio: string; erro: string | null; navegador: string | null; quando: Date }[];
  };
}

export async function velocidadeReal(diasDownload = 30, diasEnvio = 7): Promise<VelocidadeReal> {
  const [zips, envios, falhas, ultimas] = await Promise.all([
    consultar<{ bytes: string; duracao_ms: number; do_cache: boolean }>(
      `select bytes, duracao_ms, do_cache from entregas_zip
        where evento = 'servido' and origem = 'servidor' and duracao_ms > 0
          and criado_em > now() - make_interval(days => $1)`,
      [diasDownload],
    ),
    consultar<{ bytes: string; ms: number }>(
      `select bytes, ms from envios_medidos
        where ok and ms > 0 and criado_em > now() - make_interval(days => $1)`,
      [diasEnvio],
    ),
    consultar<{ n: number; estudios: number }>(
      `select count(*)::int as n, count(distinct tenant_id)::int as estudios from envios_medidos
        where not ok and criado_em > now() - make_interval(days => $1)`,
      [diasEnvio],
    ),
    consultar<{ estudio: string; erro: string | null; navegador: string | null; quando: Date }>(
      `select t.nome_estudio as estudio, e.erro, e.navegador, e.criado_em as quando
         from envios_medidos e join tenants t on t.id = e.tenant_id
        where not e.ok and e.criado_em > now() - make_interval(days => $1)
        order by e.criado_em desc limit 8`,
      [diasEnvio],
    ),
  ]);
  const amostra = (bytes: string, ms: number) => ({ bytes: Number(bytes), ms });
  return {
    downloadDoDisco: resumoDeVelocidade(
      zips.filter((z) => z.do_cache).map((z) => amostra(z.bytes, z.duracao_ms)),
      PISO_DOWNLOAD,
    ),
    downloadMontando: resumoDeVelocidade(
      zips.filter((z) => !z.do_cache).map((z) => amostra(z.bytes, z.duracao_ms)),
      PISO_DOWNLOAD,
    ),
    envio: resumoDeVelocidade(envios.map((e) => amostra(e.bytes, e.ms)), PISO_ENVIO),
    falhas: { n: falhas[0]?.n ?? 0, estudios: falhas[0]?.estudios ?? 0, ultimas },
  };
}
