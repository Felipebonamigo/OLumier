import "server-only";
import { consultar, consultarUm } from "./db";
import type { CustoDaSociedade, CustoLido } from "./custos-da-sociedade-regras";

/**
 * OS CUSTOS DA SOCIEDADE — leitura e escrita da tabela (migração 047).
 *
 * As regras (ler o valor, validar, somar) estão em
 * `custos-da-sociedade-regras.ts`; aqui é só o banco. Quem escreve é o admin,
 * pela tela do caixa — e toda escrita guarda quem foi.
 */

export async function listarCustos(): Promise<CustoDaSociedade[]> {
  return consultar<CustoDaSociedade>(
    `select c.id, c.nome, c.sistema, c.centavos_por_mes, c.confirmado, c.nota, c.atualizado_em,
            t.email as atualizado_por_nome
       from custos_da_sociedade c
       left join tenants t on t.id = c.atualizado_por
      order by case c.sistema when 'galeria' then 0 when 'atomatiza' then 1 else 2 end,
               c.centavos_por_mes desc, c.nome`,
  );
}

/** Cria (sem `id`) ou atualiza. Devolve a linha gravada, ou null se o `id` não existe. */
export async function gravarCusto(
  id: string | null,
  custo: CustoLido,
  adminId: string,
): Promise<{ id: string; nome: string } | null> {
  const valores = [custo.nome, custo.sistema, custo.centavosPorMes, custo.confirmado, custo.nota, adminId];
  if (!id) {
    return consultarUm<{ id: string; nome: string }>(
      `insert into custos_da_sociedade (nome, sistema, centavos_por_mes, confirmado, nota, atualizado_por)
       values ($1, $2, $3, $4, $5, $6)
       returning id, nome`,
      valores,
    );
  }
  return consultarUm<{ id: string; nome: string }>(
    `update custos_da_sociedade
        set nome = $1, sistema = $2, centavos_por_mes = $3, confirmado = $4, nota = $5,
            atualizado_por = $6, atualizado_em = now()
      where id = $7
      returning id, nome`,
    [...valores, id],
  );
}

/** Apaga. Devolve o que foi apagado — para a auditoria dizer o quê. */
export async function apagarCusto(
  id: string,
): Promise<{ nome: string; sistema: string; centavos_por_mes: number } | null> {
  return consultarUm(
    `delete from custos_da_sociedade where id = $1 returning nome, sistema, centavos_por_mes`,
    [id],
  );
}
