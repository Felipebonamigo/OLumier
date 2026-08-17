"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { cadastrarAction, type EstadoForm } from "../actions";
import { Campo, Selecao, Erro, BotaoEnviar } from "@/components/form-ui";
import { planos, formatarReais } from "@/config/planos";

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

      <Selecao label="Plano" name="plano_id" defaultValue={planos.find((p) => p.destaque)?.id}>
        {planos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome} — {formatarReais(p.precoCentavos)}/mês
          </option>
        ))}
      </Selecao>

      <p className="text-xs text-texto-faint">
        14 dias grátis para testar. Sem cartão agora.
      </p>

      <Erro mensagem={estado.erro} />
      <Botao />
    </form>
  );
}
