import "server-only";
import { consultar, consultarUm } from "./db";
import { gerarHashSenha, conferirSenha } from "./auth";
import { planoPorId, GB } from "@/config/planos";
import { slugReservado } from "@/config/subdominios";

export interface Tenant {
  id: string;
  slug: string;
  nome_estudio: string;
  email: string;
  /** Chave do objeto no bucket — não é URL. O link é assinado na hora de exibir. */
  logo_chave: string | null;
  /* A fonte própria do estúdio (migração 026). Nulas para quem nunca enviou —
     e nesse caso a opção nem aparece no seletor de tipografia. */
  fonte_chave: string | null;
  fonte_nome: string | null;
  cor_destaque: string;
  /** Conteúdo da vitrine `/e/<slug>`. Formato garantido só por `lerSite`. */
  site: unknown;
  plano_id: string;
  quota_bytes: string; // bigint chega como string do pg — nunca converter cegamente para Number
  quota_cofre_bytes: string;
  usado_bytes: string;
  status: string;
  trial_ate: Date | null;
  cpf_cnpj: string | null;
  asaas_cliente_id: string | null;
  asaas_assinatura_id: string | null;
  /**
   * "mensal" ou "anual" — como esta assinatura é cobrada.
   *
   * Não é enfeite de tela: o cálculo da reserva de custo depende dele, porque o
   * anual cobra uma vez e ocupa disco por doze meses. Passe sempre por
   * `cicloDe()` antes de usar. Ver migração 018 e `lucroCentavos` em socios.ts.
   */
  ciclo_cobranca: string;
  /**
   * A faixa do Atomatiza que a última conferência do combo encontrou, ou null.
   * Só para a tela: quem decide o preço é o Asaas. Ver `lib/combo.ts`.
   */
  combo_atomatiza: string | null;
  /**
   * A última vez que o Atomatiza perguntou por este estúdio e achou conta aqui.
   * Liga o seletor de plataforma no painel. Ver `lib/ponte-atomatiza.ts`.
   */
  atomatiza_visto_em: Date | null;
  /**
   * O maior plano já pago no período corrente — a base da diferença quando o
   * estúdio aumenta o plano. Nulo = vale o plano atual. Ver
   * `config/troca-de-plano.ts` e a migração 046.
   */
  plano_do_periodo: string | null;
  /**
   * Até quando o dinheiro JÁ RECEBIDO cobre o serviço — null se nada foi pago.
   *
   * Só o ramo `cancelado` de `situacaoDoTenant` consulta: cancelar para a
   * renovação, não o acesso. A fonte de verdade da cobrança continua sendo o
   * Asaas; esta coluna existe para que o cancelamento não engula meses que o
   * estúdio já pagou. Ver migração 021.
   */
  pago_ate: Date | null;
  /**
   * Quando o dono clicou no link de confirmação — nulo = pendente. Só trava o
   * envio com o e-mail transacional ligado; ver `lib/confirmacao-email.ts` e a
   * migração 045, que deu a data de criação a toda conta anterior.
   */
  email_confirmado_em: Date | null;
  /* Os passos da limpeza do teste abandonado (migração 045). Quem os escreve é
     só `lib/testes-abandonados.ts`. */
  aviso_limpeza_em: Date | null;
  aviso_limpeza_final_em: Date | null;
  arquivos_limpos_em: Date | null;
  /* O calendário da conta encerrada (migração 051). Quem os escreve é só
     `lib/contas-encerradas.ts`. */
  retencao_aviso_em: Date | null;
  retencao_avisos: number;
  retencao_apagar_em: Date | null;
  criado_em: Date;
}

export interface Galeria {
  id: string;
  tenant_id: string;
  slug: string;
  titulo: string;
  subtitulo: string | null;
  data_evento: Date | null;
  publicada: boolean;
  estado: string;
  senha_hash: string | null;
  /** A senha em texto, cifrada com o segredo do servidor (migração 042). */
  senha_cifrada: string | null;
  permite_download: boolean;
  bytes_total: string;
  expira_em: Date | null;
  arquivada_em: Date | null;
  aparencia: unknown;
  /* O que o fotógrafo está experimentando e ainda não publicou (migração 027).
     O cliente nunca vê isto — quem o lê é só o editor, ao abrir. */
  aparencia_rascunho: unknown;
  capa_media_id: string | null;
  /** De onde a galeria veio, quando não nasceu no painel — ver migração 047. */
  origem: string | null;
  origem_ref: string | null;
  /* Capa enviada como arquivo (migração 029). Vence capa_media_id, e não é uma
     linha em `medias`: não aparece na galeria nem conta como entrega. */
  capa_chave: string | null;
  /* Onde a capa deve ser cortada, em porcentagem — 50/50 é o centro, que é o
   * que o `object-cover` já fazia sozinho. Ver a migração 031. */
  capa_foco_x: number;
  capa_foco_y: number;
  /* Busca por rosto (migração 028). `rostos_ligados_em` é a prova do
     consentimento do fotógrafo; nula enquanto desligada. */
  rostos_ativos: boolean;
  rostos_ligados_em: Date | null;
  /* Como o grupo das fotos sem capítulo se chama nesta galeria (migração 037).
     Nulo — o normal — quer dizer "Outras fotos". Ver `nomeDoGrupoSolto`. */
  grupo_solto: string | null;
  criado_em: Date;
  total_medias?: number;
}

/** Vira parte da URL pública (/g/<slug>/...), então precisa ser limpo e estável. */
export function gerarSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function buscarTenantPorId(id: string) {
  return consultarUm<Tenant>("select * from tenants where id = $1", [id]);
}

export async function buscarTenantPorEmail(email: string) {
  return consultarUm<Tenant>("select * from tenants where lower(email) = lower($1)", [email]);
}

export async function emailJaUsado(email: string) {
  return Boolean(await buscarTenantPorEmail(email));
}

export async function slugDisponivel(slug: string) {
  const r = await consultarUm("select 1 from tenants where slug = $1", [slug]);
  return !r;
}

export async function criarTenant(dados: {
  nomeEstudio: string;
  email: string;
  senha: string;
  planoId: string;
  /** Só dígitos. Pedido no cadastro desde a migração 045 — único entre as contas. */
  cpfCnpj?: string | null;
  /**
   * false = a conta nasce com o e-mail PENDENTE e não envia fotos até o dono
   * clicar no link. Omitido, nasce confirmada — é o padrão da coluna, e o que
   * vale para toda conta criada fora do cadastro (testes, scripts).
   */
  emailConfirmado?: boolean;
}) {
  const plano = planoPorId(dados.planoId);
  if (!plano) throw new Error("Plano inválido");

  /*
   * Slug único E não reservado.
   *
   * O sufixo numérico resolve os dois casos de uma vez: "ana-fotografia" já
   * usado vira "ana-fotografia-2", e um estúdio que geraria "www" vira "www-2",
   * que é um endereço válido e não sequestra o site principal.
   */
  const base = gerarSlug(dados.nomeEstudio) || "estudio";
  let slug = base;
  for (let i = 2; slugReservado(slug) || !(await slugDisponivel(slug)); i++) {
    slug = `${base}-${i}`;
  }

  const senhaHash = await gerarHashSenha(dados.senha);
  /*
   * Uma quota só desde a unificação de 25/08/2026: galeria no ar e arquivo
   * somam no mesmo espaço. `quota_cofre_bytes` continua na tabela (a migração
   * 016 a zerou e comentou) para não quebrar release antigo em rollback, mas
   * ninguém mais escreve nela.
   */
  const quota = BigInt(plano.quotaGb) * BigInt(GB);

  const linha = await consultarUm<Tenant>(
    `insert into tenants (slug, nome_estudio, email, senha_hash, plano_id, quota_bytes,
                          cpf_cnpj, email_confirmado_em)
     values ($1, $2, $3, $4, $5, $6, $7, case when $8::boolean then now() else null end)
     returning *`,
    [
      slug,
      dados.nomeEstudio,
      dados.email.toLowerCase(),
      senhaHash,
      plano.id,
      quota.toString(),
      dados.cpfCnpj || null,
      dados.emailConfirmado ?? true,
    ],
  );
  return linha!;
}

/*
 * Hash descartável, com o mesmo custo de um real.
 *
 * Serve para gastar o MESMO tempo quando o e-mail não existe. Sem isso, a
 * resposta para um e-mail desconhecido volta na hora e a de um cliente demora o
 * scrypt inteiro — e essa diferença, medida de fora, revela quem é cliente do
 * Galeria Átomo. A mensagem na tela já é única de propósito; o relógio contava a
 * verdade assim mesmo.
 *
 * Calculado uma vez, na primeira necessidade, e reaproveitado.
 */
let hashFalso: string | null = null;
async function hashDeReferencia(): Promise<string> {
  hashFalso ??= await gerarHashSenha("senha-que-nao-e-de-ninguem");
  return hashFalso;
}

export async function autenticar(email: string, senha: string): Promise<Tenant | null> {
  const t = await consultarUm<Tenant & { senha_hash: string }>(
    "select * from tenants where lower(email) = lower($1)",
    [email],
  );

  // Confere sempre — contra o hash real, ou contra um descartável.
  const ok = await conferirSenha(senha, t?.senha_hash ?? (await hashDeReferencia()));
  return t && ok ? t : null;
}

/** Quantas galerias por tela. Ver `listarGalerias`. */
export const GALERIAS_POR_TELA = 24;

/*
 * O FILTRO DA LISTA, ESCRITO UMA VEZ — `$1` estúdio, `$2` busca crua, `$3` termo.
 *
 * Eram duas cópias: a da tela e a da contagem de reserva. Duas cópias de um
 * `where` são duas cópias que divergem — e no dia em que divergirem o painel
 * vai dizer "página 3 de 7" e entregar uma tela vazia, porque a conta e a
 * listagem terão respondido sobre conjuntos diferentes.
 *
 * ── O QUE ELE OLHA ────────────────────────────────────────────────────────
 *
 * Nome, local e endereço: os três jeitos de alguém lembrar de uma galeria — o
 * nome do casal, onde foi, ou o link que mandou. Mais a DATA, que antes era
 * achada por acaso (a lista trazia o texto já formatado no HTML) e aqui
 * precisa ser dita: o fotógrafo procura "13/06/2026" e "2026".
 *
 * `sem_acento` (migração 039) no nome e no local: `ilike` ignora caixa, não
 * acento, e quem procura "Júlia" digita "julia". Isso já funcionava por
 * acidente — o ENDEREÇO nasce do título sem acento e entra na busca — e o
 * acidente falha justamente em quem renomeia a galeria, porque o endereço não
 * acompanha o novo nome de propósito: o link já foi para o WhatsApp do casal.
 * O endereço fica fora do `sem_acento` porque já nasce sem nenhum.
 *
 * ── E O `g.id desc` NO FIM DA ORDEM NÃO É ENFEITE ─────────────────────────
 *
 * Sem ele a ordem entre galerias EMPATADAS é livre, e o Postgres pode devolver
 * ordens diferentes para as duas consultas que desenham a página 1 e a página
 * 2. O empate não é hipotético: são as galerias do mesmo dia, e `data_evento`
 * é uma data sem hora. Basta o `criado_em` empatar também — o que acontece em
 * qualquer importação, porque `now()` é um só para a transação inteira.
 *
 * O estrago é do tipo que ninguém liga à paginação: uma galeria aparece nas
 * páginas 1 E 2, e outra não aparece em nenhuma. O fotógrafo procuraria um
 * casamento que o painel jura não ter.
 */
const ONDE_A_BUSCA_CASA = `
      where g.tenant_id = $1 and g.estado <> 'lixeira'
        and ($2 = ''
             or sem_acento(g.titulo) ilike sem_acento($3)
             or sem_acento(coalesce(g.subtitulo, '')) ilike sem_acento($3)
             or g.slug ilike $3
             or coalesce(to_char(g.data_evento, 'DD/MM/YYYY'), '') ilike $3
             or coalesce(to_char(g.data_evento, 'YYYY-MM-DD'), '') ilike $3)`;

/**
 * UMA TELA DE GALERIAS — filtrada e contada pelo banco.
 *
 * ── DE ONDE VEIO (23/09/2026) ─────────────────────────────────────────────
 *
 * Felipe: "como fica quando ficar muitas galerias? a lista aqui."
 *
 * Ficava assim: TODAS, num documento só. Medido antes do conserto, com fotos
 * em cada galeria:
 *
 *      20 galerias →  89 KB de HTML
 *      60 galerias → 192 KB
 *     150 galerias → 424 KB
 *     300 galerias → 811 KB
 *
 * Linear, ~2,6 KB por galeria. O tempo de servidor nem mexia (~170 ms), e é por
 * isso que ninguém tinha reclamado: o preço não está no relógio, está no
 * TAMANHO — a mesma conta que estourou o Safari da Carol com 6,35 MB de
 * galeria, em 11/09/2026. Um estúdio com cinco anos de casamentos chegaria lá.
 *
 * Junto vinha a subconsulta que conta as fotos DE CADA galeria: 300 galerias
 * eram 300 dessas por carregamento de página. Com a tela de 24, são 24.
 *
 * ── A BUSCA VEIO JUNTO, COMO ESTAVA ESCRITO QUE VIRIA ─────────────────────
 *
 * Ela filtrava no navegador uma lista que já chegava inteira, e o comentário de
 * `lista-galerias.tsx` já dizia: "se um dia a lista passar de umas centenas,
 * isto vira paginação no servidor — e aí a busca vai junto". Filtrar no cliente
 * uma tela de 24 esconderia a galeria que está na página 3.
 *
 * Os campos que ela olha estão em `ONDE_A_BUSCA_CASA`, logo acima.
 *
 * `count(*) over ()` devolve o total FILTRADO na mesma consulta: sem ele seria
 * uma segunda ida ao banco só para desenhar "página 2 de 7".
 */
export async function listarGalerias(
  tenantId: string,
  opcoes: { busca?: string; pagina?: number; porTela?: number } = {},
): Promise<{ itens: Galeria[]; total: number; pagina: number; paginas: number }> {
  const porTela = Math.max(1, opcoes.porTela ?? GALERIAS_POR_TELA);
  const busca = (opcoes.busca ?? "").trim();
  /* `%` e `_` são curingas do `like`: quem digitar "50%" procura um nome com
     "50%", e não "qualquer coisa começando com 50". */
  const termo = `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const pagina = Math.max(1, Math.floor(opcoes.pagina ?? 1));

  const linhas = await consultar<Galeria & { total_filtrado: number }>(
    `select g.*,
            (select count(*)::int from medias m where m.galeria_id = g.id and m.pronto) as total_medias,
            count(*) over ()::int as total_filtrado
       from galerias g
      ${ONDE_A_BUSCA_CASA}
      order by coalesce(g.data_evento, g.criado_em::date) desc, g.criado_em desc, g.id desc
      limit $4 offset $5`,
    [tenantId, busca, termo, porTela, (pagina - 1) * porTela],
  );

  /* A página fora do fim (um `?p=99` digitado à mão, ou a última galeria da
     página 3 indo para a lixeira enquanto alguém a olhava) volta sem linhas —
     e sem linhas não há `count(*) over ()` de onde tirar o total. Contar de
     novo custa uma consulta num caso raro; não contar diria "0 galerias" para
     quem tem 300, e o painel desenharia a tela de "crie sua primeira
     galeria". */
  let total = linhas[0]?.total_filtrado ?? 0;
  if (linhas.length === 0 && pagina > 1) {
    const conta = await consultarUm<{ n: number }>(
      `select count(*)::int as n from galerias g ${ONDE_A_BUSCA_CASA}`,
      [tenantId, busca, termo],
    );
    total = conta?.n ?? 0;
  }
  return {
    itens: linhas,
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / porTela)),
  };
}

export async function criarGaleria(dados: {
  tenantId: string;
  titulo: string;
  subtitulo?: string;
  dataEvento?: string;
  /**
   * Quem criou de fora, e a partir de quê — ver migração 045. O painel e o
   * plugin do Lightroom não passam nada aqui; hoje só o Atomatiza passa, pela
   * rota `POST /api/galerias`, que também é quem garante a idempotência.
   */
  origem?: { de: string; ref: string };
}) {
  const base = gerarSlug(dados.titulo) || "galeria";
  let slug = base;
  for (let i = 2; ; i++) {
    const existe = await consultarUm("select 1 from galerias where tenant_id = $1 and slug = $2", [
      dados.tenantId,
      slug,
    ]);
    if (!existe) break;
    slug = `${base}-${i}`;
  }

  return consultarUm<Galeria>(
    `insert into galerias (tenant_id, slug, titulo, subtitulo, data_evento, origem, origem_ref)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      dados.tenantId,
      slug,
      dados.titulo,
      dados.subtitulo || null,
      dados.dataEvento || null,
      dados.origem?.de ?? null,
      dados.origem?.ref ?? null,
    ],
  );
}

/**
 * Apaga a galeria — no banco E no bucket.
 *
 * O `delete` sozinho levava as linhas de `medias` junto (cascade) mas deixava os
 * arquivos no R2 para sempre: sumiam do painel, do relatório de uso e da quota,
 * e continuavam sendo cobrados todo mês. Lixo invisível que só apareceria na
 * fatura, meses depois, sem ninguém saber de onde veio.
 *
 * As chaves são lidas ANTES do delete — depois dele não haveria mais como saber
 * o que apagar.
 */
/** Dias que uma galeria apagada espera na lixeira antes de sumir de vez. */
export const PRAZO_LIXEIRA_DIAS = 30;

/**
 * Manda a galeria para a lixeira. NÃO apaga arquivo nenhum.
 *
 * Antes isto destruía a linha e os objetos do bucket na mesma ação. Trocado
 * porque, entre todos os jeitos de perder as fotos de um casamento, o clique
 * errado do fotógrafo é o mais provável — bem mais provável que falha de
 * fornecedor. Os onze noves de durabilidade do R2 não cobrem o dedo humano.
 *
 * O arquivo continua no bucket e a mídia continua registrada; é o que permite
 * `restaurarGaleria` devolver a galeria inteira em vez de molduras vazias.
 * A destruição de verdade fica com `scripts/limpar-lixeira.mjs`, depois do prazo.
 *
 * O espaço continua contando na quota enquanto está na lixeira — o arquivo
 * ocupa lugar de verdade, e fingir que não ocuparia deixaria o estúdio passar do
 * plano sem perceber. Quem apagou para abrir espaço esvazia a lixeira à mão.
 */
export async function apagarGaleria(tenantId: string, galeriaId: string, ip?: string | null) {
  /*
   * O título e a contagem são lidos ANTES: o evento precisa ficar legível
   * mesmo depois de a galeria ser destruída de vez, e aí não haverá mais o que
   * consultar. É o que transforma "galeria abc-123 apagada" em "a galeria Ana
   * e Pedro, com 340 arquivos, foi apagada".
   */
  const antes = await consultarUm<{ titulo: string; medias: number; estudio: string }>(
    `select g.titulo, t.nome_estudio as estudio,
            (select count(*)::int from medias m where m.galeria_id = g.id) as medias
       from galerias g join tenants t on t.id = g.tenant_id
      where g.id = $1 and g.tenant_id = $2 and g.estado <> 'lixeira'`,
    [galeriaId, tenantId],
  );

  // O tenant_id no where não é redundante: impede que um id adivinhado alcance galeria de outro.
  await consultar(
    `update galerias
        set estado = 'lixeira', apagada_em = now(), publicada = false, atualizado_em = now()
      where id = $1 and tenant_id = $2 and estado <> 'lixeira'`,
    [galeriaId, tenantId],
  );

  // Sem `antes` não houve mudança (id alheio, ou já estava na lixeira): nada a registrar.
  if (!antes) return;
  const { registrarEvento, ACOES } = await import("./eventos");
  await registrarEvento({
    tenantId,
    estudio: antes.estudio,
    ator: "estudio",
    acao: ACOES.GALERIA_APAGADA,
    alvoTipo: "galeria",
    alvoId: galeriaId,
    detalhe: { titulo: antes.titulo, medias: antes.medias, prazoDias: PRAZO_LIXEIRA_DIAS },
    ip,
  });
}

/** Tira a galeria da lixeira. Volta como rascunho: republicar é decisão de quem restaurou. */
export async function restaurarGaleria(tenantId: string, galeriaId: string, ip?: string | null) {
  const antes = await consultarUm<{ titulo: string; estudio: string }>(
    `select g.titulo, t.nome_estudio as estudio
       from galerias g join tenants t on t.id = g.tenant_id
      where g.id = $1 and g.tenant_id = $2 and g.estado = 'lixeira'`,
    [galeriaId, tenantId],
  );

  /*
   * A referência de origem pode ter dona nova. Entre apagar e restaurar, o
   * Atomatiza pode ter recriado a galeria do mesmo contrato — o índice parcial
   * da migração 045 deixa a lixeira de fora justamente para permitir isso. Se
   * a restauração mantivesse o vínculo, o índice a recusaria e o fotógrafo
   * veria a lixeira "quebrada" no pior momento. A restaurada volta inteira,
   * só que sem a procedência: das duas, a que representa o contrato hoje é a
   * recriada.
   */
  await consultar(
    `update galerias g
        set estado = 'online', apagada_em = null, atualizado_em = now(),
            origem = case when exists (
                select 1 from galerias o
                 where o.tenant_id = g.tenant_id and o.id <> g.id
                   and o.origem = g.origem and o.origem_ref = g.origem_ref
                   and o.estado <> 'lixeira'
              ) then null else g.origem end,
            origem_ref = case when exists (
                select 1 from galerias o
                 where o.tenant_id = g.tenant_id and o.id <> g.id
                   and o.origem = g.origem and o.origem_ref = g.origem_ref
                   and o.estado <> 'lixeira'
              ) then null else g.origem_ref end
      where g.id = $1 and g.tenant_id = $2 and g.estado = 'lixeira'`,
    [galeriaId, tenantId],
  );

  if (!antes) return;
  const { registrarEvento, ACOES } = await import("./eventos");
  await registrarEvento({
    tenantId,
    estudio: antes.estudio,
    ator: "estudio",
    acao: ACOES.GALERIA_RESTAURADA,
    alvoTipo: "galeria",
    alvoId: galeriaId,
    detalhe: { titulo: antes.titulo },
    ip,
  });
}

export interface GaleriaNaLixeira extends Galeria {
  dias_restantes: number;
}

/** O que está na lixeira deste estúdio, com quantos dias faltam para sumir. */
export async function listarLixeira(tenantId: string) {
  return consultar<GaleriaNaLixeira>(
    `select g.*,
            (select count(*)::int from medias m where m.galeria_id = g.id and m.pronto) as total_medias,
            greatest(
              0,
              $2::int - floor(extract(epoch from (now() - g.apagada_em)) / 86400)::int
            ) as dias_restantes
       from galerias g
      where g.tenant_id = $1 and g.estado = 'lixeira'
      order by g.apagada_em desc`,
    [tenantId, PRAZO_LIXEIRA_DIAS],
  );
}

export interface GaleriaVencida {
  id: string;
  tenant_id: string;
  titulo: string;
  chaves: string[];
}

/**
 * Galerias que passaram do prazo na lixeira, já com as chaves a apagar.
 *
 * As chaves vêm JUNTO de propósito: depois do `delete` não haveria mais como
 * saber o que apagar do bucket, e o arquivo viraria lixo invisível que só
 * apareceria na fatura, meses depois, sem ninguém saber de onde veio.
 */
export async function galeriasVencidasNaLixeira() {
  return consultar<GaleriaVencida>(
    `select g.id, g.tenant_id, g.titulo,
            coalesce(
              array_remove(
                array_agg(m.chave) || array_agg(m.chave_thumb) || array_agg(m.chave_preview),
                null
              ),
              '{}'
            ) as chaves
       from galerias g
       left join medias m on m.galeria_id = g.id
      where g.estado = 'lixeira'
        and g.apagada_em < now() - ($1 || ' days')::interval
      group by g.id`,
    [PRAZO_LIXEIRA_DIAS],
  );
}

/**
 * Destrói de vez: apaga a linha e os objetos do bucket.
 *
 * Chamada só pela limpeza da lixeira e pelo "esvaziar agora" do painel.
 *
 * Aqui havia a ressalva de que o ESPELHO não era tocado — a segunda cópia era o
 * que sobrava quando tudo mais falhava. O espelho foi removido em 27/08/2026
 * (ver `scripts/testar-sem-espelho.mjs`), então esta função apaga a única cópia
 * que existe: depois dela, o arquivo não volta de lugar nenhum. É por isso que
 * ela só é chamada depois do prazo da lixeira ou por um pedido explícito.
 */
export async function destruirGaleria(
  galeriaId: string,
  /*
   * QUEM mandou destruir. O padrão é o temporizador, que é o caminho comum.
   *
   * A distinção não é enfeite de log: numa disputa, "o prazo correu" e "o
   * fotógrafo mandou apagar agora" são fatos diferentes, e este evento é o único
   * registro de que a galeria existiu. Gravar tudo como "sistema" faria a
   * exclusão manual se disfarçar de expiração automática.
   */
  ator: "sistema" | "estudio" = "sistema",
) {
  /*
   * Até 29/09/2026 o segundo parâmetro era a lista de chaves, montada por quem
   * chamava. Um script JavaScript que ainda passe a lista cairia AQUI como ator
   * — e o evento seria recusado pela tabela em silêncio (`registrarEvento` não
   * lança). Melhor quebrar alto.
   */
  if (ator !== "sistema" && ator !== "estudio") {
    throw new Error(`destruirGaleria: ator inválido (${String(ator)}) — a assinatura agora é (galeriaId, ator)`);
  }

  /*
   * Lido antes do delete, pelo mesmo motivo de sempre: depois não existe mais
   * de onde tirar. Este é o evento que alguém vai procurar anos depois — é o
   * único registro de que aquela galeria existiu.
   */
  const antes = await consultarUm<{
    titulo: string;
    tenant_id: string;
    estudio: string;
    capa_chave: string | null;
  }>(
    `select g.titulo, g.tenant_id, t.nome_estudio as estudio, g.capa_chave
       from galerias g join tenants t on t.id = g.tenant_id
      where g.id = $1`,
    [galeriaId],
  );

  /*
   * OS ARQUIVOS, LIDOS AQUI — e com o armazém de cada original.
   *
   * Até 29/09/2026 quem chamava mandava só as chaves, e tudo ia para
   * `r2.apagarObjetos`. Só que o original pode morar no B2 (`medias.armazem`,
   * migração 015), e apagar no R2 uma chave que não está lá "dá certo" sem
   * fazer nada: o original seguia no B2, pago, sem linha nenhuma que o citasse.
   * A capa enviada como arquivo (`capa_chave`, migração 029) nem entrava na
   * lista. Ninguém via — só a fatura crescia.
   *
   * Quem sabe onde cada arquivo mora é `armazem.ts`; aqui só se junta o que a
   * galeria tem, na hora de apagar, para nenhum chamador poder mandar a lista
   * errada.
   */
  const medias = await consultar<{
    chave: string;
    chave_thumb: string | null;
    chave_preview: string | null;
    armazem: string | null;
  }>("select chave, chave_thumb, chave_preview, armazem from medias where galeria_id = $1", [
    galeriaId,
  ]);
  const quantos =
    medias.reduce((n, m) => n + [m.chave, m.chave_thumb, m.chave_preview].filter(Boolean).length, 0) +
    (antes?.capa_chave ? 1 : 0);

  const apagou = await consultar<{ id: string }>(
    "delete from galerias where id = $1 returning id",
    [galeriaId],
  );

  if (apagou.length > 0 && antes) {
    const { registrarEvento, ACOES } = await import("./eventos");
    await registrarEvento({
      tenantId: antes.tenant_id,
      estudio: antes.estudio,
      ator,
      acao: ACOES.GALERIA_DESTRUIDA,
      alvoTipo: "galeria",
      alvoId: galeriaId,
      detalhe: {
        titulo: antes.titulo,
        arquivos: quantos,
        ...(ator === "sistema" ? { apos_dias: PRAZO_LIXEIRA_DIAS } : { antes_do_prazo: true }),
      },
    });
  }

  if (apagou.length === 0 || quantos === 0) return;

  // O banco já é a fonte da verdade e a galeria já sumiu. Se o armazém falhar
  // aqui, registramos e seguimos — `varrer-orfaos.mjs` recolhe o que sobrar.
  const { apagarArquivosDasMedias } = await import("./armazem");
  const r = await apagarArquivosDasMedias(medias);
  if (r.falhou) {
    console.error(`[destruirGaleria] arquivos da galeria ${galeriaId} podem ter ficado no armazém: ${r.falhou}`);
  }
  if (antes?.capa_chave) {
    const { apagarObjetos } = await import("./r2");
    await apagarObjetos([antes.capa_chave]).catch((e) =>
      console.error(`[destruirGaleria] a capa da galeria ${galeriaId} pode ter ficado no bucket:`, e),
    );
  }
}

/** Formata bytes para leitura humana. bigint como string porque acima de 8 PB o Number perde precisão. */
export function formatarBytes(bytes: string | number | bigint): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  const unidades = ["KB", "MB", "GB", "TB"];
  let valor = n / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i++;
  }
  return `${valor.toFixed(valor < 10 ? 1 : 0)} ${unidades[i]}`;
}
