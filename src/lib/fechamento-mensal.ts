import "server-only";
import { consultar } from "./db";
import { panoramaDosEstudios } from "./admin";
import { resumoDaPlataforma, custoDasCortesiasCentavos } from "./metricas-admin";
import { listarCustos } from "./custos-da-sociedade";
import { custoFixoDaGaleriaCentavos } from "./custos-da-sociedade-regras";
import {
  mesDeBrasilia,
  mesesAte,
  montarMesAMes,
  numerosDoMes,
  type LinhaGravada,
  type LinhaMesAMes,
  type NumerosDoFechamento,
} from "./fechamento-mensal-regras";

/**
 * O FECHAMENTO MENSAL — escrever o mês corrente e ler os doze últimos.
 *
 * O porquê da tabela e o que ela NÃO guarda estão na migração 068; as regras
 * (que números, em que ordem) estão em `fechamento-mensal-regras.ts`. Aqui é só
 * o banco.
 */

/**
 * Os números do mês de HOJE em Brasília, calculados e NÃO gravados — a
 * simulação do temporizador (sem `--aplicar`) e a base de
 * `gravarFechamentoDoMes`. `agora` é parâmetro para o teste conduzir o relógio.
 *
 * Saem das MESMAS funções da página (`resumoDaPlataforma`, com o custo fixo da
 * lista do caixa), e é isso que impede o mês fechado de discordar do bloco
 * Dinheiro do dia.
 */
export async function fechamentoDoMes(
  agora: Date = new Date(),
): Promise<{ mes: string; numeros: NumerosDoFechamento }> {
  const [estudios, custos] = await Promise.all([panoramaDosEstudios(), listarCustos().catch(() => null)]);
  const resumo = resumoDaPlataforma(
    estudios,
    agora,
    custos && custos.length > 0 ? custoFixoDaGaleriaCentavos(custos) : undefined,
  );
  const mes = mesDeBrasilia(agora);
  return { mes, numeros: numerosDoMes(estudios, resumo, mes, custoDasCortesiasCentavos(estudios)) };
}

/**
 * Grava (ou regrava) a linha do mês de HOJE em Brasília — e só ela.
 *
 * O mês que passou nunca é tocado: é o que faz uma linha fechada continuar sendo
 * o retrato do fim daquele mês. O temporizador diário chama sem argumento.
 */
export async function gravarFechamentoDoMes(
  agora: Date = new Date(),
): Promise<{ mes: string; numeros: NumerosDoFechamento }> {
  const { mes, numeros: n } = await fechamentoDoMes(agora);

  await consultar(
    `insert into fechamentos_mensais
       (mes, registrado_em, estudios, novos, pagando, em_teste, inadimplentes, cancelados, cortesias,
        bytes_guardados, receita_centavos, custo_guardado_centavos, custo_fixo_centavos,
        cortesias_centavos, resultado_centavos)
     values ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (mes) do update set
       registrado_em = now(),
       estudios = excluded.estudios, novos = excluded.novos, pagando = excluded.pagando,
       em_teste = excluded.em_teste, inadimplentes = excluded.inadimplentes,
       cancelados = excluded.cancelados, cortesias = excluded.cortesias,
       bytes_guardados = excluded.bytes_guardados, receita_centavos = excluded.receita_centavos,
       custo_guardado_centavos = excluded.custo_guardado_centavos,
       custo_fixo_centavos = excluded.custo_fixo_centavos,
       cortesias_centavos = excluded.cortesias_centavos,
       resultado_centavos = excluded.resultado_centavos`,
    [
      mes,
      n.estudios,
      n.novos,
      n.pagando,
      n.emTeste,
      n.inadimplentes,
      n.cancelados,
      n.cortesias,
      n.bytesGuardados.toString(),
      n.receitaCentavos,
      n.custoGuardadoCentavos,
      n.custoFixoCentavos,
      n.cortesiasCentavos,
      n.resultadoCentavos,
    ],
  );
  return { mes, numeros: n };
}

/**
 * A tabela "Mês a mês": os últimos `quantos` meses, do mais novo para o mais
 * antigo.
 *
 * `vivo` são os números DE AGORA, que a página já calculou para o bloco
 * Dinheiro — entram no mês corrente no lugar do que está gravado. Passar `null`
 * (a tabela de fechamento ainda não existe, por exemplo) deixa o mês corrente
 * como "sem registro" em vez de derrubar a página.
 */
export async function mesAMes(
  vivo: NumerosDoFechamento | null,
  quantos = 12,
  agora: Date = new Date(),
): Promise<LinhaMesAMes[]> {
  const mesAtual = mesDeBrasilia(agora);
  const meses = mesesAte(mesAtual, quantos);
  const primeiro = meses[meses.length - 1];

  const [cadastros, antes, gravadas] = await Promise.all([
    /* O mês de Brasília, e não o de UTC: o mesmo corte do Caixa. Uma conta criada
       às 22h do dia 30 é do mês do dia 30. */
    consultar<{ mes: string; n: number }>(
      `select to_char(criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes, count(*)::int as n
         from tenants
        where to_char(criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM') >= $1
        group by 1`,
      [primeiro],
    ),
    consultar<{ n: number }>(
      `select count(*)::int as n from tenants
        where to_char(criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM') < $1`,
      [primeiro],
    ),
    consultar<LinhaGravada>(
      `select mes, registrado_em, estudios, novos, pagando, em_teste, inadimplentes, cancelados, cortesias,
              bytes_guardados::text as bytes_guardados, receita_centavos, custo_guardado_centavos,
              custo_fixo_centavos, cortesias_centavos, resultado_centavos
         from fechamentos_mensais where mes = any($1::text[])`,
      [meses],
    ).catch(() => [] as LinhaGravada[]),
  ]);

  return montarMesAMes(
    meses,
    Object.fromEntries(cadastros.map((c) => [c.mes, c.n])),
    antes[0]?.n ?? 0,
    gravadas,
    vivo,
    mesAtual,
  );
}

/** Reexportado para quem só precisa dos números do mês corrente, sem tocar no banco. */
export { numerosDoMes } from "./fechamento-mensal-regras";
