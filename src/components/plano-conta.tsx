"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { planos, formatarReais, type Plano } from "@/config/planos";
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

          <ul className="mt-3 space-y-1">
            {planos.map((p) => {
              const atual = p.id === planoAtual;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={ocupado || atual}
                    onClick={() => trocar(p)}
                    className={`flex w-full items-baseline justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                      atual
                        ? "cursor-default bg-carbon-2 text-texto-faint"
                        : "text-texto-soft hover:bg-carbon-2 hover:text-texto disabled:opacity-50"
                    }`}
                  >
                    <span>
                      {p.nome}
                      {atual && <span className="ml-2 text-[11px]">· atual</span>}
                    </span>
                    <span className="tabular-nums">{formatarReais(p.precoCentavos)}</span>
                  </button>
                </li>
              );
            })}
          </ul>

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
