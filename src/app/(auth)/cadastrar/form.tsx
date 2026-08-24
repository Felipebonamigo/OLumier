"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { cadastrarAction, type EstadoForm } from "../actions";
import { Campo, Erro, BotaoEnviar } from "@/components/form-ui";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Criar conta</BotaoEnviar>;
}

export function FormCadastrar() {
  const [estado, action] = useActionState<EstadoForm, FormData>(cadastrarAction, {});

  return (
    <form action={action} className="mt-8 flex flex-col gap-4">
      <Campo
        label="Nome do estúdio"
        name="nome_estudio"
        required
        autoComplete="organization"
        placeholder="Caroline Tedesco Fotografia"
        dica="Aparece nas galerias e vira o endereço do seu link."
      />
      <Campo
        label="E-mail"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="voce@estudio.com.br"
      />
      <Campo
        label="Senha"
        name="senha"
        type="password"
        required
        autoComplete="new-password"
        minLength={8}
        placeholder="mínimo 8 caracteres"
      />

      {/* Sem escolha de plano aqui, de propósito: ver a tabela de preços antes
          de ter subido a primeira foto só produz chute. O plano é escolhido na
          Conta, quando a assinatura começa. */}
      <p className="text-xs text-texto-faint">
        14 dias grátis para testar. Sem cartão agora — o plano você escolhe depois, no painel.
      </p>

      <Erro mensagem={estado.erro} />
      <Botao />
    </form>
  );
}
