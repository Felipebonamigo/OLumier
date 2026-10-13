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

/**
 * ONDE O TEMPO DE CADA FOTO VAI (13/10/2026, migração 075).
 *
 * Médias por foto, em ms, só de quem SUBIU e mandou as etapas. A soma das
 * partes mais `perdidoMs` é `totalMs`: o perdido é o que as tentativas
 * refeitas e as esperas entre elas levaram (ou o que ninguém cronometrou).
 * Média e não mediana de propósito: uma foto em cada quatro perdendo um
 * minuto e meio some numa mediana e pesa na conta de quem espera a pasta.
 */
export interface EtapasDoEstudio {
  /** O estúdio, ou "Todos" na linha geral. */
  estudio: string;
  /** Quantas fotos entram na média. */
  n: number;
  totalMs: number;
  esperaMs: number;
  miniaturaMs: number;
  preparoMs: number;
  /** O PUT do original — a única parte que depende só da rede. */
  envioMs: number;
  derivadasMs: number;
  confirmarMs: number;
  perdidoMs: number;
  /** Fração (0 a 1) das fotos que precisaram de mais de uma tentativa. */
  comRetentativa: number;
  /** Fração (0 a 1) das fotos em que o navegador ficou sem rede. */
  comQuedaDeRede: number;
}

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
  /** Onde o tempo de cada foto vai: a linha geral e os estúdios que mais enviaram. */
  etapas: { geral: EtapasDoEstudio | null; porEstudio: EtapasDoEstudio[] };
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

/*
 * As médias das etapas, em SQL: uma semana de envio são milhares de linhas, e
 * trazê-las para somar aqui custaria mais que o resultado. O "perdido" é o total
 * menos a soma do que foi medido, nunca abaixo de zero (a soma pode passar do
 * total por arredondamento).
 */
const MEDIAS_DAS_ETAPAS = `
  count(*)::int                                               as n,
  avg(e.total_ms)::float8                                     as total_ms,
  avg(coalesce(e.espera_ms, 0))::float8                       as espera_ms,
  avg(coalesce(e.miniatura_ms, 0))::float8                    as miniatura_ms,
  avg(coalesce(e.preparo_ms, 0))::float8                      as preparo_ms,
  avg(coalesce(e.ms, 0))::float8                              as envio_ms,
  avg(coalesce(e.derivadas_ms, 0))::float8                    as derivadas_ms,
  avg(coalesce(e.confirmar_ms, 0))::float8                    as confirmar_ms,
  avg(greatest(0, e.total_ms - coalesce(e.espera_ms, 0) - coalesce(e.miniatura_ms, 0)
                 - coalesce(e.preparo_ms, 0) - coalesce(e.ms, 0)
                 - coalesce(e.derivadas_ms, 0) - coalesce(e.confirmar_ms, 0)))::float8 as perdido_ms,
  (count(*) filter (where e.tentativas > 1))::float8 / count(*) as com_retentativa,
  (count(*) filter (where e.sem_rede))::float8 / count(*)       as com_queda_de_rede`;

/* Menos que isto é amostra, não retrato: a média de três fotos não diz de um estúdio. */
const FOTOS_MINIMAS_POR_ESTUDIO = 5;
const ESTUDIOS_NA_TABELA = 8;

interface LinhaDeEtapas {
  estudio: string;
  n: number;
  total_ms: number;
  espera_ms: number;
  miniatura_ms: number;
  preparo_ms: number;
  envio_ms: number;
  derivadas_ms: number;
  confirmar_ms: number;
  perdido_ms: number;
  com_retentativa: number;
  com_queda_de_rede: number;
}

const doEstudio = (l: LinhaDeEtapas): EtapasDoEstudio => ({
  estudio: l.estudio,
  n: l.n,
  totalMs: l.total_ms,
  esperaMs: l.espera_ms,
  miniaturaMs: l.miniatura_ms,
  preparoMs: l.preparo_ms,
  envioMs: l.envio_ms,
  derivadasMs: l.derivadas_ms,
  confirmarMs: l.confirmar_ms,
  perdidoMs: l.perdido_ms,
  comRetentativa: l.com_retentativa,
  comQuedaDeRede: l.com_queda_de_rede,
});

export async function velocidadeReal(
  diasDownload = 30,
  diasEnvio = 7,
  /* Quantos estúdios entram na tabela de etapas; o teste pede mais, porque o
     banco dele é compartilhado e o dele precisa aparecer. */
  estudiosNaTabela = ESTUDIOS_NA_TABELA,
): Promise<VelocidadeReal> {
  const [zips, envios, levas, falhas, ultimas, recusas, grupos, etapasGeral, etapasPorEstudio] = await Promise.all([
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
    consultar<LinhaDeEtapas>(
      `select 'Todos' as estudio, ${MEDIAS_DAS_ETAPAS}
         from envios_medidos e
        where e.ok and e.total_ms is not null and e.criado_em > now() - make_interval(days => $1)
       having count(*) > 0`,
      [diasEnvio],
    ),
    consultar<LinhaDeEtapas>(
      `select t.nome_estudio as estudio, ${MEDIAS_DAS_ETAPAS}
         from envios_medidos e join tenants t on t.id = e.tenant_id
        where e.ok and e.total_ms is not null and e.criado_em > now() - make_interval(days => $1)
        group by t.id, t.nome_estudio
       having count(*) >= $2
        order by count(*) desc limit $3`,
      [diasEnvio, FOTOS_MINIMAS_POR_ESTUDIO, estudiosNaTabela],
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
    etapas: {
      geral: etapasGeral[0] ? doEstudio(etapasGeral[0]) : null,
      porEstudio: etapasPorEstudio.map(doEstudio),
    },
    falhas: { n: falhas[0]?.n ?? 0, estudios: falhas[0]?.estudios ?? 0, ultimas },
    recusas: { n: recusas[0]?.n ?? 0, estudios: recusas[0]?.estudios ?? 0, grupos },
  };
}
