import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { consultar, consultarUm } from "./db";
import { hashDeIp } from "./ip";

/**
 * Acesso do CLIENTE FINAL (o casal) à galeria. Não é login: não existe conta,
 * não existe cadastro. O que existe é um link secreto e, opcionalmente, uma
 * senha que o fotógrafo define e passa junto.
 */

export interface GaleriaPublica {
  id: string;
  tenant_id: string;
  titulo: string;
  subtitulo: string | null;
  data_evento: Date | null;
  estado: string;
  senha_hash: string | null;
  permite_download: boolean;
  /* Só a prévia lê: rascunho abre para o dono sem `?previa=1`. */
  publicada: boolean;
  expira_em: Date | null;
  aparencia: unknown;
  /*
   * O que o fotógrafo está experimentando e ainda não publicou.
   *
   * Vem junto porque a PRÉVIA do dono (`?previa=1`) precisa dele: sem esta
   * coluna o botão "Visualizar galeria" abria a aparência publicada, e quem
   * acabara de trocar a grade via a antiga. O cliente nunca lê este campo —
   * `buscarGaleriaPublica` só o traz, e quem decide usá-lo é a página, depois
   * de provar que a sessão é do dono.
   */
  aparencia_rascunho: unknown;
  capa_media_id: string | null;
  /** Capa enviada como arquivo (migração 029). Vence `capa_media_id`. */
  capa_chave: string | null;
  /** O clipe da capa do Stream e o primeiro quadro dele (migração 066). */
  capa_video_chave: string | null;
  capa_video_poster_chave: string | null;
  capa_foco_x: number;
  capa_foco_y: number;
  /** Busca por rosto ligada pelo fotógrafo (migração 028). */
  rostos_ativos: boolean;
  /*
   * O recado do cliente (migração 058). Vem NESTA consulta, e não numa à parte,
   * porque é assim que as 512 galerias que nunca vão ligar recado não pagam nada
   * por ele existir — quem junta as regras é `configDoRecado`.
   */
  recado_ativo: boolean;
  recado_estrelas: boolean;
  recado_convite: string | null;
  recado_perguntas: unknown;
  /**
   * Como o grupo das fotos sem capítulo se chama nesta galeria (migração 037).
   * Nulo = "Outras fotos". Ver `nomeDoGrupoSolto`.
   */
  grupo_solto: string | null;
  // do estúdio dono — a marca que aparece é a dele, não a nossa
  estudio_nome: string;
  /* O contato do estúdio, como ele preencheu no site. A tela de consentimento
     da busca por rosto diz ao convidado com quem falar sobre as fotos dele —
     e é o estúdio, não nós. */
  estudio_site: unknown;
  estudio_slug: string;
  estudio_logo: string | null;
  /* A medida da logo (migração 052), para a capa desenhá-la pela área. */
  estudio_logo_largura: number | null;
  estudio_logo_altura: number | null;
  /* A fonte própria do estúdio. Vem junto porque a galeria pública precisa dela
     para montar o @font-face — sem isso seria uma segunda consulta por página. */
  estudio_fonte: string | null;
  estudio_fonte_nome: string | null;
  estudio_cor: string;
  /** Para `galeriasNoAr` — a carência do trial abandonado. */
  estudio_status: string;
  estudio_trial_ate: Date | null;
  /** Quantas fotos e quantos vídeos PRONTOS — ver a consulta abaixo. */
  qtd_fotos: number;
  qtd_videos: number;
}

/**
 * A galeria como o visitante a vê.
 *
 * `incluirRascunho` só é usado pela PRÉVIA do painel, e quem chama precisa ter
 * conferido antes que a sessão é do dono. A prévia existe porque o fotógrafo
 * escolhe a aparência justamente enquanto a galeria ainda é rascunho — e até
 * agora ela mostrava a página de 404, o que fazia o recurso parecer quebrado no
 * exato momento em que era mais útil.
 */
export async function buscarGaleriaPublica(
  estudioSlug: string,
  galeriaSlug: string,
  incluirRascunho = false,
) {
  return consultarUm<GaleriaPublica>(
    `select g.id, g.tenant_id, g.titulo, g.subtitulo, g.data_evento, g.estado, g.senha_hash,
            g.permite_download, g.publicada, g.expira_em, g.aparencia, g.aparencia_rascunho, g.capa_media_id, g.capa_chave, g.capa_video_chave, g.capa_video_poster_chave, g.capa_foco_x, g.capa_foco_y, g.rostos_ativos, g.grupo_solto,
            g.recado_ativo, g.recado_estrelas, g.recado_convite, g.recado_perguntas,
            t.nome_estudio as estudio_nome, t.slug as estudio_slug, t.site as estudio_site,
            t.logo_chave as estudio_logo, t.cor_destaque as estudio_cor,
            t.logo_largura as estudio_logo_largura, t.logo_altura as estudio_logo_altura,
            t.fonte_chave as estudio_fonte, t.fonte_nome as estudio_fonte_nome,
            -- Para galeriasNoAr: o trial abandonado deixa de servir a galeria
            -- 15 dias depois de vencer. Sem estas duas colunas a regra recebe
            -- undefined e libera todo mundo — falha que nenhuma tela denuncia.
            t.status as estudio_status, t.trial_ate as estudio_trial_ate,
            -- O QUE A ENTREGA TEM, para o cartão do link não chamar filme de
            -- foto (ver palavra-da-entrega.ts). Duas contagens sobre o
            -- indice de medias(galeria_id), na mesma ida ao banco: uma
            -- segunda consulta só para escolher uma palavra seria uma viagem
            -- a mais em toda abertura de galeria.
            --
            -- A coluna pronto entra porque arquivo no meio do envio não está na
            -- galeria para ninguém — sem isso a palavra mudaria durante o
            -- upload e voltaria depois, sem ninguém entender por quê.
            (select count(*) from medias m
              where m.galeria_id = g.id and m.tipo = 'foto' and m.pronto)::int as qtd_fotos,
            (select count(*) from medias m
              where m.galeria_id = g.id and m.tipo = 'video' and m.pronto)::int as qtd_videos
       from galerias g
       join tenants t on t.id = g.tenant_id
      where t.slug = $1 and g.slug = $2
        and ($3::boolean or g.publicada)
        -- Galeria na lixeira não abre nem com o link certo, nem em pré-visualização:
        -- para o casal ela já não existe, e ressuscitá-la é decisão do fotógrafo.
        and g.estado <> 'lixeira'`,
    [estudioSlug, galeriaSlug, incluirRascunho],
  );
}

export async function listarMediasPublicas(galeriaId: string) {
  return consultar<{
    id: string;
    chave: string;
    chave_thumb: string | null;
    chave_preview: string | null;
    nome_original: string;
    tipo: "foto" | "video";
    bytes: string;
    largura: number | null;
    altura: number | null;
    secao_id: string | null;
    /* De onde servir o ORIGINAL. As derivadas ficam sempre no r2 — quem decide
     * é `lib/armazem.ts`, e o caso perigoso é a derivada AUSENTE, cujo fallback
     * é o próprio original e precisa seguir esta coluna. */
    armazem: string;
    /** Sobe a cada republicação (migração 039). Entra na chave do ZIP guardado. */
    versao: number;
    /** Só vídeo, e só os enviados depois de 30/09/2026 — ver o formato Stream. */
    duracao_seg: number | null;
    /** O nome que o fotógrafo escreveu para a tela (migração 055), ou null. */
    titulo: string | null;
  }>(
    /*
     * A ordem já sai agrupada por capítulo (seções pela ordem definida pelo
     * fotógrafo, fotos soltas primeiro). Assim os índices ficam contíguos por
     * capítulo e o lightbox anda na mesma ordem que a página mostra.
     */
    `select m.id, m.chave, m.chave_thumb, m.chave_preview, m.nome_original,
            m.tipo, m.bytes, m.largura, m.altura, m.secao_id, m.armazem, m.versao,
            m.duracao_seg, m.titulo
       from medias m
       left join secoes s on s.id = m.secao_id
      where m.galeria_id = $1 and m.pronto
      order by (m.secao_id is not null), s.ordem nulls first, m.ordem, m.criado_em`,
    [galeriaId],
  );
}

// --- senha da galeria -------------------------------------------------------

function segredo(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET ausente");
  return s;
}

/**
 * Senha da galeria usa SHA-256 com sal, não scrypt.
 *
 * É deliberado e diferente da senha do fotógrafo: aqui a senha costuma ser algo
 * simples que o casal recebe junto com o link ("anaepedro"), o link já é secreto,
 * e a página é aberta por dezenas de convidados ao mesmo tempo — scrypt (que
 * gasta memória de propósito) viraria um jeito fácil de derrubar o servidor.
 */
/*
 * O SAL É POR GALERIA (prefixo "g2:").
 *
 * Antes o sal vinha só do SESSION_SECRET, igual para todas: duas galerias com a
 * senha "anaepedro" tinham hashes IDÊNTICOS. Quem visse o banco saberia quais
 * entregas compartilham senha, e uma única tabela pré-calculada contra o nosso
 * sal abriria todas de uma vez. Com o id da galeria no sal, quebrar uma não
 * ajuda em nada nas outras.
 *
 * O prefixo existe para as senhas já gravadas continuarem valendo: hash sem
 * prefixo é conferido pela regra antiga. Sem isso, ligar esta mudança trancaria
 * todo casal que já tinha a senha na mão — um estrago maior que o problema.
 */
const PREFIXO_V2 = "g2:";

function hashAntigo(senha: string): string {
  const sal = createHash("sha256").update(segredo()).digest("hex").slice(0, 16);
  return createHash("sha256").update(sal + senha).digest("hex");
}

export function gerarHashSenhaGaleria(senha: string, galeriaId: string): string {
  const sal = createHash("sha256")
    .update(`${segredo()}:${galeriaId}`)
    .digest("hex")
    .slice(0, 32);
  return PREFIXO_V2 + createHash("sha256").update(sal + senha).digest("hex");
}

export function conferirSenhaGaleria(
  senha: string,
  hashGuardado: string,
  galeriaId: string,
): boolean {
  const esperado = hashGuardado.startsWith(PREFIXO_V2)
    ? gerarHashSenhaGaleria(senha, galeriaId)
    : hashAntigo(senha);
  const a = Buffer.from(esperado);
  const b = Buffer.from(hashGuardado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const cookieDaGaleria = (galeriaId: string) => `g_${galeriaId.slice(0, 8)}`;

/**
 * A assinatura da liberação inclui uma MARCA da senha atual.
 *
 * Assim, trocar a senha invalida na hora todos os acessos já liberados. Antes
 * não invalidava: o fotógrafo que descobrisse o link vazado trocava a senha e
 * quem já tinha entrado continuava dentro por até sete dias — exatamente as
 * pessoas de quem ele queria tirar o acesso.
 */
function marcaDaSenha(senhaHash: string | null): string {
  return createHash("sha256").update(senhaHash ?? "sem-senha").digest("hex").slice(0, 12);
}

function assinarLiberacao(galeriaId: string, expira: number, senhaHash: string | null): string {
  return createHmac("sha256", segredo())
    .update(`${galeriaId}.${expira}.${marcaDaSenha(senhaHash)}`)
    .digest("hex");
}

/** Guarda que este visitante já acertou a senha — 7 dias, para não pedir a cada visita. */
export async function liberarAcesso(galeriaId: string, senhaHash: string | null) {
  const expira = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const jar = await cookies();
  jar.set(
    cookieDaGaleria(galeriaId),
    `${expira}.${assinarLiberacao(galeriaId, expira, senhaHash)}`,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    },
  );
}

/**
 * QUEM ESTÁ PEDINDO É O DONO DA GALERIA, LOGADO? — a mesma pergunta que a
 * página faz para abrir a prévia (`ehDono` em `g/[estudio]/[galeria]`).
 *
 * Existe por um defeito de 06/10/2026: a página abria o RASCUNHO para o dono e
 * pulava a senha dele, mas as rotas que ela chama depois — `/urls` (o preview
 * da foto ampliada e o próprio vídeo) e `/mais` (a rolagem depois das 600
 * primeiras) — só olhavam `publicada` e a senha. O Juan conferia a galeria da
 * Renata ainda em rascunho, com 1.969 arquivos: nenhum vídeo abria, e a
 * rolagem parava em "A conexão falhou e ainda faltam fotos desta entrega".
 *
 * Quem chama pergunta só quando uma porta já ia fechar: a galeria publicada,
 * sem senha e no ar — quase todo pedido — não paga a consulta da sessão.
 */
export async function donoLogado(tenantId: string): Promise<boolean> {
  const { sessaoAtual } = await import("./auth");
  return (await sessaoAtual()) === tenantId;
}

export async function temAcessoLiberado(
  galeriaId: string,
  senhaHash: string | null,
): Promise<boolean> {
  const jar = await cookies();
  const valor = jar.get(cookieDaGaleria(galeriaId))?.value;
  if (!valor) return false;

  const [expira, assinatura] = valor.split(".");
  if (!expira || !assinatura) return false;
  if (Number(expira) < Date.now()) return false;

  const esperada = assinarLiberacao(galeriaId, Number(expira), senhaHash);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- registro de acesso -----------------------------------------------------

/**
 * Registra abertura e download. Serve de prova de entrega para o fotógrafo
 * ("o casal baixou dia tal"), que é uma dor real da profissão.
 *
 * O IP é guardado como hash, nunca em claro: dá para saber que dois acessos
 * vieram do mesmo lugar sem armazenar dado pessoal identificável (LGPD).
 */
export async function registrarAcesso(dados: {
  galeriaId: string;
  mediaId?: string;
  acao: "abriu" | "baixou" | "baixou_tudo" | "assistiu";
  ip?: string | null;
  userAgent?: string | null;
  /** Quem fez, quando deu para saber. Ver migração 040 e `listarDownloads`. */
  pessoaId?: string | null;
}) {
  /* A MESMA função de `eventos`: é o que permite cruzar as duas tabelas e dizer
     que o acesso e a ação vieram do mesmo lugar. Já foram duas cópias, e as duas
     divergiram em silêncio — ver o cabeçalho de `lib/ip.ts`. */
  const ipHash = dados.ip ? hashDeIp(dados.ip) : null;

  try {
    await consultar(
      `insert into acessos (galeria_id, media_id, acao, ip_hash, user_agent, pessoa_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        dados.galeriaId,
        dados.mediaId ?? null,
        dados.acao,
        ipHash,
        dados.userAgent?.slice(0, 300) ?? null,
        dados.pessoaId ?? null,
      ],
    );
  } catch {
    // Registro é secundário: se falhar, a galeria continua abrindo normalmente.
  }
}

/**
 * QUEM BAIXOU O QUÊ, uma linha por download — a tela que o Juan pediu.
 *
 * Juan, 23/09/2026, com a foto da tela do Pixieset: "gostaria de saber quem
 * está baixando. Quais fotos estão sendo baixadas."
 *
 * ── `left join` NAS DUAS PONTAS, E ISSO É A PARTE QUE IMPORTA ─────────────
 *
 * Em `pessoas_da_galeria` porque download anterior a 23/09/2026 não tem dono, e
 * porque "baixar tudo" pode acontecer antes de a pessoa se identificar. Em
 * `medias` porque `acessos.media_id` é `on delete set null`: a foto apagada não
 * apaga o registro de que alguém a baixou.
 *
 * Um `join` comum sumiria com essas linhas, e a tela diria "3 downloads" ao
 * lado de um contador que diz 41. O fotógrafo confiaria no menor dos dois e
 * estaria errado.
 *
 * O `baixou_tudo` não tem `media_id`: ele é o zip da galeria inteira. A tela
 * mostra isso como o que é, e não como uma foto sem nome.
 */
export async function listarDownloads(
  galeriaId: string,
  opcoes: { limite?: number } = {},
): Promise<
  {
    id: string;
    quando: Date;
    acao: string;
    email: string | null;
    nome: string | null;
    media_id: string | null;
    nome_original: string | null;
    chave_thumb: string | null;
    chave: string | null;
    armazem: string | null;
  }[]
> {
  return consultar(
    `select a.id::text as id, a.criado_em as quando, a.acao,
            p.email, p.nome,
            a.media_id::text as media_id, m.nome_original, m.chave_thumb,
            m.chave, m.armazem
       from acessos a
       left join pessoas_da_galeria p on p.id = a.pessoa_id
       left join medias m on m.id = a.media_id
      where a.galeria_id = $1 and a.acao in ('baixou','baixou_tudo')
      order by a.criado_em desc
      limit $2`,
    [galeriaId, Math.max(1, Math.min(opcoes.limite ?? 500, 2000))],
  );
}

/**
 * Quantas vezes CADA foto foi baixada.
 *
 * É a metade do pedido do Felipe que não aparece na tela de atividade: "e o
 * numero de downloads de cada foto, fazer tambem uma ordenação por mais
 * baixadas". Daqui sai o número na foto e o critério de ordenação.
 *
 * `baixou_tudo` fica de fora porque não é sobre uma foto: contá-lo daria +1 em
 * TODAS de uma vez, e aí "mais baixadas" viraria a ordem de sempre com um
 * número maior em cima.
 */
export async function downloadsPorFoto(galeriaId: string): Promise<Map<string, number>> {
  const linhas = await consultar<{ media_id: string; n: number }>(
    `select media_id::text as media_id, count(*)::int as n
       from acessos
      where galeria_id = $1 and acao = 'baixou' and media_id is not null
      group by media_id`,
    [galeriaId],
  );
  return new Map(linhas.map((l) => [l.media_id, l.n]));
}

export async function resumoAcessos(galeriaId: string) {
  return consultarUm<{ aberturas: number; downloads: number; ultimo: Date | null }>(
    `select
       count(*) filter (where acao = 'abriu')::int as aberturas,
       count(*) filter (where acao in ('baixou','baixou_tudo'))::int as downloads,
       max(criado_em) as ultimo
     from acessos where galeria_id = $1`,
    [galeriaId],
  );
}
