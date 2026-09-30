"use client";

import { useState, useTransition } from "react";
import { FUSO } from "@/config/fuso";
import { useRouter } from "next/navigation";
import { formatarReais, planoPorId, type Plano } from "@/config/planos";
import { MontadorPlano } from "@/components/montador-plano";
import {
  trocarPlanoAction,
  cancelarAssinaturaAction,
  cotarCancelamentoAction,
  cotarTrocaDePlanoAction,
} from "@/app/painel/actions";
import { RETENCAO_POR_EXTENSO } from "@/config/retencao";

type Cotacao = Exclude<Awaited<ReturnType<typeof cotarTrocaDePlanoAction>>, { erro: string }>;
type CotacaoDoCancelamento = Exclude<Awaited<ReturnType<typeof cotarCancelamentoAction>>, { erro: string }>;

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/**
 * O texto da confirmação — o que vai acontecer com o dinheiro, antes do clique.
 *
 * Subir cobra só a diferença proporcional ao que falta do período já pago
 * (`config/troca-de-plano.ts`); a tela diz o valor, até quando e onde ele sai.
 * Descer não devolve nada, e diz isso também.
 */
function textoDaConfirmacao(p: Plano, c: Cotacao): string {
  const depois = `Depois, ${formatarReais(c.precoNovoCentavos)} por ${c.anual ? "ano" : "mês"}.`;
  const ate = c.ate ? new Date(c.ate).toLocaleDateString("pt-BR", { timeZone: FUSO }) : null;
  if (c.tipo === "descida") {
    return `Descer para ${p.nome}?\n\nO que já foi pago não volta, e o preço menor vale a partir da próxima fatura.\n${depois}`;
  }
  if (c.cobrar && ate) {
    const onde = c.cartao ? `cobrada agora no ${c.cartao}` : "numa fatura com Pix, boleto ou cartão";
    return `Mudar para ${p.nome}?\n\nVocê paga só a diferença até ${ate}: ${formatarReais(c.diferencaCentavos)}, ${onde}.\n${depois}`;
  }
  if (c.diferencaCentavos > 0 && ate) {
    return `Mudar para ${p.nome}?\n\nA diferença até ${ate} é de ${formatarReais(c.diferencaCentavos)} e fica por nossa conta.\n${depois}`;
  }
  return `Mudar para ${p.nome}?\n\nNada é cobrado agora. ${depois}`;
}

/**
 * Trocar de plano e cancelar.
 *
 * Fica escondido atrás de um clique porque não é decisão do dia a dia: quem
 * abre a tela de Conta quase sempre quer ver quanto de espaço sobrou, não mudar
 * de plano. Deixar a lista sempre aberta empurraria uma decisão que ninguém
 * pediu — e deixaria "cancelar" à mão o tempo todo.
 */
export function PlanoConta({
  planoAtual,
  temAssinatura,
}: {
  planoAtual: string;
  temAssinatura: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [urlDaDiferenca, setUrlDaDiferenca] = useState<string | null>(null);
  const [cancelamento, setCancelamento] = useState<CotacaoDoCancelamento | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();
  const atual = planoPorId(planoAtual);

  const trocar = (p: Plano) =>
    iniciar(async () => {
      setErro(null);
      setOk(null);
      setUrlDaDiferenca(null);
      const c = await cotarTrocaDePlanoAction(p.id);
      if ("erro" in c) {
        setErro(c.erro);
        return;
      }
      if (!confirm(textoDaConfirmacao(p, c))) return;
      const r = await trocarPlanoAction(p.id, c.diferencaCentavos);
      if (r?.erro) setErro(r.erro);
      else {
        setOk(r?.ok ?? null);
        setUrlDaDiferenca(r?.urlDaDiferenca ?? null);
        setAberto(false);
        router.refresh();
      }
    });

  /* Cancelar abre um painel, e não um `confirm()`: com devolução, há duas
   * saídas legítimas (receber o dinheiro e sair hoje, ou usar até o fim), e a
   * pessoa precisa ver o valor antes de escolher. */
  const abrirCancelamento = () =>
    iniciar(async () => {
      setErro(null);
      setOk(null);
      const c = await cotarCancelamentoAction();
      if ("erro" in c) setErro(c.erro);
      else setCancelamento(c);
    });

  const cancelar = (devolverCentavos: number | null) =>
    iniciar(async () => {
      setErro(null);
      setOk(null);
      const r = await cancelarAssinaturaAction(devolverCentavos);
      if (r?.erro) setErro(r.erro);
      else {
        setOk(r?.ok ?? null);
        setCancelamento(null);
        router.refresh();
      }
    });

  const pagoAteFuturo = cancelamento?.usoAte ?? null;

  return (
    <div className="mt-4">
      {!aberto ? (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="text-xs text-texto-soft underline underline-offset-4 hover:text-texto"
        >
          Mudar de plano
        </button>
      ) : (
        <div className="rounded-lg border border-linha bg-void p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-texto-soft">Escolha o plano</span>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-xs text-texto-faint hover:text-texto-soft"
            >
              fechar
            </button>
          </div>

          {/*
           * O montador começa no plano que a pessoa já tem: abrir no padrão
           * faria a tela sugerir uma troca que ninguém pediu, e ainda esconderia
           * o que está contratado hoje.
           */}
          <div className="mt-3">
            <MontadorPlano
              inicial={
                atual ? { segmento: atual.segmento, espacoGb: atual.quotaGb } : undefined
              }
              acao={(p) =>
                p.id === planoAtual ? (
                  <span className="text-xs text-texto-faint">É o seu plano de hoje</span>
                ) : (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => trocar(p)}
                    className="rounded-full bg-acento px-5 py-2 text-sm font-semibold text-void disabled:opacity-50"
                  >
                    {ocupado ? "Mudando…" : "Mudar para este"}
                  </button>
                )
              }
            />
          </div>

          <p className="mt-3 text-[11px] text-texto-faint">
            Descer de plano só é possível se o que você já guardou couber no tamanho novo.
          </p>
        </div>
      )}

      {temAssinatura && (
        <>
          <span className="mx-2 text-texto-faint">·</span>
          <button
            type="button"
            disabled={ocupado}
            onClick={abrirCancelamento}
            className="text-xs text-texto-faint underline underline-offset-4 hover:text-erro disabled:opacity-50"
          >
            Cancelar assinatura
          </button>
        </>
      )}

      {cancelamento && (
        <div className="mt-3 rounded-lg border border-linha bg-void p-3 text-xs leading-relaxed text-texto-soft">
          <div className="flex items-baseline justify-between">
            <span className="font-medium text-texto">Cancelar a assinatura</span>
            <button
              type="button"
              onClick={() => setCancelamento(null)}
              className="text-texto-faint hover:text-texto-soft"
            >
              voltar
            </button>
          </div>

          {cancelamento.devolverCentavos > 0 ? (
            <p className="mt-2">
              {cancelamento.regra === "arrependimento"
                ? "Você está dentro dos 7 dias do pagamento, então pode receber tudo de volta: "
                : `Você já usou ${cancelamento.mesesUsados} ${cancelamento.mesesUsados === 1 ? "mês" : "meses"} do período. Pode receber de volta o que pagou menos esses meses, cada um pelo preço mensal: `}
              <strong className="text-texto">{formatarReais(cancelamento.devolverCentavos)}</strong>. Com a
              devolução, o período acaba hoje e o dinheiro volta em até {cancelamento.prazoDaDevolucao}, pelo
              mesmo meio de pagamento.
              {pagoAteFuturo && ` Sem ela, você continua enviando até ${dia(pagoAteFuturo)}.`}
            </p>
          ) : (
            <p className="mt-2">
              {pagoAteFuturo
                ? `Você continua enviando arquivos até ${dia(pagoAteFuturo)}, que é o fim do período já pago. Não há valor a devolver neste período.`
                : "Você deixa de conseguir enviar arquivos novos."}
            </p>
          )}

          <p className="mt-2">
            Depois do fim do período, as galerias publicadas ficam no ar por mais {RETENCAO_POR_EXTENSO}. Antes
            de apagar qualquer arquivo, avisamos por e-mail — e reativar até lá mantém tudo.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {cancelamento.devolverCentavos > 0 && (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => cancelar(cancelamento.devolverCentavos)}
                className="rounded-full border border-erro/50 px-4 py-1.5 font-medium text-erro disabled:opacity-50"
              >
                Cancelar e receber {formatarReais(cancelamento.devolverCentavos)}
              </button>
            )}
            {(cancelamento.devolverCentavos === 0 || pagoAteFuturo) && (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => cancelar(null)}
                className="rounded-full border border-linha px-4 py-1.5 text-texto-soft hover:text-erro disabled:opacity-50"
              >
                {cancelamento.devolverCentavos > 0 && pagoAteFuturo
                  ? `Cancelar e usar até ${dia(pagoAteFuturo)}`
                  : "Confirmar o cancelamento"}
              </button>
            )}
          </div>
        </div>
      )}

      {erro && (
        <p role="alert" className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta">
          {erro}
        </p>
      )}
      {ok && (
        <p role="status" className="mt-3 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok">
          {ok}
          {urlDaDiferenca && (
            <a
              href={urlDaDiferenca}
              target="_blank"
              rel="noreferrer"
              className="ml-1 font-medium underline underline-offset-4"
            >
              Pagar a diferença ↗
            </a>
          )}
        </p>
      )}
    </div>
  );
}
