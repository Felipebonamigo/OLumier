"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { reenviarConfirmacaoAction, type EstadoReenvio } from "@/app/painel/actions";

function Botao() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-lg border border-linha-forte px-3 py-1.5 text-xs font-medium transition hover:bg-carbon disabled:opacity-60"
    >
      {pending ? "Enviando…" : "Mandar o link de novo"}
    </button>
  );
}

/**
 * O recado de e-mail por confirmar, no topo de toda tela do painel.
 *
 * No topo, e não só na hora do envio, porque a primeira coisa que a pessoa faz
 * depois de criar a conta é arrastar fotos — descobrir a regra ali, com 300
 * arquivos na fila, é o pior momento possível. Some sozinho depois do clique
 * no link: o layout só o desenha enquanto `precisaConfirmarEmail` diz que sim.
 *
 * O e-mail aparece por extenso para a pessoa ver na hora se digitou errado.
 * Não há troca de e-mail no painel; o caminho, nesse caso, é o WhatsApp.
 */
export function AvisoEmailPendente({ email, whatsapp }: { email: string; whatsapp: string }) {
  const [estado, action] = useActionState<EstadoReenvio, FormData>(
    () => reenviarConfirmacaoAction(),
    {},
  );

  return (
    <div className="border-b border-acento/30 bg-acento/5">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
        <p className="min-w-0 flex-1 leading-relaxed text-texto-soft">
          <strong className="text-texto">Confirme seu e-mail para enviar fotos e vídeos.</strong> Mandamos um
          link para <span className="break-all text-texto">{email}</span>. E-mail errado? Fale com a
          gente pelo WhatsApp <span className="whitespace-nowrap">{whatsapp}</span>.
        </p>
        <form action={action} className="flex flex-wrap items-center gap-3">
          {estado.enviado && (
            <span role="status" className="text-xs text-texto-soft">
              Link enviado.
            </span>
          )}
          {estado.erro && (
            <span role="alert" className="text-xs text-alerta">
              {estado.erro}
            </span>
          )}
          <Botao />
        </form>
      </div>
    </div>
  );
}
