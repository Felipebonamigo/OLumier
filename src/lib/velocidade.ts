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
/* Leva abaixo de 20 MB ou de três arquivos é uma foto solta, não uma pasta. */
const PISO_LEVA = 20 * 1024 * 1024;
const ARQUIVOS_MINIMOS_DA_LEVA = 3;

export interface VelocidadeReal {
  /** ZIP que já estava pronto no disco do servidor: é a velocidade da entrega. */
  downloadDoDisco: ResumoDeVelocidade | null;
  /** ZIP montado enquanto saía: inclui a leitura dos originais no armazém. */
  downloadMontando: ResumoDeVelocidade | null;
  /** Envio do original, por arquivo — com outros subindo junto. */
  envio: ResumoDeVelocidade | null;
  /**
   * A fila inteira, do primeiro ao último arquivo: o que o fotógrafo sente.
   * Ver `MedidaDeLeva` e a migração 069.
   */
  leva: ResumoDeVelocidade | null;
  /** Desistências de REDE. A recusa do servidor fica em `recusas`. */
  falhas: {
    n: number;
    estudios: number;
    /** As mais recentes, para ver padrão (mesmo estúdio? mesmo navegador?). */
    ultimas: { estudio: string; erro: string | null; navegador: string | null; quando: Date }[];
  };
  /**
   * O que o servidor recusou: espaço do plano, teste vencido, sessão, tipo de
   * arquivo. Agrupado por estúdio e motivo, porque é assim que acontece — uma
   * pasta inteira batendo no mesmo teto, e não 150 problemas.
   */
  recusas: {
    n: number;
    estudios: number;
    grupos: { estudio: string; erro: string | null; n: number; ultima: Date }[];
  };
}

export async function velocidadeReal(diasDownload = 30, diasEnvio = 7): Promise<VelocidadeReal> {
  const [zips, envios, levas, falhas, ultimas, recusas, grupos] = await Promise.all([
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
    consultar<{ bytes: string; ms: number }>(
      `select bytes, ms from envios_levas
        where arquivos >= $2 and criado_em > now() - make_interval(days => $1)`,
      [diasEnvio, ARQUIVOS_MINIMOS_DA_LEVA],
    ),
    consultar<{ n: number; estudios: number }>(
      `select count(*)::int as n, count(distinct tenant_id)::int as estudios from envios_medidos
        where not ok and not recusa and criado_em > now() - make_interval(days => $1)`,
      [diasEnvio],
    ),
    consultar<{ estudio: string; erro: string | null; navegador: string | null; quando: Date }>(
      `select t.nome_estudio as estudio, e.erro, e.navegador, e.criado_em as quando
         from envios_medidos e join tenants t on t.id = e.tenant_id
        where not e.ok and not e.recusa and e.criado_em > now() - make_interval(days => $1)
        order by e.criado_em desc limit 8`,
      [diasEnvio],
    ),
    consultar<{ n: number; estudios: number }>(
      `select count(*)::int as n, count(distinct tenant_id)::int as estudios from envios_medidos
        where recusa and criado_em > now() - make_interval(days => $1)`,
      [diasEnvio],
    ),
    consultar<{ estudio: string; erro: string | null; n: number; ultima: Date }>(
      `select t.nome_estudio as estudio, e.erro, count(*)::int as n, max(e.criado_em) as ultima
         from envios_medidos e join tenants t on t.id = e.tenant_id
        where e.recusa and e.criado_em > now() - make_interval(days => $1)
        group by t.id, t.nome_estudio, e.erro
        order by max(e.criado_em) desc limit 5`,
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
    leva: resumoDeVelocidade(levas.map((l) => amostra(l.bytes, l.ms)), PISO_LEVA),
    falhas: { n: falhas[0]?.n ?? 0, estudios: falhas[0]?.estudios ?? 0, ultimas },
    recusas: { n: recusas[0]?.n ?? 0, estudios: recusas[0]?.estudios ?? 0, grupos },
  };
}
