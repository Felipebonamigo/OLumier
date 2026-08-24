"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { pedirRecuperacaoAction, type EstadoRecuperar } from "../actions";
import { Campo, Erro, BotaoEnviar } from "@/components/form-ui";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Enviar link</BotaoEnviar>;
}

export function FormRecuperar() {
  const [estado, action] = useActionState<EstadoRecuperar, FormData>(pedirRecuperacaoAction, {});

  /*
   * Confirmação deliberadamente vaga: "se existir uma conta".
   *
   * A tela não pode dizer se o e-mail está cadastrado. Se dissesse, bastaria
   * digitar o endereço de um estúdio para descobrir se ele é cliente nosso — e
   * a lista de clientes de uma plataforma não é informação pública.
   */
  if (estado.enviado) {
    return (
      <div
        role="status"
        className="mt-8 rounded-xl border border-linha bg-carbon p-5 text-sm text-texto-soft"
      >
        <p className="font-medium text-texto">Se existir uma conta com esse e-mail, o link já saiu.</p>
        <p className="mt-2">
          Ele vale por <strong className="text-texto-soft">1 hora</strong> e só funciona uma vez.
          Não chegou em alguns minutos? Confira o lixo eletrônico.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="mt-8 flex flex-col gap-4">
      <Campo
        label="E-mail da conta"
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="voce@estudio.com.br"
        dica="Mandamos um link para você criar uma senha nova."
      />
      <Erro mensagem={estado.erro} />
      <Botao />
    </form>
  );
}
