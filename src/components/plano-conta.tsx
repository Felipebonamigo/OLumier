"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { planoPorId, type Plano } from "@/config/planos";
import { MontadorPlano } from "@/components/montador-plano";
import { trocarPlanoAction, cancelarAssinaturaAction } from "@/app/painel/actions";

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
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();
  const atual = planoPorId(planoAtual);

  const trocar = (p: Plano) =>
    iniciar(async () => {
      setErro(null);
      setOk(null);
      const r = await trocarPlanoAction(p.id);
      if (r?.erro) setErro(r.erro);
      else {
        setOk(r?.ok ?? null);
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
                atual
                  ? { segmento: atual.segmento, galeriaGb: atual.quotaGb, cofreGb: atual.cofreGb }
                  : undefined
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
        </p>
      )}
    </div>
  );
}
