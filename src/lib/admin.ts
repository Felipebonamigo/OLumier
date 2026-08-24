import "server-only";
import { consultar } from "./db";

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
 */

export interface LinhaAdmin {
  id: string;
  nome_estudio: string;
  email: string;
  slug: string;
  plano_id: string;
  status: string;
  trial_ate: Date | null;
  criado_em: Date;
  cpf_cnpj: string | null;
  tem_assinatura: boolean;
  quota_bytes: string;
  quota_cofre_bytes: string;
  bytes_no_ar: string;
  bytes_no_cofre: string;
  galerias: number;
  publicadas: number;
  medias: number;
  ultimo_acesso: Date | null;
}

/**
 * Uma consulta só para todos os estúdios.
 *
 * Poderia ser uma por estúdio, e seria mais fácil de ler — mas viraria dezenas
 * de idas ao banco numa página de suporte que alguém abre justamente quando
 * está com pressa. As subconsultas agregadas resolvem em uma viagem.
 */
export async function panoramaDosEstudios(): Promise<LinhaAdmin[]> {
  return consultar<LinhaAdmin>(`
    select
      t.id, t.nome_estudio, t.email, t.slug, t.plano_id, t.status,
      t.trial_ate, t.criado_em, t.cpf_cnpj,
      (t.asaas_assinatura_id is not null) as tem_assinatura,
      t.quota_bytes, t.quota_cofre_bytes,
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
      (select count(*)::int from galerias g where g.tenant_id = t.id) as galerias,
      (select count(*)::int from galerias g where g.tenant_id = t.id and g.publicada) as publicadas,
      (select count(*)::int from medias m
         join galerias g on g.id = m.galeria_id
        where g.tenant_id = t.id and m.pronto) as medias,
      (select max(a.criado_em) from acessos a
         join galerias g on g.id = a.galeria_id
        where g.tenant_id = t.id) as ultimo_acesso
    from tenants t
    order by t.criado_em desc
  `);
}
