import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { exigirAdmin, metadataDeAdmin } from "@/lib/portao-admin";
import { asaasConfigurado, asaasEmProducao, pagamentosAReceber, pagamentosRecebidos } from "@/lib/asaas";
import { panoramaDosEstudios } from "@/lib/admin";
import { resumoDaPlataforma } from "@/lib/metricas-admin";
import { listarCustos } from "@/lib/custos-da-sociedade";
import { devolucoesPendentes, PRAZO_DA_DEVOLUCAO, type DevolucaoPendente } from "@/lib/devolucao";
import {
  SISTEMAS_DO_CUSTO,
  ERROS_DO_CUSTO,
  ehErroDoCusto,
  somarCustos,
  type CustoDaSociedade,
  type SistemaDoCusto,
} from "@/lib/custos-da-sociedade-regras";
import {
  NOME_DO_SISTEMA,
  SISTEMAS,
  carteirasConhecidas,
  limitesDoMes,
  mesDeBrasilia,
  mesValido,
  mesVizinho,
  montarCaixa,
  nomeDoMes,
  resumirSociedade,
  SISTEMAS_DA_SOCIEDADE,
  type ResumoDaSociedade,
  somarAReceber,
  type CaixaDoMes,
  type AReceber,
  type Sistema,
} from "@/lib/caixa-dos-socios";
import { SOCIOS } from "@/config/socios";
import { formatarReais } from "@/config/planos";
import { Bloco, Cartao, data, dataHora, porcento } from "@/components/admin-pecas";
import { apagarCustoAction, salvarCustoAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return metadataDeAdmin("Caixa dos sócios");
}

export const dynamic = "force-dynamic";

/**
 * O CAIXA DOS SÓCIOS — Galeria Átomo e Atomatiza numa página só.
 *
 * Felipe, 29/09/2026: os mesmos três sócios nos dois produtos, com a
 * porcentagem de cada um mudando de um para o outro. A receita vem do Asaas
 * (a conta é uma só), já com o desconto do pacote e com o que o split mandou
 * para cada carteira; o custo vem da lista que os sócios mantêm aqui mesmo.
 * O porquê de cada escolha está em `lib/caixa-dos-socios.ts` e na migração 047.
 *
 * Como a tela das fotos da página inicial, é exceção à regra de só leitura do
 * admin, e cabe nela pelo mesmo motivo: o que muda aqui é a LISTA de custos —
 * nenhum dinheiro, conta ou cobrança —, e cada mudança fica na auditoria.
 */

const OK: Record<string, string> = {
  criado: "Custo cadastrado.",
  alterado: "Custo atualizado.",
  apagado: "Custo apagado.",
};

type Leitura =
  | {
      tipo: "ok";
      mes: string;
      caixa: CaixaDoMes;
      aReceber: AReceber;
      /** O cartão aprovado, pelo mesmo caminho do caixa: quanto vai para cada carteira quando cair. */
      aReceberPorCarteira: CaixaDoMes;
      incompleto: boolean;
    }
  | { tipo: "sem-asaas" }
  | { tipo: "erro"; mensagem: string };

async function lerAsaas(mes: string): Promise<Leitura> {
  if (!asaasConfigurado()) return { tipo: "sem-asaas" };
  const { de, ate } = limitesDoMes(mes);
  try {
    const [recebidos, confirmados] = await Promise.all([pagamentosRecebidos(de, ate), pagamentosAReceber()]);
    return {
      tipo: "ok",
      mes,
      caixa: montarCaixa(recebidos.pagamentos, carteirasConhecidas()),
      aReceber: somarAReceber(confirmados.pagamentos),
      aReceberPorCarteira: montarCaixa(confirmados.pagamentos, carteirasConhecidas(), new Set(["CONFIRMED"])),
      incompleto: recebidos.incompleto || confirmados.incompleto,
    };
  } catch (e) {
    console.error("[caixa] leitura do Asaas falhou:", e);
    return { tipo: "erro", mensagem: e instanceof Error ? e.message : String(e) };
  }
}

export default async function CaixaDosSociosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirAdmin();
  const params = await searchParams;
  const hoje = mesDeBrasilia();
  const pedido = mesValido(params.mes);
  const mes = pedido && pedido <= hoje ? pedido : hoje;

  const [leitura, custos, estudios, devolucoes] = await Promise.all([
    lerAsaas(mes),
    /* Sem a migração 047 a tabela não existe: a página abre com a lista vazia
       e avisa, em vez de cair. */
    listarCustos().then(
      (lista) => ({ lista, ok: true as const }),
      () => ({ lista: [] as CustoDaSociedade[], ok: false as const }),
    ),
    panoramaDosEstudios(),
    /* Sem a migração 052, lista vazia em vez de página caída. */
    devolucoesPendentes().catch(() => [] as DevolucaoPendente[]),
  ]);

  const armazenamento = resumoDaPlataforma(estudios).custoMensalCentavos;
  const soma = somarCustos(custos.lista, armazenamento);

  const okMsg = typeof params.ok === "string" ? OK[params.ok] : undefined;
  const erroMsg = ehErroDoCusto(params.erro) ? ERROS_DO_CUSTO[params.erro] : undefined;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/painel/admin" className="text-sm text-texto-soft hover:text-texto">
        ← Administração
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">Caixa dos sócios</h1>
      <p className="mt-1 max-w-3xl text-sm text-texto-soft">
        Galeria Átomo e Atomatiza juntos: o que entrou na conta do Asaas, para onde foi cada real e
        quanto custa manter os dois no ar.
      </p>

      <nav className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-label="Mês">
        <Link
          href={`/painel/admin/caixa?mes=${mesVizinho(mes, -1)}`}
          className="text-texto-soft hover:text-texto"
        >
          ‹ {nomeDoMes(mesVizinho(mes, -1))}
        </Link>
        <span className="font-semibold">{maiuscula(nomeDoMes(mes))}</span>
        {mes < hoje && (
          <Link
            href={`/painel/admin/caixa?mes=${mesVizinho(mes, 1)}`}
            className="text-texto-soft hover:text-texto"
          >
            {nomeDoMes(mesVizinho(mes, 1))} ›
          </Link>
        )}
        {leitura.tipo === "ok" && !asaasEmProducao() && (
          <span className="rounded-full border border-alerta/40 bg-alerta/10 px-2 py-0.5 text-[11px] text-alerta">
            Asaas de teste (sandbox)
          </span>
        )}
      </nav>

      {okMsg && (
        <p className="mt-6 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">{okMsg}</p>
      )}
      {erroMsg && (
        <p className="mt-6 rounded-lg border border-erro/40 bg-erro/10 px-3 py-2 text-sm text-erro">{erroMsg}</p>
      )}

      {devolucoes.length > 0 && <Devolucoes lista={devolucoes} />}

      {leitura.tipo === "sem-asaas" && (
        <Aviso>O Asaas não está configurado neste ambiente: dá para ver e mudar os custos, não a receita.</Aviso>
      )}
      {leitura.tipo === "erro" && (
        <Aviso>
          Não consegui ler o Asaas agora ({leitura.mensagem}). Os custos abaixo continuam valendo; recarregue
          a página em instantes para ver a receita.
        </Aviso>
      )}

      {leitura.tipo === "ok" && <Receita leitura={leitura} />}

      {leitura.tipo === "ok" && <AReceberNoCartao aReceber={leitura.aReceber} />}

      <Custos custos={custos.lista} tabelaOk={custos.ok} armazenamento={armazenamento} mes={mes} />

      <Resultado leitura={leitura} soma={soma} />

      {leitura.tipo === "ok" && <Pagamentos caixa={leitura.caixa} />}

      <p className="mt-12 max-w-3xl text-xs text-texto-faint">
        Fora desta conta: a comissão que o Atomatiza recebe em cobranças feitas pelas contas dos
        fornecedores (ela cai como repasse de cobranças de outras contas, não como pagamento desta),
        estornos e o que foi lançado à mão fora do Asaas.
      </p>
    </main>
  );
}

/**
 * Devolução pedida ao cancelar e ainda não estornada (`lib/devolucao.ts`).
 * Fica no topo: é dinheiro que já é do cliente, com prazo prometido nos Termos.
 * Some sozinha quando o aviso de estorno do Asaas chega.
 */
function Devolucoes({ lista }: { lista: DevolucaoPendente[] }) {
  return (
    <section className="mt-6 rounded-lg border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
      <h2 className="font-semibold">
        {plural(lista.length, "devolução a fazer", "devoluções a fazer")} (prazo: {PRAZO_DA_DEVOLUCAO})
      </h2>
      <ul className="mt-2 space-y-1">
        {lista.map((d) => (
          <li key={d.id}>
            {d.nome_estudio}: <strong>{formatarReais(d.valor_centavos)}</strong> da cobrança{" "}
            <code className="text-xs">{d.cobranca_asaas_id}</code> — pedida em{" "}
            {new Date(d.pedida_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} (
            {d.regra === "arrependimento" ? "arrependimento" : "proporcional"})
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs">
        Estornar esse valor dessa cobrança no painel do Asaas. O aviso de estorno fecha a linha.
      </p>
    </section>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-sm text-alerta">
      {children}
    </p>
  );
}

/** Galeria e Atomatiza sempre; o pacote e o "sem produto", só se houver. */
const SEMPRE: Sistema[] = ["galeria", "atomatiza"];

/** Os produtos com dinheiro no mês. */
function sistemasComDinheiro(caixa: CaixaDoMes): Sistema[] {
  return SISTEMAS.filter((s) => SEMPRE.includes(s) || caixa.porSistema[s].pagamentos > 0);
}

/* Só a primeira letra: `capitalize` do CSS faria "Setembro De 2026". */
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// ── 1. O QUE ENTROU ─────────────────────────────────────────────────────────

function Receita({ leitura }: { leitura: Extract<Leitura, { tipo: "ok" }> }) {
  const { caixa, aReceber, incompleto } = leitura;
  const sistemas = sistemasComDinheiro(caixa);
  const sociedade = resumirSociedade(caixa, leitura.aReceberPorCarteira);

  return (
    <>
      <Bloco
        titulo="O que entrou"
        explicacao="Pagamentos que caíram na conta do Asaas no mês, já com o desconto do pacote. Pix e boleto caem no dia em que o cliente paga; cartão, quando o Asaas libera — até lá ele está em “A receber no cartão”, logo abaixo. Quem paga por ano só aparece no mês em que pagou."
      >
        {incompleto && (
          <Aviso>
            A lista passou de 3.000 pagamentos e foi cortada: os números abaixo estão incompletos.
          </Aviso>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {sistemas.map((s) => (
            <Cartao
              key={s}
              rotulo={NOME_DO_SISTEMA[s]}
              valor={formatarReais(caixa.porSistema[s].brutoCentavos)}
              nota={`${plural(caixa.porSistema[s].pagamentos, "pagamento", "pagamentos")}${s === "outros" ? " · não é da sociedade" : ""}`}
            />
          ))}
          <Cartao
            rotulo="Taxas do Asaas"
            valor={formatarReais(caixa.total.taxaCentavos)}
            nota={porcento(caixa.total.brutoCentavos ? caixa.total.taxaCentavos / caixa.total.brutoCentavos : 0)}
          />
          <Cartao
            rotulo="Líquido dos produtos"
            valor={formatarReais(sociedade.liquidoCentavos)}
            nota="o que sobra para dividir"
            tom="ok"
          />
          <Cartao
            rotulo="A receber no cartão"
            valor={formatarReais(aReceber.totalCentavos)}
            nota={
              aReceber.pagamentos.length > 0 ? (
                <a href="#a-receber" className="underline underline-offset-2 hover:text-texto">
                  {plural(aReceber.pagamentos.length, "pagamento aprovado", "pagamentos aprovados")} — ver de onde
                </a>
              ) : (
                "nada esperando"
              )
            }
          />
        </div>
      </Bloco>

      <Socios caixa={caixa} sociedade={sociedade} mes={leitura.mes} />
    </>
  );
}

// ── 2. OS SÓCIOS ────────────────────────────────────────────────────────────

/**
 * Um cartão por sócio — Felipe, 01/10/2026: "as infos dos sócios não estão
 * claras". O porquê está em `resumirSociedade` (`lib/caixa-dos-socios.ts`).
 */
function Socios({ caixa, sociedade, mes }: { caixa: CaixaDoMes; sociedade: ResumoDaSociedade; mes: string }) {
  const produtos = SISTEMAS_DA_SOCIEDADE.filter((s) => SEMPRE.includes(s) || caixa.porSistema[s].pagamentos > 0);
  const dono = sociedade.socios.find((s) => s.donoDaConta)?.nome ?? null;
  const fora = sociedade.foraDaSociedade;
  const aReceber = sociedade.socios.reduce((t, s) => t + s.aReceberCentavos, 0);

  /** De onde sai a porcentagem de cada produto, em palavras. */
  const regra = (socioId: string, s: Sistema, centavos: number) => {
    if (s === "galeria") {
      const acordo = SOCIOS.find((x) => x.id === socioId)?.percentual;
      return acordo !== undefined ? `acordo: ${acordo}% do lucro` : "";
    }
    const liquido = caixa.porSistema[s].liquidoCentavos;
    if (s === "atomatiza") return liquido > 0 ? `${porcento(centavos / liquido)} do que entrou` : "";
    return "as duas partes juntas";
  };

  const partes: { nome: string; centavos: number }[] = [
    ...sociedade.socios.map((s) => ({ nome: s.nome, centavos: s.totalCentavos })),
    { nome: "Reserva de custo", centavos: sociedade.reservaCentavos },
    ...(sociedade.operacaoCentavos > 0 ? [{ nome: "Caixa da operação", centavos: sociedade.operacaoCentavos }] : []),
    ...(sociedade.outrasCarteirasCentavos > 0
      ? [{ nome: "Outras carteiras", centavos: sociedade.outrasCarteirasCentavos }]
      : []),
  ];

  return (
    <Bloco
      titulo="Quanto cada sócio levou"
      explicacao={`O que cada um recebeu em ${nomeDoMes(mes).split(" ")[0]}, dos pagamentos da Galeria e do Atomatiza que já caíram na conta. Embaixo de cada um, o que ainda vem do cartão já aprovado.`}
    >
      <div className="grid gap-3 md:grid-cols-3">
        {sociedade.socios.map((s) => (
          <div key={s.id} className="rounded-xl border border-linha bg-carbon p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold">{s.nome}</h3>
              <span className="text-xl font-semibold tabular-nums text-ok">{formatarReais(s.totalCentavos)}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-texto-faint">
              {s.donoDaConta
                ? "fica na conta principal do Asaas, que é a dele"
                : s.semCarteira
                  ? "sem carteira do Asaas configurada: fica na conta principal"
                  : `o Asaas repassa direto para a carteira de ${s.nome}`}
            </p>
            <ul className="mt-3 divide-y divide-linha text-sm">
              {produtos.map((p) => (
                <li key={p} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span>
                    {NOME_DO_SISTEMA[p]}
                    <span className="block text-[11px] text-texto-faint">{regra(s.id, p, s.porSistema[p])}</span>
                  </span>
                  <span className="tabular-nums">{formatarReais(s.porSistema[p])}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 border-t border-linha pt-2 text-xs text-texto-soft">
              {s.aReceberCentavos > 0 ? (
                <>
                  + <strong className="tabular-nums">{formatarReais(s.aReceberCentavos)}</strong> quando o cartão
                  aprovado cair
                </>
              ) : (
                <span className="text-texto-faint">nada a receber do cartão</span>
              )}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-linha p-4 text-sm">
        <p className="font-mono text-[10px] uppercase tracking-widest text-texto-faint">Como o líquido fecha</p>
        <p className="mt-2 tabular-nums leading-7">
          <strong>{formatarReais(sociedade.liquidoCentavos)}</strong> dos produtos ={" "}
          {partes.map((x, i) => (
            <Fragment key={x.nome}>
              {i > 0 && " + "}
              <span className="whitespace-nowrap">
                {x.nome} {formatarReais(x.centavos)}
              </span>
            </Fragment>
          ))}
        </p>
        <ul className="mt-2 space-y-1 text-xs text-texto-faint">
          {dono && (
            <li>
              {dono}: o Asaas não manda repasse para a própria conta, então a parte dele não sai — fica na conta
              principal. Na Galeria ela é calculada pelo acordo a partir do que os outros receberam na mesma
              cobrança (estimativa: o Asaas arredonda cada fatia); no Atomatiza é o que não foi repassado.
            </li>
          )}
          <li>
            Reserva de custo: a parte da Galeria que fica na conta para pagar o armazenamento (Backblaze e
            Cloudflare), com a folga para o dólar e a taxa do cartão. O lucro que sobra é dividido{" "}
            {SOCIOS.map((x) => `${x.nome} ${x.percentual}%`).join(", ")}.
          </li>
          <li>Atomatiza: a divisão é a configurada no servidor de lá, sobre o que entrou; não tem reserva.</li>
          {caixa.porSistema.pacote.pagamentos > 0 && (
            <li>
              Pacote: uma fatura só com os dois produtos. A parte do {dono ?? "dono da conta"} no pacote fica junto
              com a reserva, porque o Asaas não separa as duas.
            </li>
          )}
          {aReceber > 0 && (
            <li>
              O que vem do cartão é o split que o Asaas já registrou nos pagamentos aprovados; entra na conta de
              cada um na data em que o cartão cair (ver &ldquo;A receber no cartão&rdquo;).
            </li>
          )}
          {caixa.repassesQueNaoSairam > 0 && (
            <li className="text-erro">
              {plural(caixa.repassesQueNaoSairam, "repasse foi cancelado ou recusado", "repasses foram cancelados ou recusados")}{" "}
              pelo Asaas: o dinheiro ficou na conta principal. Confira no painel do Asaas.
            </li>
          )}
        </ul>
      </div>

      {fora.pagamentos > 0 && (
        <p className="mt-3 rounded-xl border border-linha bg-carbon/40 px-4 py-3 text-xs text-texto-soft">
          <strong>Fora da sociedade:</strong> {plural(fora.pagamentos, "cobrança", "cobranças")} sem produto na
          mesma conta do Asaas (lançadas à mão no painel de lá), {formatarReais(fora.liquidoCentavos)} líquidos —{" "}
          {formatarReais(fora.repassadoCentavos)} repassados para outras carteiras e{" "}
          {formatarReais(fora.naContaCentavos)} na conta principal. Não entra na conta dos sócios nem no resultado.
        </p>
      )}

      <ParaOndeFoi caixa={caixa} sistemas={sistemasComDinheiro(caixa)} />
    </Bloco>
  );
}

// ── 2c. A RECEBER NO CARTÃO ─────────────────────────────────────────────────

/**
 * Juan, 30/09/2026, olhando o total a receber: "é possível esse dado mostrar
 * de onde tá vindo isso e quantas entradas pendentes de cada plataforma?" e
 * "quando ele libera?". Não depende do mês escolhido: é o que está aprovado
 * e esperando hoje.
 */
function AReceberNoCartao({ aReceber }: { aReceber: AReceber }) {
  const th = "px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-texto-faint";
  const sistemas = SISTEMAS.filter((s) => SEMPRE.includes(s) || aReceber.porSistema[s].pagamentos > 0);
  const linhas = aReceber.pagamentos.slice(0, LIMITE_DE_LINHAS);
  const espera =
    aReceber.diasAteCair !== null
      ? ` Nestes, o Asaas libera em média ${plural(aReceber.diasAteCair, "dia", "dias")} depois da aprovação.`
      : "";

  return (
    <section id="a-receber" className="scroll-mt-6">
      <Bloco
        titulo="A receber no cartão"
        explicacao={`Cartão aprovado que o Asaas ainda não liberou: o cliente já pagou, o dinheiro ainda não está na conta. Cada pagamento cai na data que o próprio Asaas informa, e entra em “O que entrou” no mês em que cair.${espera} Isto é o que está esperando hoje, qualquer que seja o mês escolhido acima.`}
      >
        {aReceber.pagamentos.length === 0 ? (
          <p className="text-sm text-texto-faint">Nenhum pagamento de cartão esperando liberação.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {sistemas.map((s) => (
                <Cartao
                  key={s}
                  rotulo={NOME_DO_SISTEMA[s]}
                  valor={formatarReais(aReceber.porSistema[s].liquidoCentavos)}
                  nota={plural(aReceber.porSistema[s].pagamentos, "pagamento", "pagamentos")}
                />
              ))}
              {aReceber.porMes.map((m) => (
                <Cartao
                  key={m.mes || "sem-data"}
                  rotulo={m.mes ? `Cai em ${nomeDoMes(m.mes).split(" ")[0]}` : "Sem data do Asaas"}
                  valor={formatarReais(m.liquidoCentavos)}
                  nota={plural(m.pagamentos, "pagamento", "pagamentos")}
                />
              ))}
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-linha">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-linha bg-carbon text-left">
                    <th className={th}>Cai em</th>
                    <th className={th}>Produto</th>
                    <th className={th}>Descrição</th>
                    <th className={th}>Aprovado em</th>
                    <th className={`${th} text-right`}>Pago</th>
                    <th className={`${th} text-right`}>Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((p) => (
                    <tr key={p.id} className="border-b border-linha align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums">
                        {p.caiEm ? data(`${p.caiEm}T12:00:00`) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs">{NOME_DO_SISTEMA[p.sistema]}</td>
                      <td className="px-4 py-2 text-xs">{p.descricao}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums text-texto-faint">
                        {p.aprovadoEm ? data(`${p.aprovadoEm}T12:00:00`) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatarReais(p.brutoCentavos)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatarReais(p.liquidoCentavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {aReceber.pagamentos.length > LIMITE_DE_LINHAS && (
              <p className="mt-2 text-xs text-texto-faint">
                Mostrando os {LIMITE_DE_LINHAS} que caem primeiro, de {aReceber.pagamentos.length}. Os totais
                contam todos.
              </p>
            )}
          </>
        )}
      </Bloco>
    </section>
  );
}

// ── 2b. POR CARTEIRA, COMO O ASAAS REGISTROU ─────────────────────────────────

function ParaOndeFoi({ caixa, sistemas }: { caixa: CaixaDoMes; sistemas: Sistema[] }) {
  const semCarteira = caixa.destinos.filter((d) => d.destino.semCarteira).map((d) => d.destino.nome);
  const temDesconhecida = caixa.destinos.some((d) => d.destino.tipo === "desconhecida");
  const th = "px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-texto-faint";

  return (
    <details className="mt-4 rounded-xl border border-linha bg-carbon/40 p-4">
      <summary className="cursor-pointer text-sm font-semibold">Ver por carteira, como o Asaas registrou</summary>
      <p className="mt-1 text-xs text-texto-faint">
        Cada carteira que recebeu dinheiro da conta no mês, por produto — inclusive o que não é da sociedade. A
        porcentagem é sobre o líquido daquele produto.
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-linha">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-linha bg-carbon text-left">
              <th className={th}>Para</th>
              {sistemas.map((s) => (
                <th key={s} className={`${th} text-right`}>
                  {NOME_DO_SISTEMA[s]}
                </th>
              ))}
              <th className={`${th} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {caixa.destinos.map((d) => (
              <tr
                key={d.destino.chave}
                className={`border-b border-linha last:border-0 ${d.destino.tipo === "conta" ? "bg-carbon/60" : ""}`}
              >
                <td className="px-4 py-2.5">
                  <span className={d.destino.tipo === "desconhecida" ? "text-alerta" : "font-medium"}>
                    {d.destino.nome}
                  </span>
                  {d.destino.semCarteira && (
                    <span className="ml-2 text-[11px] text-texto-faint">sem carteira configurada aqui</span>
                  )}
                  {d.destino.donoDaConta && (
                    <span className="block text-[11px] text-texto-faint">fica na conta principal, que é dele</span>
                  )}
                  {d.destino.tipo === "conta" && (
                    <span className="block text-[11px] text-texto-faint">fica na conta principal</span>
                  )}
                </td>
                {sistemas.map((s) => (
                  <td key={s} className="px-4 py-2.5 text-right tabular-nums">
                    {formatarReais(d.porSistema[s])}
                    <span className="block text-[11px] text-texto-faint">
                      {caixa.porSistema[s].liquidoCentavos > 0
                        ? porcento(d.porSistema[s] / caixa.porSistema[s].liquidoCentavos)
                        : "—"}
                    </span>
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                  {formatarReais(d.totalCentavos)}
                  <span className="block text-[11px] font-normal text-texto-faint">
                    {caixa.total.liquidoCentavos > 0 ? porcento(d.totalCentavos / caixa.total.liquidoCentavos) : "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-linha bg-carbon">
              <td className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-texto-faint">
                Líquido
              </td>
              {sistemas.map((s) => (
                <td key={s} className="px-4 py-2.5 text-right font-semibold tabular-nums">
                  {formatarReais(caixa.porSistema[s].liquidoCentavos)}
                </td>
              ))}
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                {formatarReais(caixa.total.liquidoCentavos)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ul className="mt-3 max-w-3xl space-y-1 text-xs text-texto-faint">
        {semCarteira.length > 0 && (
          <li className="text-alerta">
            Sem carteira do Asaas configurada na Galeria: {semCarteira.join(", ")}. O que o Atomatiza repassou
            para essa pessoa aparece numa linha &ldquo;Carteira …&rdquo;.
          </li>
        )}
        {temDesconhecida && (
          <li className="text-alerta">
            &ldquo;Carteira …&rdquo; é uma carteira que recebeu repasse e que a Galeria não conhece pelo nome —
            os seis últimos caracteres são do código dela no Asaas.
          </li>
        )}
        {caixa.repassesQueNaoSairam > 0 && (
          <li className="text-erro">
            {plural(caixa.repassesQueNaoSairam, "repasse foi cancelado ou recusado", "repasses foram cancelados ou recusados")}{" "}
            pelo Asaas: o dinheiro ficou na conta principal. Confira no painel do Asaas.
          </li>
        )}
      </ul>
    </details>
  );
}

// ── 3. CUSTOS ───────────────────────────────────────────────────────────────

const campo =
  "w-full rounded-lg border border-linha bg-void px-3 py-2 text-sm placeholder:text-exemplo focus:border-acento focus:outline-none";
const rotulo = "block font-mono text-[10px] uppercase tracking-widest text-texto-faint";
const botao =
  "rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto";

const reaisNoCampo = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Custos({
  custos,
  tabelaOk,
  armazenamento,
  mes,
}: {
  custos: CustoDaSociedade[];
  tabelaOk: boolean;
  armazenamento: number;
  mes: string;
}) {
  const soma = somarCustos(custos, armazenamento);
  const grupos: { sistema: SistemaDoCusto; titulo: string; total: number; vazio: string }[] = [
    {
      sistema: "galeria",
      titulo: "Só da Galeria Átomo",
      total: soma.galeria,
      vazio: "",
    },
    {
      sistema: "atomatiza",
      titulo: "Só do Atomatiza",
      total: soma.atomatiza,
      vazio: "Nenhum custo cadastrado ainda — o servidor de banco, o e-mail, o domínio de lá.",
    },
    {
      sistema: "os-dois",
      titulo: "Dos dois — contado uma vez",
      total: soma.osDois,
      vazio: "Nenhum custo dos dois cadastrado.",
    },
  ];

  return (
    <section id="custos" className="scroll-mt-6">
      <Bloco
        titulo="Custos por mês"
        explicacao="A lista de hoje, a mesma para qualquer mês escolhido. O que é dos dois produtos (mesmo CNPJ, mesmo servidor) entra uma vez só."
      >
        {!tabelaOk && (
          <Aviso>A tabela de custos ainda não existe neste banco (migração 047). A lista aparece depois dela.</Aviso>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {grupos.map((g) => {
            const linhas = custos.filter((c) => c.sistema === g.sistema);
            return (
              <div key={g.sistema} className="rounded-xl border border-linha bg-carbon p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold">{g.titulo}</h3>
                  <span className="font-semibold tabular-nums">{formatarReais(g.total)}</span>
                </div>
                <ul className="mt-3 divide-y divide-linha">
                  {g.sistema === "galeria" && (
                    <li className="py-2.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span>Armazenamento (Backblaze + Cloudflare)</span>
                        <span className="tabular-nums">{formatarReais(armazenamento)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-texto-faint">
                        Calculado do que está guardado hoje — muda sozinho com o uso.
                      </p>
                    </li>
                  )}
                  {linhas.map((c) => (
                    <LinhaDeCusto key={c.id} custo={c} mes={mes} />
                  ))}
                  {linhas.length === 0 && g.vazio && (
                    <li className="py-2.5 text-xs text-texto-faint">{g.vazio}</li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>

        {tabelaOk && (
          <details className="mt-4 rounded-xl border border-linha bg-carbon p-4">
            <summary className="cursor-pointer text-sm font-semibold">+ Cadastrar um custo</summary>
            <FormularioDeCusto mes={mes} />
          </details>
        )}

        {soma.estimativas > 0 && (
          <p className="mt-3 text-xs text-texto-faint">
            {plural(soma.estimativas, "valor é estimativa", "valores são estimativa")} — marcados com ~. Confira
            na fatura e marque &ldquo;conferido&rdquo;.
          </p>
        )}
      </Bloco>
    </section>
  );
}

function LinhaDeCusto({ custo, mes }: { custo: CustoDaSociedade; mes: string }) {
  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{custo.nome}</span>
        <span className="tabular-nums">
          {!custo.confirmado && custo.centavos_por_mes > 0 && (
            <span className="mr-1 text-alerta" title="estimativa, ainda não conferida">
              ~
            </span>
          )}
          {formatarReais(custo.centavos_por_mes)}
        </span>
      </div>
      {custo.nota && <p className="mt-0.5 text-[11px] text-texto-faint">{custo.nota}</p>}
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-texto-faint hover:text-texto">editar</summary>
        <FormularioDeCusto mes={mes} custo={custo} />
        <p className="mt-2 text-[11px] text-texto-faint">
          Última mudança: {dataHora(custo.atualizado_em)}
          {custo.atualizado_por_nome ? ` · ${custo.atualizado_por_nome}` : ""}
        </p>
        <form action={apagarCustoAction} className="mt-2">
          <input type="hidden" name="id" value={custo.id} />
          <input type="hidden" name="mes" value={mes} />
          <button type="submit" className="text-[11px] text-erro underline underline-offset-4">
            Apagar este custo
          </button>
        </form>
      </details>
    </li>
  );
}

function FormularioDeCusto({ mes, custo }: { mes: string; custo?: CustoDaSociedade }) {
  return (
    <form action={salvarCustoAction} className="mt-3 grid gap-3">
      {custo && <input type="hidden" name="id" value={custo.id} />}
      <input type="hidden" name="mes" value={mes} />
      <label>
        <span className={rotulo}>Nome</span>
        <input name="nome" required maxLength={80} defaultValue={custo?.nome} className={`mt-1 ${campo}`} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className={rotulo}>De qual</span>
          <select name="sistema" defaultValue={custo?.sistema ?? "atomatiza"} className={`mt-1 ${campo}`}>
            {SISTEMAS_DO_CUSTO.map((s) => (
              <option key={s.valor} value={s.valor}>
                {s.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={rotulo}>R$ por mês</span>
          <input
            name="valor"
            required
            inputMode="decimal"
            placeholder="0,00"
            defaultValue={custo ? reaisNoCampo(custo.centavos_por_mes) : undefined}
            className={`mt-1 ${campo} tabular-nums`}
          />
        </label>
      </div>
      <label>
        <span className={rotulo}>Nota</span>
        <input
          name="nota"
          maxLength={300}
          defaultValue={custo?.nota}
          placeholder="de onde vem o valor, onde conferir"
          className={`mt-1 ${campo}`}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirmado" defaultChecked={custo?.confirmado ?? false} />
        Conferido na fatura (não é estimativa)
      </label>
      <div>
        <button type="submit" className={botao}>
          {custo ? "Salvar" : "Cadastrar"}
        </button>
      </div>
    </form>
  );
}

// ── 4. RESULTADO ────────────────────────────────────────────────────────────

function Resultado({ leitura, soma }: { leitura: Leitura; soma: ReturnType<typeof somarCustos> }) {
  if (leitura.tipo !== "ok") {
    return (
      <Bloco titulo="Resultado do mês" explicacao="Precisa da receita do Asaas.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cartao rotulo="Custos dos dois" valor={formatarReais(soma.total)} nota="por mês, hoje" />
        </div>
      </Bloco>
    );
  }

  const { porSistema } = leitura.caixa;
  /* Só os produtos da sociedade: o "sem produto" não é dinheiro dos sócios. */
  const liquido = resumirSociedade(leitura.caixa, null).liquidoCentavos;
  const resultado = liquido - soma.total;
  const daGaleria = porSistema.galeria.liquidoCentavos - soma.galeria;
  const doAtomatiza = porSistema.atomatiza.liquidoCentavos - soma.atomatiza;
  const tom = (v: number): "ok" | "erro" => (v >= 0 ? "ok" : "erro");

  return (
    <Bloco
      titulo="Resultado do mês"
      explicacao={`Líquido do mês menos os custos de hoje. Cada produto aparece com o que é só dele; o que é dos dois sai uma vez, no total.${porSistema.pacote.pagamentos > 0 ? " O pacote entra só no total: a fatura dele é dos dois produtos juntos." : ""}`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Cartao rotulo="Líquido dos dois" valor={formatarReais(liquido)} />
        <Cartao rotulo="Custos dos dois" valor={formatarReais(soma.total)} />
        <Cartao
          rotulo="Resultado"
          valor={formatarReais(resultado)}
          nota={resultado >= 0 ? "os dois se pagam" : "o mês não cobriu os custos"}
          tom={tom(resultado)}
        />
        <Cartao
          rotulo="Galeria Átomo"
          valor={formatarReais(daGaleria)}
          nota="líquido − custos só dela"
          tom={tom(daGaleria)}
        />
        <Cartao
          rotulo="Atomatiza"
          valor={formatarReais(doAtomatiza)}
          nota="líquido − custos só dele"
          tom={tom(doAtomatiza)}
        />
        <Cartao rotulo="Dos dois" valor={formatarReais(-soma.osDois)} nota="custo compartilhado" />
      </div>
    </Bloco>
  );
}

// ── 5. OS PAGAMENTOS ────────────────────────────────────────────────────────

const LIMITE_DE_LINHAS = 300;

function Pagamentos({ caixa }: { caixa: CaixaDoMes }) {
  const th = "px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-texto-faint";
  const linhas = caixa.pagamentos.slice(0, LIMITE_DE_LINHAS);

  return (
    <Bloco
      titulo="Pagamentos do mês"
      explicacao="Cada pagamento que entrou na conta, com o repasse que ele fez. É daqui que saem os números acima."
    >
      {linhas.length === 0 ? (
        <p className="text-sm text-texto-faint">Nenhum pagamento caiu na conta neste mês.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-linha">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-linha bg-carbon text-left">
                <th className={th}>Dia</th>
                <th className={th}>Produto</th>
                <th className={th}>Descrição</th>
                <th className={th}>Forma</th>
                <th className={`${th} text-right`}>Pago</th>
                <th className={`${th} text-right`}>Líquido</th>
                <th className={th}>Repasses</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((p) => (
                <tr key={p.id} className="border-b border-linha align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums text-texto-faint">
                    {p.dia ? data(`${p.dia}T12:00:00`) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs">{NOME_DO_SISTEMA[p.sistema]}</td>
                  <td className="px-4 py-2 text-xs">{p.descricao}</td>
                  <td className="px-4 py-2 text-xs text-texto-faint">{p.forma}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatarReais(p.brutoCentavos)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatarReais(p.liquidoCentavos)}</td>
                  <td className="px-4 py-2 text-xs">
                    {p.repasses.length === 0 ? (
                      <span className="text-texto-faint">nenhum — ficou tudo na conta</span>
                    ) : (
                      p.repasses.map((r, i) => (
                        <span key={i} className={`block ${r.saiu ? "" : "text-erro line-through"}`}>
                          {r.nome} {formatarReais(r.centavos)}
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {caixa.pagamentos.length > LIMITE_DE_LINHAS && (
        <p className="mt-2 text-xs text-texto-faint">
          Mostrando os {LIMITE_DE_LINHAS} mais recentes de {caixa.pagamentos.length}. Os totais acima contam todos.
        </p>
      )}
    </Bloco>
  );
}
