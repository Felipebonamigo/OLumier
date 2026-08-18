import "server-only";
import { consultar, consultarUm } from "./db";
import { calcularVencimento } from "@/config/prazos";

/**
 * Cofre: a galeria fica um tempo no ar e depois desce, sem nada ser apagado.
 *
 * É a promessa que nenhum concorrente faz — neles, plano cancelado ou galeria
 * vencida significa entrega perdida. Aqui o link sai do ar e o arquivo continua,
 * reativável em um clique. Do lado do negócio, é o que faz um cliente com anos
 * de entregas guardadas não cancelar.
 */

// Constantes e cálculos puros vivem em config/prazos — a tela do painel é um
// componente de cliente e não pode importar um módulo server-only.
export { PRAZOS, PRAZO_PADRAO, calcularVencimento, diasAteArquivar } from "@/config/prazos";

export async function definirPrazo(
  galeriaId: string,
  tenantId: string,
  meses: number | null,
): Promise<void> {
  /*
   * O prazo conta a partir de AGORA, não da data do evento: o fotógrafo às vezes
   * publica meses depois do casamento, e contar do evento entregaria ao casal uma
   * galeria já vencida.
   */
  const expira = calcularVencimento(meses);
  await consultar(
    `update galerias set expira_em = $1, atualizado_em = now()
      where id = $2 and tenant_id = $3`,
    [expira, galeriaId, tenantId],
  );
}

/** Manda a galeria para o cofre agora, sem esperar o prazo. */
export async function arquivarAgora(galeriaId: string, tenantId: string) {
  await consultar(
    `update galerias
        set estado = 'arquivada', arquivada_em = now(), atualizado_em = now()
      where id = $1 and tenant_id = $2 and estado = 'online'`,
    [galeriaId, tenantId],
  );
}

/**
 * Tira a galeria do cofre. Estende o prazo por mais 12 meses a partir de hoje —
 * reativar e a galeria vencer de novo na semana seguinte seria uma armadilha.
 */
export async function reativar(galeriaId: string, tenantId: string) {
  await consultar(
    `update galerias
        set estado = 'online',
            arquivada_em = null,
            expira_em = case when expira_em is null then null
                             else now() + interval '12 months' end,
            atualizado_em = now()
      where id = $1 and tenant_id = $2 and estado = 'arquivada'`,
    [galeriaId, tenantId],
  );
}

/**
 * Arquiva tudo que venceu. Chamada pelo temporizador diário do servidor.
 * Devolve o que arquivou para o log — silêncio total esconde tarefa quebrada.
 */
export async function arquivarVencidas() {
  return consultar<{ id: string; titulo: string; estudio: string }>(
    `update galerias g
        set estado = 'arquivada', arquivada_em = now(), atualizado_em = now()
       from tenants t
      where t.id = g.tenant_id
        and g.estado = 'online'
        and g.expira_em is not null
        and g.expira_em < now()
      returning g.id, g.titulo, t.nome_estudio as estudio`,
  );
}

/** Espaço no ar × espaço no cofre — o fotógrafo vê os dois separados. */
export async function usoPorEstado(tenantId: string) {
  const r = await consultarUm<{ no_ar: string; no_cofre: string }>(
    `select
       coalesce(sum(m.bytes) filter (where g.estado = 'online'), 0)::text     as no_ar,
       coalesce(sum(m.bytes) filter (where g.estado = 'arquivada'), 0)::text  as no_cofre
     from medias m
     join galerias g on g.id = m.galeria_id
     where m.tenant_id = $1 and m.pronto`,
    [tenantId],
  );
  return { noAr: BigInt(r?.no_ar ?? "0"), noCofre: BigInt(r?.no_cofre ?? "0") };
}
