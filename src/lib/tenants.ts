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
    `insert into tenants (slug, nome_estudio, email, senha_hash, plano_id, quota_bytes)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [slug, dados.nomeEstudio, dados.email.toLowerCase(), senhaHash, plano.id, quota.toString()],
  );
  return linha!;
}

/*
 * Hash descartável, com o mesmo custo de um real.
 *
 * Serve para gastar o MESMO tempo quando o e-mail não existe. Sem isso, a
 * resposta para um e-mail desconhecido volta na hora e a de um cliente demora o
 * scrypt inteiro — e essa diferença, medida de fora, revela quem é cliente do
 * Olumier. A mensagem na tela já é única de propósito; o relógio contava a
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

export async function listarGalerias(tenantId: string) {
  return consultar<Galeria>(
    `select g.*,
            (select count(*)::int from medias m where m.galeria_id = g.id and m.pronto) as total_medias
       from galerias g
      where g.tenant_id = $1 and g.estado <> 'lixeira'
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

  await consultar(
    `update galerias
        set estado = 'online', apagada_em = null, atualizado_em = now()
      where id = $1 and tenant_id = $2 and estado = 'lixeira'`,
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
 * Chamada só pela limpeza da lixeira e pelo "esvaziar agora" do painel. NÃO
 * apaga do espelho — a segunda cópia é justamente o que sobra quando tudo mais
 * falhou, e apagá-la aqui transformaria este script no risco que ele deveria
 * cobrir.
 */
export async function destruirGaleria(galeriaId: string, chaves: string[]) {
  /*
   * Lido antes do delete, pelo mesmo motivo de sempre: depois não existe mais
   * de onde tirar. Este é o evento que alguém vai procurar anos depois — é o
   * único registro de que aquela galeria existiu.
   */
  const antes = await consultarUm<{ titulo: string; tenant_id: string; estudio: string }>(
    `select g.titulo, g.tenant_id, t.nome_estudio as estudio
       from galerias g join tenants t on t.id = g.tenant_id
      where g.id = $1`,
    [galeriaId],
  );

  const apagou = await consultar<{ id: string }>(
    "delete from galerias where id = $1 returning id",
    [galeriaId],
  );

  if (apagou.length > 0 && antes) {
    const { registrarEvento, ACOES } = await import("./eventos");
    await registrarEvento({
      tenantId: antes.tenant_id,
      estudio: antes.estudio,
      // Quem destruiu foi o temporizador, não a pessoa — e a distinção importa
      // numa disputa: prova que o prazo correu, não que alguém mandou apagar.
      ator: "sistema",
      acao: ACOES.GALERIA_DESTRUIDA,
      alvoTipo: "galeria",
      alvoId: galeriaId,
      detalhe: { titulo: antes.titulo, arquivos: chaves.length, apos_dias: PRAZO_LIXEIRA_DIAS },
    });
  }

  if (apagou.length === 0 || chaves.length === 0) return;

  // O banco já é a fonte da verdade e a galeria já sumiu. Se o bucket falhar
  // aqui, registramos e seguimos — `varrer-orfaos.mjs` recolhe o que sobrar.
  const { apagarObjetos } = await import("./r2");
  try {
    await apagarObjetos(chaves);
  } catch (e) {
    console.error(
      `[destruirGaleria] ${chaves.length} objeto(s) da galeria ${galeriaId} podem ter ficado no bucket:`,
      e,
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
