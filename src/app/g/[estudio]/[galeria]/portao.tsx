"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { entrarNaGaleriaAction, type EstadoSenha } from "./actions";
import { Campo, Erro, BotaoEnviar } from "@/components/form-ui";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Abrir galeria</BotaoEnviar>;
}

export function PortaoDeSenha({
  estudio,
  galeria,
  titulo,
  nomeEstudio,
}: {
  estudio: string;
  galeria: string;
  titulo: string;
  nomeEstudio: string;
}) {
  const [estado, action] = useActionState<EstadoSenha, FormData>(entrarNaGaleriaAction, {});

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-texto-soft">
        {nomeEstudio}
      </p>
      <h1 className="mt-4 font-serif text-3xl font-bold tracking-tight">{titulo}</h1>
      <p className="mt-3 text-sm text-texto-soft">
        Esta galeria é protegida. Digite a senha que você recebeu junto com o link.
      </p>

      <form action={action} className="mt-8 flex flex-col gap-4 text-left">
        <input type="hidden" name="estudio" value={estudio} />
        <input type="hidden" name="galeria" value={galeria} />
        <Campo
          label="Senha"
          name="senha"
          type="password"
          required
          autoFocus
          autoComplete="off"
          placeholder="••••••••"
        />
        <Erro mensagem={estado.erro} />
        <Botao />
      </form>
    </main>
  );
}
