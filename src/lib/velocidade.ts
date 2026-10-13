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
    /**
     * As mais recentes, para ver padrão (mesmo estúdio? mesmo navegador?).
     * Mensagem repetida vira UMA linha com a contagem (`n`): oito "No período
     * de teste…" da mesma conta, no mesmo minuto, tomavam a tela inteira.
     */
    ultimas: { estudio: string; erro: string | null; navegador: string | null; quando: Date; n: number }[];
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
    consultar<{ estudio: string; erro: string | null; navegador: string | null; quando: Date; n: number }>(
      `select t.nome_estudio as estudio, e.erro, e.navegador, max(e.criado_em) as quando, count(*)::int as n
         from envios_medidos e join tenants t on t.id = e.tenant_id
        where not e.ok and not e.recusa and e.criado_em > now() - make_interval(days => $1)
        group by t.id, t.nome_estudio, e.erro, e.navegador
        order by max(e.criado_em) desc limit 8`,
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

/**
 * A ÚLTIMA VELOCIDADE E A MÉDIA DE CADA ESTÚDIO (13/10/2026).
 *
 * Felipe: "ultima velocidade da galeria de cada usuário, de upload e de
 * download — ou isso é muita coisa para registrar?". Não é: já está tudo
 * gravado por estúdio (`envios_levas`, `envios_medidos`, `entregas_zip`), a
 * tabela só não lia. E depois: "também adicione a velocidade média". Nada novo
 * é gravado.
 *
 *   · ENVIO: a última PASTA inteira (o que o fotógrafo sente); se houver envio
 *     mais novo sem pasta fechada — a fila foi descartada, parada ou fechada
 *     no meio —, a mediana das últimas fotos, que subiam seis ao mesmo tempo e
 *     por isso é uma velocidade "por arquivo", dita assim na tela.
 *   · DOWNLOAD: o último ZIP que o servidor de ZIP entregou a um cliente do
 *     estúdio. A navegação da galeria (ver fotos) não é medida: custaria uma
 *     gravação por visita, e quem mede isso é o navegador de quem olha.
 *
 * A MÉDIA é dos últimos 30 dias, e é a velocidade do conjunto — todos os bytes
 * divididos por todo o tempo —, e não a média das velocidades: uma pasta
 * pequena e lenta não pesa o mesmo que uma de 8 GB. No "por arquivo", que não
 * tem pasta para somar, é a média das fotos.
 *
 * Os mesmos pisos do painel geral: amostra pequena mede a ida e volta.
 */
export type OrigemDaVelocidade = "pasta" | "arquivo" | "zip-pronto" | "zip-montando";

export interface UltimaVelocidade {
  bytesPorSegundo: number;
  quando: Date;
  origem: OrigemDaVelocidade;
}

/** A velocidade do conjunto, nos últimos `DIAS_DA_MEDIA` dias. */
export interface MediaDeVelocidade {
  bytesPorSegundo: number;
  /** Quantas pastas, fotos ou ZIPs entraram na conta. */
  n: number;
  origem: "pasta" | "arquivo" | "zip";
}

export interface VelocidadesDoEstudio {
  envio: UltimaVelocidade | null;
  download: UltimaVelocidade | null;
  envioMedio: MediaDeVelocidade | null;
  downloadMedio: MediaDeVelocidade | null;
}

export interface VelocidadesDosEstudios {
  porEstudio: Map<string, VelocidadesDoEstudio>;
  /** A plataforma inteira, para a linha de total da tabela. */
  geral: Pick<VelocidadesDoEstudio, "envioMedio" | "downloadMedio">;
}

/* As últimas fotos que entram na mediana do "por arquivo", e até quando se olha. */
const FOTOS_NA_MEDIANA = 20;
const DIAS_DO_POR_ARQUIVO = 30;
const DIAS_DA_MEDIA = 30;

export async function ultimasVelocidadesDosEstudios(): Promise<VelocidadesDosEstudios> {
  const [levas, fotos, zips, mediasDasLevas, mediasDasFotos, mediasDosZips] = await Promise.all([
    consultar<{ tenant_id: string; bytes: string; ms: number; criado_em: Date }>(
      `select distinct on (tenant_id) tenant_id, bytes, ms, criado_em
         from envios_levas
        where arquivos >= $1 and bytes >= $2
        order by tenant_id, criado_em desc`,
      [ARQUIVOS_MINIMOS_DA_LEVA, PISO_LEVA],
    ),
    consultar<{ tenant_id: string; bps: number; quando: Date }>(
      `select tenant_id,
              percentile_cont(0.5) within group (order by bytes::float8 * 1000 / ms) as bps,
              max(criado_em) as quando
         from (select tenant_id, bytes, ms, criado_em,
                      row_number() over (partition by tenant_id order by criado_em desc) as posicao
                 from envios_medidos
                where ok and ms >= 200 and bytes >= $1
                  and criado_em > now() - make_interval(days => $2)) ultimas
        where posicao <= $3
        group by tenant_id`,
      [PISO_ENVIO, DIAS_DO_POR_ARQUIVO, FOTOS_NA_MEDIANA],
    ),
    consultar<{ tenant_id: string; bytes: string; duracao_ms: number; do_cache: boolean; criado_em: Date }>(
      `select distinct on (tenant_id) tenant_id, bytes, duracao_ms, do_cache, criado_em
         from entregas_zip
        where evento = 'servido' and origem = 'servidor' and tenant_id is not null
          and duracao_ms >= 200 and bytes >= $1
        order by tenant_id, criado_em desc`,
      [PISO_DOWNLOAD],
    ),
    /* `rollup`: uma linha por estúdio e, no fim, a do conjunto (tenant_id nulo). */
    consultar<{ tenant_id: string | null; bytes: string; ms: string; n: number }>(
      `select tenant_id, sum(bytes) as bytes, sum(ms) as ms, count(*)::int as n
         from envios_levas
        where arquivos >= $1 and bytes >= $2 and criado_em > now() - make_interval(days => $3)
        group by rollup (tenant_id)`,
      [ARQUIVOS_MINIMOS_DA_LEVA, PISO_LEVA, DIAS_DA_MEDIA],
    ),
    consultar<{ tenant_id: string | null; bps: number; n: number }>(
      `select tenant_id, avg(bytes::float8 * 1000 / ms) as bps, count(*)::int as n
         from envios_medidos
        where ok and ms >= 200 and bytes >= $1 and criado_em > now() - make_interval(days => $2)
        group by rollup (tenant_id)`,
      [PISO_ENVIO, DIAS_DA_MEDIA],
    ),
    consultar<{ tenant_id: string | null; bytes: string; ms: string; n: number }>(
      `select tenant_id, sum(bytes) as bytes, sum(duracao_ms) as ms, count(*)::int as n
         from entregas_zip
        where evento = 'servido' and origem = 'servidor' and tenant_id is not null
          and duracao_ms >= 200 and bytes >= $1 and criado_em > now() - make_interval(days => $2)
        group by rollup (tenant_id)`,
      [PISO_DOWNLOAD, DIAS_DA_MEDIA],
    ),
  ]);

  const porEstudio = new Map<string, VelocidadesDoEstudio>();
  const doEstudio = (id: string) => {
    let v = porEstudio.get(id);
    if (!v) porEstudio.set(id, (v = { envio: null, download: null, envioMedio: null, downloadMedio: null }));
    return v;
  };
  const geral: VelocidadesDosEstudios["geral"] = { envioMedio: null, downloadMedio: null };

  for (const l of levas) {
    doEstudio(l.tenant_id).envio = {
      bytesPorSegundo: (Number(l.bytes) / l.ms) * 1000,
      quando: l.criado_em,
      origem: "pasta",
    };
  }
  /* A pasta fecha DEPOIS das fotos dela; só um envio mais novo que a última
     pasta (de uma fila que não fechou) passa à frente. */
  for (const f of fotos) {
    const v = doEstudio(f.tenant_id);
    if (!v.envio || f.quando.getTime() > v.envio.quando.getTime()) {
      v.envio = { bytesPorSegundo: f.bps, quando: f.quando, origem: "arquivo" };
    }
  }
  for (const z of zips) {
    doEstudio(z.tenant_id).download = {
      bytesPorSegundo: (Number(z.bytes) / z.duracao_ms) * 1000,
      quando: z.criado_em,
      origem: z.do_cache ? "zip-pronto" : "zip-montando",
    };
  }

  /* A média de envio: a da PASTA, que é o que o fotógrafo sente; sem pasta nenhuma
     nos 30 dias, a das fotos. */
  const aplicar = (id: string | null, campo: "envioMedio" | "downloadMedio", m: MediaDeVelocidade) => {
    (id === null ? geral : doEstudio(id))[campo] = m;
  };
  for (const f of mediasDasFotos) {
    aplicar(f.tenant_id, "envioMedio", { bytesPorSegundo: f.bps, n: f.n, origem: "arquivo" });
  }
  for (const l of mediasDasLevas) {
    if (l.n === 0 || Number(l.ms) <= 0) continue;
    aplicar(l.tenant_id, "envioMedio", { bytesPorSegundo: (Number(l.bytes) / Number(l.ms)) * 1000, n: l.n, origem: "pasta" });
  }
  for (const z of mediasDosZips) {
    if (z.n === 0 || Number(z.ms) <= 0) continue;
    aplicar(z.tenant_id, "downloadMedio", { bytesPorSegundo: (Number(z.bytes) / Number(z.ms)) * 1000, n: z.n, origem: "zip" });
  }
  return { porEstudio, geral };
}
