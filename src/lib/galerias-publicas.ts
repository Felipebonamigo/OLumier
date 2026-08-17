import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { consultar, consultarUm } from "./db";

/**
 * Acesso do CLIENTE FINAL (o casal) à galeria. Não é login: não existe conta,
 * não existe cadastro. O que existe é um link secreto e, opcionalmente, uma
 * senha que o fotógrafo define e passa junto.
 */

export interface GaleriaPublica {
  id: string;
  titulo: string;
  subtitulo: string | null;
  data_evento: Date | null;
  estado: string;
  senha_hash: string | null;
  permite_download: boolean;
  expira_em: Date | null;
  // do estúdio dono — a marca que aparece é a dele, não a nossa
  estudio_nome: string;
  estudio_slug: string;
  estudio_logo: string | null;
  estudio_cor: string;
}

export async function buscarGaleriaPublica(estudioSlug: string, galeriaSlug: string) {
  return consultarUm<GaleriaPublica>(
    `select g.id, g.titulo, g.subtitulo, g.data_evento, g.estado, g.senha_hash,
            g.permite_download, g.expira_em,
            t.nome_estudio as estudio_nome, t.slug as estudio_slug,
            t.logo_url as estudio_logo, t.cor_destaque as estudio_cor
       from galerias g
       join tenants t on t.id = g.tenant_id
      where t.slug = $1 and g.slug = $2 and g.publicada`,
    [estudioSlug, galeriaSlug],
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
  }>(
    `select id, chave, chave_thumb, chave_preview, nome_original, tipo, bytes, largura, altura
       from medias
      where galeria_id = $1 and pronto
      order by ordem, criado_em`,
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
export function gerarHashSenhaGaleria(senha: string): string {
  const sal = createHash("sha256").update(segredo()).digest("hex").slice(0, 16);
  return createHash("sha256").update(sal + senha).digest("hex");
}

export function conferirSenhaGaleria(senha: string, hashGuardado: string): boolean {
  const a = Buffer.from(gerarHashSenhaGaleria(senha));
  const b = Buffer.from(hashGuardado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const cookieDaGaleria = (galeriaId: string) => `g_${galeriaId.slice(0, 8)}`;

function assinarLiberacao(galeriaId: string, expira: number): string {
  return createHmac("sha256", segredo()).update(`${galeriaId}.${expira}`).digest("hex");
}

/** Guarda que este visitante já acertou a senha — 7 dias, para não pedir a cada visita. */
export async function liberarAcesso(galeriaId: string) {
  const expira = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const jar = await cookies();
  jar.set(cookieDaGaleria(galeriaId), `${expira}.${assinarLiberacao(galeriaId, expira)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function temAcessoLiberado(galeriaId: string): Promise<boolean> {
  const jar = await cookies();
  const valor = jar.get(cookieDaGaleria(galeriaId))?.value;
  if (!valor) return false;

  const [expira, assinatura] = valor.split(".");
  if (!expira || !assinatura) return false;
  if (Number(expira) < Date.now()) return false;

  const esperada = assinarLiberacao(galeriaId, Number(expira));
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
  const ipHash = dados.ip
    ? createHash("sha256")
        .update(segredo() + dados.ip)
        .digest("hex")
        .slice(0, 32)
    : null;

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
