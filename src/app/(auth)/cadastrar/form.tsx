"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { cadastrarAction, type EstadoForm } from "../actions";
import { Campo, Erro, BotaoEnviar } from "@/components/form-ui";
import { CampoSenha } from "@/components/campo-senha";
import { formatarDocumento, soDigitos } from "@/lib/documento";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Criar conta</BotaoEnviar>;
}

export function FormCadastrar({ minimo }: { minimo: number }) {
  const [estado, action] = useActionState<EstadoForm, FormData>(cadastrarAction, {});
  const [documento, setDocumento] = useState("");

  return (
    <form action={action} className="mt-8 flex flex-col gap-4">
      <Campo
        label="Nome do estúdio"
        name="nome_estudio"
        required
        autoComplete="organization"
        placeholder="Seu estúdio"
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
      {/* Um documento, uma conta: é o que impede o teste grátis de ser emendado
          num outro com e-mail novo (migração 045). A mesma máscara da tela de
          assinatura — só formata com o número completo, para não atrapalhar
          quem está corrigindo um dígito. */}
      <Campo
        label="CPF ou CNPJ"
        name="documento"
        required
        inputMode="numeric"
        autoComplete="off"
        value={documento}
        onChange={(e) => {
          const d = soDigitos(e.target.value).slice(0, 14);
          setDocumento(d.length === 11 || d.length === 14 ? formatarDocumento(d) : d);
        }}
        placeholder="000.000.000-00"
        dica="Do titular da conta. Uma conta por CPF ou CNPJ — o mesmo que vai na assinatura."
      />
      <CampoSenha
        label="Senha"
        name="senha"
        required
        autoComplete="new-password"
        minLength={minimo}
        placeholder={`mínimo ${minimo} caracteres`}
      />
      {/* A confirmação é conferida de novo no servidor (`conferirSenhaNova`).
          Este campo existe para a pessoa descobrir o erro de digitação AGORA, e
          não na hora de entrar — quando ela ainda não sabe que existe "esqueci
          minha senha" e conclui que o sistema quebrou. */}
      <CampoSenha
        label="Repita a senha"
        name="senha_confirmacao"
        required
        autoComplete="new-password"
        minLength={minimo}
        placeholder="a mesma de cima"
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
