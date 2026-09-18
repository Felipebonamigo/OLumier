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
  capa_foco_x: number;
  capa_foco_y: number;
  /** Busca por rosto ligada pelo fotógrafo (migração 028). */
  rostos_ativos: boolean;
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
  /* A fonte própria do estúdio. Vem junto porque a galeria pública precisa dela
     para montar o @font-face — sem isso seria uma segunda consulta por página. */
  estudio_fonte: string | null;
  estudio_fonte_nome: string | null;
  estudio_cor: string;
  /** Para `galeriasNoAr` — a carência do trial abandonado. */
  estudio_status: string;
  estudio_trial_ate: Date | null;
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
            g.permite_download, g.expira_em, g.aparencia, g.aparencia_rascunho, g.capa_media_id, g.capa_chave, g.capa_foco_x, g.capa_foco_y, g.rostos_ativos, g.grupo_solto,
            t.nome_estudio as estudio_nome, t.slug as estudio_slug, t.site as estudio_site,
            t.logo_chave as estudio_logo, t.cor_destaque as estudio_cor,
            t.fonte_chave as estudio_fonte, t.fonte_nome as estudio_fonte_nome,
            -- Para galeriasNoAr: o trial abandonado deixa de servir a galeria
            -- 15 dias depois de vencer. Sem estas duas colunas a regra recebe
            -- undefined e libera todo mundo — falha que nenhuma tela denuncia.
            t.status as estudio_status, t.trial_ate as estudio_trial_ate
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
  }>(
    /*
     * A ordem já sai agrupada por capítulo (seções pela ordem definida pelo
     * fotógrafo, fotos soltas primeiro). Assim os índices ficam contíguos por
     * capítulo e o lightbox anda na mesma ordem que a página mostra.
     */
    `select m.id, m.chave, m.chave_thumb, m.chave_preview, m.nome_original,
            m.tipo, m.bytes, m.largura, m.altura, m.secao_id, m.armazem
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
}) {
  /* A MESMA função de `eventos`: é o que permite cruzar as duas tabelas e dizer
     que o acesso e a ação vieram do mesmo lugar. Já foram duas cópias, e as duas
     divergiram em silêncio — ver o cabeçalho de `lib/ip.ts`. */
  const ipHash = dados.ip ? hashDeIp(dados.ip) : null;

  try {
    await consultar(
      `insert into acessos (galeria_id, media_id, acao, ip_hash, user_agent)
       values ($1, $2, $3, $4, $5)`,
      [dados.galeriaId, dados.mediaId ?? null, dados.acao, ipHash, dados.userAgent?.slice(0, 300) ?? null],
    );
  } catch {
    // Registro é secundário: se falhar, a galeria continua abrindo normalmente.
  }
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
