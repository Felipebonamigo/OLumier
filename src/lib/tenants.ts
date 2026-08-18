import "server-only";
import { consultar, consultarUm } from "./db";
import { gerarHashSenha, conferirSenha } from "./auth";
import { planoPorId, GB } from "@/config/planos";

export interface Tenant {
  id: string;
  slug: string;
  nome_estudio: string;
  email: string;
  logo_url: string | null;
  cor_destaque: string;
  plano_id: string;
  quota_bytes: string; // bigint chega como string do pg — nunca converter cegamente para Number
  usado_bytes: string;
  status: string;
  trial_ate: Date | null;
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
  permite_download: boolean;
  bytes_total: string;
  expira_em: Date | null;
  arquivada_em: Date | null;
  aparencia: unknown;
  capa_media_id: string | null;
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
}) {
  const plano = planoPorId(dados.planoId);
  if (!plano) throw new Error("Plano inválido");

  // Slug único: se "ana-fotografia" existir, vira "ana-fotografia-2", e assim por diante.
  const base = gerarSlug(dados.nomeEstudio) || "estudio";
  let slug = base;
  for (let i = 2; !(await slugDisponivel(slug)); i++) slug = `${base}-${i}`;

  const senhaHash = await gerarHashSenha(dados.senha);
  const quota = BigInt(plano.quotaGb) * BigInt(GB);

  const linha = await consultarUm<Tenant>(
    `insert into tenants (slug, nome_estudio, email, senha_hash, plano_id, quota_bytes)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [slug, dados.nomeEstudio, dados.email.toLowerCase(), senhaHash, plano.id, quota.toString()],
  );
  return linha!;
}

export async function autenticar(email: string, senha: string): Promise<Tenant | null> {
  const t = await consultarUm<Tenant & { senha_hash: string }>(
    "select * from tenants where lower(email) = lower($1)",
    [email],
  );
  if (!t) return null;
  const ok = await conferirSenha(senha, t.senha_hash);
  return ok ? t : null;
}

export async function listarGalerias(tenantId: string) {
  return consultar<Galeria>(
    `select g.*,
            (select count(*)::int from medias m where m.galeria_id = g.id and m.pronto) as total_medias
       from galerias g
      where g.tenant_id = $1
      order by coalesce(g.data_evento, g.criado_em::date) desc, g.criado_em desc`,
    [tenantId],
  );
}

export async function criarGaleria(dados: {
  tenantId: string;
  titulo: string;
  subtitulo?: string;
  dataEvento?: string;
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
    `insert into galerias (tenant_id, slug, titulo, subtitulo, data_evento)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [dados.tenantId, slug, dados.titulo, dados.subtitulo || null, dados.dataEvento || null],
  );
}

export async function apagarGaleria(tenantId: string, galeriaId: string) {
  // O tenant_id no where não é redundante: impede que um id adivinhado apague galeria de outro.
  await consultar("delete from galerias where id = $1 and tenant_id = $2", [galeriaId, tenantId]);
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
