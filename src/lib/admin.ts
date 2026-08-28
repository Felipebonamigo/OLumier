import "server-only";
import { consultar, consultarUm } from "./db";
import type { Evento } from "./eventos";

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
        where m.tenant_id = t.id and m.pronto) as ultimo_envio
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

/** O log de auditoria da plataforma inteira, do mais recente para trás. */
export async function eventosRecentes(limite = 60): Promise<Evento[]> {
  return consultar<Evento>(
    `select id, tenant_id, estudio, ator, acao, alvo_tipo, alvo_id, detalhe, criado_em
       from eventos order by id desc limit $1`,
    [limite],
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
    consultar<Evento>(
      `select id, tenant_id, estudio, ator, acao, alvo_tipo, alvo_id, detalhe, criado_em
         from eventos where tenant_id = $1 order by id desc limit 100`,
      [id],
    ),
  ]);

  return { estudio, galerias, eventos };
}
