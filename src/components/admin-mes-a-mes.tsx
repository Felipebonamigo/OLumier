import Link from "next/link";
import { formatarReais } from "@/config/planos";
import { formatarBytes } from "@/lib/tenants";
import { dataHora } from "@/components/admin-pecas";
import type { LinhaMesAMes } from "@/lib/fechamento-mensal-regras";

/**
 * A TABELA "MÊS A MÊS" da Administração (09/10/2026).
 *
 * Felipe: "aqui vamos separar por mês as contas também, para termos o controle
 * dos custos, gastos, etc." Uma linha por mês, do mais novo para o mais antigo:
 * de um lado as CONTAS (cadastros, total, quem paga, quem testa, quem saiu), do
 * outro o DINHEIRO (receita recorrente, o que custa guardar, o custo fixo, o que
 * sobra) — os mesmos números do bloco Dinheiro, mês a mês.
 *
 * ── "SEM REGISTRO" NÃO É ZERO ─────────────────────────────────────────────
 *
 * Cadastros e total de contas são EXATOS em todos os meses: têm data no banco.
 * O resto (quem pagava, quanto espaço, quanto custava) só existe a partir do
 * primeiro fechamento — o banco guarda o status de hoje, não o de julho. Esses
 * meses mostram "sem registro", e a nota embaixo diz desde quando há. Um número
 * estimado por trás passaria por medido; um zero passaria por "ninguém pagava".
 *
 * Componente de servidor: nada aqui tem estado.
 */

const R = (c: number) => formatarReais(c);

function rotuloDoMes(mes: string) {
  return `${mes.slice(5)}/${mes.slice(0, 4)}`;
}

const SEM_REGISTRO = "sem registro: este mês foi anterior ao fechamento mensal — o banco guarda o status de hoje, não o daquele mês";

function Celula({
  valor,
  vazio,
  classe = "",
}: {
  valor: string | number | null;
  vazio: boolean;
  classe?: string;
}) {
  return (
    <td className={`px-2 py-1.5 text-right tabular-nums ${vazio ? "text-texto-faint" : classe}`} title={vazio ? SEM_REGISTRO : undefined}>
      {vazio ? "—" : valor}
    </td>
  );
}

export function TabelaMesAMes({ linhas }: { linhas: LinhaMesAMes[] }) {
  const gravadas = linhas.filter((l) => l.numeros && !l.aoVivo).map((l) => l.mes).sort();
  const primeiro = gravadas[0] ?? null;

  return (
    <div className="rounded-xl border border-linha bg-carbon">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-xs">
          <thead>
            <tr className="font-mono text-[9px] uppercase tracking-widest text-texto-faint">
              <th rowSpan={2} className="px-3 py-2 text-left align-bottom font-normal">
                Mês
              </th>
              <th colSpan={6} className="border-l border-linha px-2 pt-2 text-center font-normal">
                Contas
              </th>
              <th colSpan={4} className="border-l border-linha px-2 pt-2 text-center font-normal">
                Dinheiro (por mês)
              </th>
              <th rowSpan={2} className="border-l border-linha px-3 py-2 text-right align-bottom font-normal">
                Caixa
              </th>
            </tr>
            <tr className="font-mono text-[9px] uppercase tracking-widest text-texto-faint">
              <th className="border-l border-linha px-2 pb-2 text-right font-normal">Novas</th>
              <th className="px-2 pb-2 text-right font-normal">Total</th>
              <th className="px-2 pb-2 text-right font-normal">Pagando</th>
              <th className="px-2 pb-2 text-right font-normal">Em teste</th>
              <th className="px-2 pb-2 text-right font-normal">Inadimpl.</th>
              <th className="px-2 pb-2 text-right font-normal">Cancel.</th>
              <th className="border-l border-linha px-2 pb-2 text-right font-normal">Receita</th>
              <th className="px-2 pb-2 text-right font-normal">Armazen.</th>
              <th className="px-2 pb-2 text-right font-normal">Custo fixo</th>
              <th className="px-2 pb-2 text-right font-normal">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const n = l.numeros;
              const vazio = n === null;
              return (
                <tr key={l.mes} className="border-t border-linha">
                  <td className="px-3 py-1.5 text-left">
                    <span className="font-medium tabular-nums">{rotuloDoMes(l.mes)}</span>
                    {l.aoVivo ? (
                      <span className="ml-1.5 rounded-full border border-acento/40 bg-acento/10 px-1.5 py-0.5 text-[9px] text-acento">
                        em andamento
                      </span>
                    ) : l.registradoEm ? (
                      <span className="mt-0.5 block text-[10px] text-texto-faint" title="a última vez que o fechamento deste mês foi gravado">
                        gravado {dataHora(l.registradoEm)}
                      </span>
                    ) : null}
                  </td>
                  {/* Exatos em todo mês: têm data no banco. */}
                  <td className="border-l border-linha px-2 py-1.5 text-right tabular-nums">{l.cadastros}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.contasNoFim}</td>
                  <Celula valor={n?.pagando ?? null} vazio={vazio} classe="text-ok" />
                  <Celula valor={n?.emTeste ?? null} vazio={vazio} />
                  <Celula valor={n?.inadimplentes ?? null} vazio={vazio} classe={n && n.inadimplentes > 0 ? "text-alerta" : ""} />
                  <Celula valor={n?.cancelados ?? null} vazio={vazio} />
                  <td
                    className={`border-l border-linha px-2 py-1.5 text-right tabular-nums ${vazio ? "text-texto-faint" : ""}`}
                    title={vazio ? SEM_REGISTRO : undefined}
                  >
                    {n ? R(n.receitaCentavos) : "—"}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right tabular-nums ${vazio ? "text-texto-faint" : ""}`}
                    title={n ? `${formatarBytes(n.bytesGuardados)} guardados — custo do armazenamento` : SEM_REGISTRO}
                  >
                    {n ? R(n.custoGuardadoCentavos) : "—"}
                  </td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${vazio ? "text-texto-faint" : ""}`} title={vazio ? SEM_REGISTRO : undefined}>
                    {n ? R(n.custoFixoCentavos) : "—"}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-medium tabular-nums ${
                      n ? (n.resultadoCentavos >= 0 ? "text-ok" : "text-erro") : "text-texto-faint"
                    }`}
                    title={vazio ? SEM_REGISTRO : "receita menos o custo do que está guardado e o custo fixo"}
                  >
                    {n ? R(n.resultadoCentavos) : "—"}
                  </td>
                  <td className="border-l border-linha px-3 py-1.5 text-right">
                    <Link
                      href={`/painel/admin/caixa?mes=${l.mes}`}
                      className="text-acento underline underline-offset-4"
                      title="o que de fato caiu na conta naquele mês, lido do Asaas"
                    >
                      ver →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-linha px-3 py-2 text-[11px] leading-snug text-texto-faint">
        <strong className="font-medium text-texto-soft">Novas</strong> e <strong className="font-medium text-texto-soft">Total</strong>{" "}
        são exatos em todos os meses (têm data no banco).{" "}
        <strong className="font-medium text-texto-soft">Pagando, teste, receita e custos</strong>{" "}
        só existem a partir do fechamento mensal:{" "}
        {primeiro
          ? `o primeiro mês gravado é ${rotuloDoMes(primeiro)}; os anteriores ficam “sem registro”, sem estimativa.`
          : "ainda não há mês gravado — o primeiro registro entra na próxima madrugada, e os meses anteriores ficarão “sem registro”, sem estimativa."}{" "}
        O mês em andamento mostra os números de agora; cada mês fechado, o último retrato gravado nele (todo dia, de
        madrugada). <strong className="font-medium text-texto-soft">Receita</strong> é a recorrente, a mesma do bloco
        Dinheiro; o que de fato caiu na conta em cada mês está no Caixa dos sócios.
      </p>
    </div>
  );
}
