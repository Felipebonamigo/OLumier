import "server-only";
import { consultar, consultarUm } from "./db";
import type { Evento } from "./eventos";
import type { SomasDeEntrega } from "./metricas-entrega";

/**
 * Os dados da visão de administrador.
 *
 * SÓ LEITURA, de propósito. A tentação seria colocar aqui "mudar plano",
 * "entrar como o estúdio", "apagar conta" — e cada um desses transforma uma
 * página de consulta numa página que pode causar estrago, num sistema onde o
 * administrador é a única pessoa sem ninguém acima para desfazer o engano.
 *
 * O que ela precisa responder é o que o suporte pergunta: "o fulano consegue
 * enviar?", "quanto ele já usou?", "o cliente dele chegou a abrir a galeria?".
 * E o que o dono pergunta: "quanto entra, quanto sai, e isso está crescendo?".
 *
 * As CONTAS ficam em `lib/metricas-admin.ts`, puras e testáveis sem banco.
 * Aqui mora só o que precisa do Postgres.
 */

export interface LinhaAdmin {
  id: string;
  nome_estudio: string;
  email: string;
  slug: string;
  plano_id: string;
  ciclo_cobranca: string;
  status: string;
  trial_ate: Date | null;
  criado_em: Date;
  cpf_cnpj: string | null;
  dominio_proprio: string | null;
  dominio_verificado_em: Date | null;
  tem_assinatura: boolean;
  asaas_cliente_id: string | null;
  asaas_assinatura_id: string | null;
  assinatura_criada_em: Date | null;
  ultimo_pagamento_em: Date | null;
  pago_ate: Date | null;
  senha_alterada_em: Date | null;
  /** Liberado para o login do Pixieset (migração 052). */
  pixieset_liberado_em: Date | null;
  /** Liberado para o login do Pixellu (migração 053). */
  pixellu_liberado_em: Date | null;
  quota_bytes: string;
  bytes_no_ar: string;
  bytes_no_cofre: string;
  galerias: number;
  publicadas: number;
  na_lixeira: number;
  medias: number;
  fotos: number;
  videos: number;
  acessos_30d: number;
  favoritas: number;
  ultimo_acesso: Date | null;
  ultimo_envio: Date | null;
  /**
   * A última vez que o ESTÚDIO mexeu no trabalho dele.
   *
   * É o mais recente entre três coisas, porque "alteração" não tem um carimbo
   * só: editar a galeria (design, entrega, capítulos) atualiza
   * `galerias.atualizado_em`, subir foto cria `medias.criado_em`, e mexer na
   * conta atualiza `tenants.atualizado_em`. Olhar um deles sozinho faz um
   * estúdio que subiu 400 fotos ontem parecer parado há meses.
   *
   * NÃO é "último login": esse carimbo não existe em lugar nenhum do banco, e
   * inventá-lo seria uma migração mais uma escrita a cada requisição
   * autenticada. Ver a linha de `ultimo_acesso`, que é do CLIENTE.
   */
  ultima_alteracao: Date | null;
  /**
   * A última vez que o FOTÓGRAFO entrou — qualquer requisição autenticada.
   *
   * Nulo não quer dizer conta abandonada: a coluna nasceu em 29/09/2026 (ver a
   * migração 047), e toda conta anterior começa sem marca. A tela diz isso em
   * vez de desenhar um travessão, que pareceria ausência.
   */
  ultimo_acesso_estudio: Date | null;
}

/**
 * Uma consulta só para todos os estúdios.
 *
 * Poderia ser uma por estúdio, e seria mais fácil de ler — mas viraria dezenas
 * de idas ao banco numa página de suporte que alguém abre justamente quando
 * está com pressa. As subconsultas agregadas resolvem em uma viagem.
 *
 * atalho: uma dúzia de subconsultas correlacionadas por linha, sem paginação.
 * Com a base atual (dezenas de estúdios) roda em milissegundos. Acima de uns
 * ~500 estúdios a saída é materializar isto numa view ou numa tabela de resumo
 * atualizada por gatilho — não é otimizar a consulta, que já está no limite do
 * que este formato dá.
 */
export async function panoramaDosEstudios(): Promise<LinhaAdmin[]> {
  return consultar<LinhaAdmin>(`
    select
      t.id, t.nome_estudio, t.email, t.slug, t.plano_id, t.ciclo_cobranca, t.status,
      t.trial_ate, t.criado_em, t.cpf_cnpj,
      t.dominio_proprio, t.dominio_verificado_em,
      (t.asaas_assinatura_id is not null) as tem_assinatura,
      t.asaas_cliente_id, t.asaas_assinatura_id,
      t.assinatura_criada_em, t.ultimo_pagamento_em, t.pago_ate, t.senha_alterada_em,
      t.pixieset_liberado_em, t.pixellu_liberado_em,
      t.quota_bytes,
      coalesce((
        select sum(m.bytes) from medias m
          join galerias g on g.id = m.galeria_id
         where g.tenant_id = t.id and m.pronto and g.estado <> 'arquivada'
      ), 0)::text as bytes_no_ar,
      coalesce((
        select sum(m.bytes) from medias m
          join galerias g on g.id = m.galeria_id
         where g.tenant_id = t.id and m.pronto and g.estado = 'arquivada'
      ), 0)::text as bytes_no_cofre,
      (select count(*)::int from galerias g
        where g.tenant_id = t.id and g.apagada_em is null) as galerias,
      (select count(*)::int from galerias g
        where g.tenant_id = t.id and g.publicada and g.apagada_em is null) as publicadas,
      (select count(*)::int from galerias g
        where g.tenant_id = t.id and g.apagada_em is not null) as na_lixeira,
      (select count(*)::int from medias m
         join galerias g on g.id = m.galeria_id
        where g.tenant_id = t.id and m.pronto) as medias,
      (select count(*)::int from medias m
         join galerias g on g.id = m.galeria_id
        where g.tenant_id = t.id and m.pronto and m.tipo = 'foto') as fotos,
      (select count(*)::int from medias m
         join galerias g on g.id = m.galeria_id
        where g.tenant_id = t.id and m.pronto and m.tipo = 'video') as videos,
      (select count(*)::int from acessos a
         join galerias g on g.id = a.galeria_id
        where g.tenant_id = t.id and a.criado_em > now() - interval '30 days') as acessos_30d,
      (select count(*)::int from favoritas f
         join galerias g on g.id = f.galeria_id
        where g.tenant_id = t.id) as favoritas,
      (select max(a.criado_em) from acessos a
         join galerias g on g.id = a.galeria_id
        where g.tenant_id = t.id) as ultimo_acesso,
      (select max(m.criado_em) from medias m
        where m.tenant_id = t.id and m.pronto) as ultimo_envio,
      greatest(
        t.atualizado_em,
        (select max(g.atualizado_em) from galerias g where g.tenant_id = t.id),
        (select max(m.criado_em) from medias m where m.tenant_id = t.id and m.pronto)
      ) as ultima_alteracao,
      t.ultimo_acesso_em as ultimo_acesso_estudio
    from tenants t
    order by t.criado_em desc
  `);
}

// ---------------------------------------------------------------------------
// CRESCIMENTO
// ---------------------------------------------------------------------------

export interface MesDoCrescimento {
  mes: string;
  cadastros: number;
  bytes_enviados: string;
  arquivos: number;
}

/**
 * Doze meses de cadastros e de envio, lado a lado.
 *
 * As duas séries vêm de tabelas diferentes e quase nunca cobrem os mesmos
 * meses: um mês pode ter envio sem cadastro nenhum, e o contrário também. Um
 * `full outer join` sobre a lista de meses gerada resolve isso sem buraco — a
 * alternativa (dois arrays alinhados no TypeScript) erra calada no primeiro mês
 * em que só uma das duas tem linha.
 */
export async function crescimentoMensal(meses = 12): Promise<MesDoCrescimento[]> {
  return consultar<MesDoCrescimento>(
    `
    with calendario as (
      select generate_series(
        date_trunc('month', now()) - make_interval(months => $1::int - 1),
        date_trunc('month', now()),
        interval '1 month'
      ) as mes
    ),
    novos as (
      select date_trunc('month', criado_em) mes, count(*)::int n
        from tenants group by 1
    ),
    enviados as (
      select date_trunc('month', criado_em) mes,
             sum(bytes) bytes, count(*)::int n
        from medias where pronto group by 1
    )
    select to_char(c.mes, 'YYYY-MM') as mes,
           coalesce(novos.n, 0) as cadastros,
           coalesce(enviados.bytes, 0)::text as bytes_enviados,
           coalesce(enviados.n, 0) as arquivos
      from calendario c
      left join novos on novos.mes = c.mes
      left join enviados on enviados.mes = c.mes
     order by c.mes
  `,
    [meses],
  );
}

// ---------------------------------------------------------------------------
// ENTREGA — o que os clientes finais fizeram
// ---------------------------------------------------------------------------

export interface ResumoDeEntrega {
  abriu: number;
  baixou: number;
  baixou_tudo: number;
  assistiu: number;
}

/** Quantos acessos de cada tipo em N dias. É a prova de que a entrega chegou. */
export async function entregaRecente(dias = 30): Promise<ResumoDeEntrega> {
  const linha = await consultarUm<ResumoDeEntrega>(
    `select
       count(*) filter (where acao = 'abriu')::int        as abriu,
       count(*) filter (where acao = 'baixou')::int       as baixou,
       count(*) filter (where acao = 'baixou_tudo')::int  as baixou_tudo,
       count(*) filter (where acao = 'assistiu')::int     as assistiu
     from acessos
    where criado_em > now() - make_interval(days => $1::int)`,
    [dias],
  );
  return linha ?? { abriu: 0, baixou: 0, baixou_tudo: 0, assistiu: 0 };
}

/**
 * As somas de ENTREGA DE ZIP do mês corrente — o que `metricas-entrega.ts`
 * transforma em franquias e avisos. Mês de calendário, e não "30 dias", porque
 * é assim que o B2 e a Hetzner contam as franquias.
 *
 * `avulsos` são os `acessos` de 'baixou' que NÃO vieram de um ZIP: foto
 * avulsa e lote no celular, que saem do B2 direto. Como esses não têm bytes
 * registrados, a tela estima pelo tamanho médio de uma mídia — e diz que é
 * estimativa.
 */
export async function entregaDeZipDoMes(): Promise<SomasDeEntrega> {
  const zip = await consultarUm<{
    montados_n: number;
    montados_bytes: string;
    servidos_servidor_n: number;
    servidos_servidor_bytes: string;
    do_cache_n: number;
    do_cache_bytes: string;
    servidos_vps_n: number;
    servidos_vps_bytes: string;
    abortados_n: number;
    abortados_bytes: string;
    abortados_vps_bytes: string;
    quedas_n: number;
    trechos_bytes: string;
    servidos_nao_tudo_n: number;
    guardaveis_n: number;
    guardaveis_cache_n: number;
    despejos_n: number;
    despejos_bytes: string;
  }>(
    `select
       count(*) filter (where evento = 'montado')::int                              as montados_n,
       coalesce(sum(bytes) filter (where evento = 'montado'), 0)                    as montados_bytes,
       count(*) filter (where evento = 'servido' and origem = 'servidor')::int      as servidos_servidor_n,
       coalesce(sum(bytes) filter (where evento = 'servido' and origem = 'servidor'), 0) as servidos_servidor_bytes,
       count(*) filter (where evento = 'servido' and origem = 'servidor' and do_cache)::int as do_cache_n,
       coalesce(sum(bytes) filter (where evento = 'servido' and origem = 'servidor' and do_cache), 0) as do_cache_bytes,
       count(*) filter (where evento = 'servido' and origem = 'vps')::int           as servidos_vps_n,
       coalesce(sum(bytes) filter (where evento = 'servido' and origem = 'vps'), 0) as servidos_vps_bytes,
       count(*) filter (where evento = 'abortado')::int                             as abortados_n,
       coalesce(sum(bytes) filter (where evento = 'abortado'), 0)                   as abortados_bytes,
       coalesce(sum(bytes) filter (where evento = 'abortado' and origem = 'vps'), 0) as abortados_vps_bytes,
       count(*) filter (where evento = 'abortado' and not retomado)::int            as quedas_n,
       coalesce(sum(bytes) filter (where evento = 'trecho'), 0)                     as trechos_bytes,
       count(*) filter (where evento = 'servido' and tipo <> 'tudo')::int           as servidos_nao_tudo_n,
       count(*) filter (where evento = 'servido' and origem = 'servidor'
                          and tipo in ('tudo','capitulo'))::int                    as guardaveis_n,
       count(*) filter (where evento = 'servido' and origem = 'servidor'
                          and tipo in ('tudo','capitulo') and do_cache)::int        as guardaveis_cache_n,
       count(*) filter (where evento = 'despejo')::int                              as despejos_n,
       coalesce(sum(bytes) filter (where evento = 'despejo'), 0)                    as despejos_bytes
     from entregas_zip
    where criado_em >= date_trunc('month', now())`,
  );
  /* O rodízio: a mesma galeria montada de novo, mesmo tamanho, dentro do
     prazo do cache. Tamanho diferente é conteúdo diferente, não desperdício. */
  const remontagens = await consultarUm<{ n: number; bytes: string }>(
    `select count(*)::int as n, coalesce(sum(a.bytes), 0) as bytes
       from entregas_zip a
      where a.evento = 'montado' and a.origem = 'servidor'
        and a.tipo in ('tudo','capitulo')
        and a.criado_em >= date_trunc('month', now())
        and exists (
          select 1 from entregas_zip b
           where b.evento = 'montado' and b.origem = 'servidor'
             and b.galeria_id = a.galeria_id and b.bytes = a.bytes
             and b.criado_em < a.criado_em
             and b.criado_em > a.criado_em - interval '14 days')`,
  );
  const quente = await consultarUm<{ bytes: string }>(
    `select coalesce(sum(bytes), 0) as bytes from (
       select distinct galeria_id, bytes from entregas_zip
        where evento = 'montado' and origem = 'servidor'
          and tipo in ('tudo','capitulo')
          and criado_em > now() - interval '14 days') x`,
  );
  const acessos = await consultarUm<{ baixou: number }>(
    `select count(*)::int as baixou from acessos
      where acao = 'baixou' and criado_em >= date_trunc('month', now())`,
  );
  const media = await consultarUm<{ media: string | null }>(
    `select avg(bytes)::bigint::text as media from medias where pronto`,
  );
  const z = zip ?? {
    montados_n: 0, montados_bytes: "0", servidos_servidor_n: 0, servidos_servidor_bytes: "0",
    do_cache_n: 0, do_cache_bytes: "0", servidos_vps_n: 0, servidos_vps_bytes: "0",
    abortados_n: 0, abortados_bytes: "0", abortados_vps_bytes: "0", quedas_n: 0, trechos_bytes: "0",
    servidos_nao_tudo_n: 0,
    guardaveis_n: 0, guardaveis_cache_n: 0, despejos_n: 0, despejos_bytes: "0",
  };
  return {
    montadosN: z.montados_n,
    montadosBytes: Number(z.montados_bytes),
    servidosServidorN: z.servidos_servidor_n,
    servidosServidorBytes: Number(z.servidos_servidor_bytes),
    doCacheN: z.do_cache_n,
    doCacheBytes: Number(z.do_cache_bytes),
    servidosVpsN: z.servidos_vps_n,
    servidosVpsBytes: Number(z.servidos_vps_bytes),
    abortadosN: z.abortados_n,
    abortadosBytes: Number(z.abortados_bytes),
    abortadosVpsBytes: Number(z.abortados_vps_bytes),
    quedasN: z.quedas_n,
    trechosBytes: Number(z.trechos_bytes),
    /* Os 'baixou' de ZIP de capítulo/favoritas/recorte também viram acesso
       (ver registrarEntregaDeZip); saem da conta para não contar duas vezes. */
    avulsosN: Math.max(0, (acessos?.baixou ?? 0) - z.servidos_nao_tudo_n),
    bytesPorMedia: Number(media?.media ?? 0),
    guardaveisServidosN: z.guardaveis_n,
    guardaveisDoCacheN: z.guardaveis_cache_n,
    despejosN: z.despejos_n,
    despejosBytes: Number(z.despejos_bytes),
    remontagensN: remontagens?.n ?? 0,
    remontagensBytes: Number(remontagens?.bytes ?? 0),
    conjuntoQuenteBytes: Number(quente?.bytes ?? 0),
  };
}

/** O log de auditoria da plataforma inteira, do mais recente para trás. */
export async function eventosRecentes(limite = 60): Promise<Evento[]> {
  return consultar<Evento>(
    `select id, tenant_id, estudio, ator, acao, alvo_tipo, alvo_id, detalhe, criado_em
       from eventos order by id desc limit $1`,
    [limite],
  );
}

// ---------------------------------------------------------------------------
// PESQUISA DO LOG
// ---------------------------------------------------------------------------

/**
 * ── POR QUE O LOG VIROU PESQUISA ──────────────────────────────────────────
 *
 * O painel mostrava os 40 eventos mais recentes numa lista corrida. Uma
 * limpeza de galeria despeja trinta `media.apagada` no mesmo minuto, e a lista
 * inteira virava a mesma linha repetida — a rolagem custava meia tela e o
 * evento que importava ficava fora dela.
 *
 * Mostrar menos não resolve sozinho: o que sai da lista precisa continuar
 * alcançável, senão a tela deixa de responder "o que aconteceu no dia 3", que
 * é a pergunta pela qual esta tabela existe. Daí a divisão: o painel mostra
 * poucos e recentes, e a pesquisa alcança o resto.
 */

/** Teto de linhas por página. `?porPagina=999999` não despeja a tabela. */
export const POR_PAGINA_MAX = 100;
export const POR_PAGINA_PADRAO = 50;

export interface FiltroEventos {
  acao?: string;
  tenantId?: string;
  /** Texto livre: casa nome do estúdio, ação ou id do alvo. */
  busca?: string;
  /** YYYY-MM-DD, inclusive nas duas pontas. */
  desde?: string;
  ate?: string;
  pagina?: number;
  porPagina?: number;
}

export interface PaginaDeEventos {
  eventos: Evento[];
  /** Quantos o FILTRO encontrou — não quantos couberam na página. */
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

/**
 * Prepara o texto para o `like`.
 *
 * `%` e `_` são curingas: sem escapar, quem digitasse "100%" (ou só "%")
 * receberia todos os eventos de todos os estúdios — e uma busca que devolve
 * tudo se lê como "achei tudo isso", não como "seu filtro foi ignorado".
 */
function paraLike(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const comoUuid = (v: string | undefined) =>
  v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
const comoData = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const limpo = (v: string | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

export async function procurarEventos(f: FiltroEventos = {}): Promise<PaginaDeEventos> {
  const porPagina = Math.min(
    POR_PAGINA_MAX,
    Math.max(1, Math.floor(Number(f.porPagina) || POR_PAGINA_PADRAO)),
  );
  const pedida = Math.floor(Number(f.pagina));
  const pagina = Number.isFinite(pedida) && pedida > 0 ? pedida : 1;

  const busca = limpo(f.busca);
  const valores = [
    limpo(f.acao),
    comoUuid(f.tenantId),
    busca ? paraLike(busca) : null,
    comoData(f.desde),
    comoData(f.ate),
  ];

  /*
   * Um `where` só, montado com `is null or ...` em vez de concatenar pedaços de
   * SQL conforme os filtros preenchidos. Concatenar é o caminho curto para o
   * dia em que um dos pedaços leva texto de usuário junto — e aqui TODO filtro
   * vem da URL. Assim o texto nunca sai de um parâmetro.
   */
  const onde = `
    where ($1::text is null or e.acao = $1)
      and ($2::uuid is null or e.tenant_id = $2)
      and ($3::text is null or (
            e.estudio ilike $3 escape '\\'
         or e.acao    ilike $3 escape '\\'
         or e.alvo_id ilike $3 escape '\\'))
      and ($4::date is null or e.criado_em >= $4::date)
      and ($5::date is null or e.criado_em < $5::date + 1)`;

  /*
   * Contagem e página em duas consultas, e não num `count(*) over ()`: a janela
   * viaja junto das linhas, então uma página além do fim volta SEM linha
   * nenhuma — e com ela o total, que é justamente o que diz "existem 300, você
   * pediu a página 99". A tela ficaria dizendo "nenhum resultado" para uma
   * busca que achou trezentos.
   */
  const [{ n: total }] = await consultar<{ n: number }>(
    `select count(*)::int as n from eventos e ${onde}`,
    valores,
  );

  const eventos = await consultar<Evento>(
    `select e.id, e.tenant_id, e.estudio, e.ator, e.acao, e.alvo_tipo, e.alvo_id,
            e.detalhe, e.criado_em
       from eventos e ${onde}
      order by e.id desc
      limit $6 offset $7`,
    [...valores, porPagina, (pagina - 1) * porPagina],
  );

  return { eventos, total, pagina, porPagina, paginas: Math.ceil(total / porPagina) };
}

/** As ações que existem no log, da mais usada para a menos — para o filtro. */
export async function acoesRegistradas(): Promise<{ acao: string; n: number }[]> {
  return consultar<{ acao: string; n: number }>(
    `select acao, count(*)::int as n from eventos group by acao order by n desc, acao`,
  );
}

/** Estúdios que aparecem no log, para o filtro por conta. */
export async function estudiosComEventos(): Promise<{ tenant_id: string; estudio: string }[]> {
  return consultar<{ tenant_id: string; estudio: string }>(
    `select distinct on (tenant_id) tenant_id, estudio
       from eventos
      where tenant_id is not null and estudio is not null
      order by tenant_id, id desc`,
  );
}

// ---------------------------------------------------------------------------
// UM ESTÚDIO — a ficha completa
// ---------------------------------------------------------------------------

export interface GaleriaDoEstudio {
  id: string;
  slug: string;
  titulo: string;
  subtitulo: string | null;
  data_evento: Date | null;
  publicada: boolean;
  estado: string;
  tem_senha: boolean;
  permite_download: boolean;
  expira_em: Date | null;
  apagada_em: Date | null;
  arquivada_em: Date | null;
  criado_em: Date;
  bytes_total: string;
  medias: number;
  favoritas: number;
  acessos: number;
  ultimo_acesso: Date | null;
}

export async function galeriasDoEstudio(tenantId: string): Promise<GaleriaDoEstudio[]> {
  return consultar<GaleriaDoEstudio>(
    `select g.id, g.slug, g.titulo, g.subtitulo, g.data_evento, g.publicada, g.estado,
            (g.senha_hash is not null) as tem_senha,
            g.permite_download, g.expira_em, g.apagada_em, g.arquivada_em, g.criado_em,
            g.bytes_total::text as bytes_total,
            (select count(*)::int from medias m where m.galeria_id = g.id and m.pronto) as medias,
            (select count(*)::int from favoritas f where f.galeria_id = g.id) as favoritas,
            (select count(*)::int from acessos a where a.galeria_id = g.id) as acessos,
            (select max(a.criado_em) from acessos a where a.galeria_id = g.id) as ultimo_acesso
       from galerias g
      where g.tenant_id = $1
      order by g.criado_em desc`,
    [tenantId],
  );
}

export interface FichaDoEstudio {
  estudio: LinhaAdmin;
  galerias: GaleriaDoEstudio[];
  eventos: Evento[];
}

/**
 * A ficha de um estúdio. `null` quando o id não existe.
 *
 * Reaproveita o panorama e filtra em memória em vez de escrever uma segunda
 * consulta parecida: duas consultas com os mesmos vinte campos dessincronizam,
 * e a que dessincroniza é sempre a que ninguém olha. Com a base pequena, o
 * custo é o de uma leitura a mais — o mesmo atalho anotado em
 * `panoramaDosEstudios`, e some junto com ele quando a base crescer.
 */
export async function fichaDoEstudio(id: string): Promise<FichaDoEstudio | null> {
  /* UUID inválido derrubaria a consulta com erro do Postgres em vez de virar
     404 na tela. O painel recebe o id da URL, que qualquer um pode digitar. */
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const estudio = (await panoramaDosEstudios()).find((e) => e.id === id);
  if (!estudio) return null;

  const [galerias, eventos] = await Promise.all([
    galeriasDoEstudio(id),
    /* Doze, pelo mesmo motivo do painel: uma limpeza de galeria despeja trinta
       `media.apagada` no mesmo minuto e afogaria a ficha inteira. O resto está
       em /painel/admin/eventos?estudio=<id>, já filtrado nesta conta. */
    consultar<Evento>(
      `select id, tenant_id, estudio, ator, acao, alvo_tipo, alvo_id, detalhe, criado_em
         from eventos where tenant_id = $1 order by id desc limit 12`,
      [id],
    ),
  ]);

  return { estudio, galerias, eventos };
}
