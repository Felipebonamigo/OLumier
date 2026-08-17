"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { entrarAction, type EstadoForm } from "../actions";
import { Campo, Erro, BotaoEnviar } from "@/components/form-ui";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Entrar</BotaoEnviar>;
}

export function FormEntrar({ proximo }: { proximo?: string }) {
  const [estado, action] = useActionState<EstadoForm, FormData>(entrarAction, {});

  return (
    <form action={action} className="mt-8 flex flex-col gap-4">
      {proximo ? <input type="hidden" name="proximo" value={proximo} /> : null}

      <Campo
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="voce@estudio.com.br"
      />
      <Campo
        label="Senha"
        name="senha"
        type="password"
        autoComplete="current-password"
        required
        placeholder="••••••••"
      />

      <Erro mensagem={estado.erro} />
      <Botao />
    </form>
  );
}
