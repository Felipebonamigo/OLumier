"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarReais, planoPorId, type Plano } from "@/config/planos";
import { MontadorPlano } from "@/components/montador-plano";
import { trocarPlanoAction, cancelarAssinaturaAction, cotarTrocaDePlanoAction } from "@/app/painel/actions";

type Cotacao = Exclude<Awaited<ReturnType<typeof cotarTrocaDePlanoAction>>, { erro: string }>;

/**
 * O texto da confirmação — o que vai acontecer com o dinheiro, antes do clique.
 *
 * Subir cobra só a diferença proporcional ao que falta do período já pago
 * (`config/troca-de-plano.ts`); a tela diz o valor, até quando e onde ele sai.
 * Descer não devolve nada, e diz isso também.
 */
function textoDaConfirmacao(p: Plano, c: Cotacao): string {
  const depois = `Depois, ${formatarReais(c.precoNovoCentavos)} por ${c.anual ? "ano" : "mês"}.`;
  const ate = c.ate ? new Date(c.ate).toLocaleDateString("pt-BR") : null;
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

  const cancelar = () =>
    iniciar(async () => {
      setErro(null);
      setOk(null);
      const r = await cancelarAssinaturaAction();
      if (r?.erro) setErro(r.erro);
      else {
        setOk(r?.ok ?? null);
        router.refresh();
      }
    });

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
            onClick={() => {
              if (
                confirm(
                  "Cancelar a assinatura?\n\nSuas galerias já publicadas continuam no ar e nada é apagado. Você deixa de conseguir enviar arquivos novos.",
                )
              ) {
                cancelar();
              }
            }}
            className="text-xs text-texto-faint underline underline-offset-4 hover:text-erro disabled:opacity-50"
          >
            Cancelar assinatura
          </button>
        </>
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
