"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { definirSenhaNovaAction, type EstadoNovaSenha } from "../../actions";
import { Erro, BotaoEnviar } from "@/components/form-ui";
import { CampoSenha } from "@/components/campo-senha";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Salvar senha nova</BotaoEnviar>;
}

export function FormNovaSenha({ token, minimo }: { token: string; minimo: number }) {
  const [estado, action] = useActionState<EstadoNovaSenha, FormData>(definirSenhaNovaAction, {});

  return (
    <form action={action} className="mt-8 flex flex-col gap-4">
      {/* O token viaja no corpo, não na URL da submissão: assim ele não entra no
          histórico do navegador nem em log de servidor com query string. */}
      <input type="hidden" name="token" value={token} />

      <CampoSenha
        label="Senha nova"
        name="senha"
        
        autoComplete="new-password"
        required
        minLength={minimo}
        placeholder="••••••••"
        dica={`Pelo menos ${minimo} caracteres.`}
      />
      <CampoSenha
        label="Repita a senha"
        name="senha_repetida"
        
        autoComplete="new-password"
        required
        minLength={minimo}
        placeholder="••••••••"
      />

      <Erro mensagem={estado.erro} />
      <Botao />
    </form>
  );
}
