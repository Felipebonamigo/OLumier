"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { criarAssinaturaAction } from "@/app/painel/actions";

/** Ativa a assinatura. Fora do componente da página porque precisa de estado. */
export function AssinaturaBotao({
  temAssinatura,
  cobrancaLigada,
}: {
  temAssinatura: boolean;
  cobrancaLigada: boolean;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  if (!cobrancaLigada) {
    return (
      <p className="mt-4 rounded-lg border border-linha bg-void px-4 py-3 text-xs text-texto-faint">
        A cobrança ainda não foi ligada nesta instalação. Enquanto isso, o uso segue liberado.
      </p>
    );
  }

  if (temAssinatura) {
    return (
      <p className="mt-4 text-xs text-texto-faint">
        Assinatura criada. A próxima cobrança aparece aqui assim que for gerada.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={ocupado}
        onClick={() =>
          iniciar(async () => {
            setErro(null);
            const r = await criarAssinaturaAction();
            if (r?.erro) setErro(r.erro);
            else router.refresh();
          })
        }
        className="rounded-lg bg-luz px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-luz-alta disabled:opacity-50"
      >
        {ocupado ? "Criando…" : "Ativar assinatura"}
      </button>
      <p className="mt-2 text-xs text-texto-faint">
        Você escolhe entre Pix, boleto ou cartão na hora de pagar.
      </p>
      {erro && (
        <p role="alert" className="mt-2 text-xs text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
