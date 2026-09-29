"use client";

import { startTransition, useActionState, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { cadastrarAction, type EstadoForm } from "../actions";
import { Campo, Erro, BotaoEnviar } from "@/components/form-ui";
import { CampoSenha } from "@/components/campo-senha";
import { formatarDocumento, soDigitos } from "@/lib/documento";
import { lerPreenchimento, type Preenchimento } from "@/lib/preenchimento-cadastro";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Criar conta</BotaoEnviar>;
}

/* O fragmento da URL (`#documento=…`), para o cadastro que chega do botão do
 * Atomatiza já preenchido — ver `lib/preenchimento-cadastro.ts`. No servidor
 * não há fragmento: responde vazio, e o navegador preenche ao hidratar. */
function assinarFragmento(avisar: () => void) {
  window.addEventListener("hashchange", avisar);
  return () => window.removeEventListener("hashchange", avisar);
}

export function FormCadastrar({ minimo }: { minimo: number }) {
  const [estado, action] = useActionState<EstadoForm, FormData>(cadastrarAction, {});
  const fragmento = useSyncExternalStore(assinarFragmento, () => window.location.hash, () => "");
  const pre = useMemo(() => lerPreenchimento(fragmento), [fragmento]);

  /*
   * O ERRO NÃO APAGA O QUE FOI DIGITADO (29/09/2026).
   *
   * Com `<form action>`, o React 19 limpa o formulário ao fim de TODA ação —
   * inclusive a que volta com erro. "Já existe uma conta com esse e-mail"
   * chegava com nome, e-mail e as duas senhas em branco (só o CPF ficava,
   * por ser controlado), e a pessoa digitava tudo de novo para trocar uma
   * letra.
   *
   * Chamar a ação por aqui, numa transição, é a saída que o próprio React
   * prevê: ele não limpa o formulário e o `useFormStatus` do botão continua
   * valendo. O `action` fica no <form> para o envio antes da hidratação, que
   * sem ele seria um GET com a senha na barra de endereço.
   */
  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    startTransition(() => action(dados));
  }

  return (
    <form action={action} onSubmit={enviar} className="mt-8 flex flex-col gap-4">
      {/* `key`: os campos da empresa nascem de novo quando o fragmento é lido,
          porque o valor inicial de um campo só vale na montagem. */}
      <CamposDaEmpresa key={fragmento} pre={pre} />
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

function CamposDaEmpresa({ pre }: { pre: Preenchimento }) {
  const [documento, setDocumento] = useState(pre.documento);

  return (
    <>
      {/* Quem chega pelo botão do Atomatiza precisa saber por que o documento
          já veio escrito — e que trocá-lo aqui desliga o combo. */}
      {pre.doAtomatiza && (
        <p className="rounded-lg border border-linha bg-carbon px-4 py-3 text-sm leading-relaxed text-texto-soft">
          Veio do Atomatiza: os dados da sua empresa já estão aqui. Com o mesmo CPF ou CNPJ nas
          duas contas, o desconto do combo entra sozinho nas duas assinaturas.
        </p>
      )}
      <Campo
        label="Nome do estúdio"
        name="nome_estudio"
        required
        autoComplete="organization"
        placeholder="Seu estúdio"
        defaultValue={pre.estudio}
        dica="Aparece nas galerias e vira o endereço do seu link."
      />
      <Campo
        label="E-mail"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="voce@estudio.com.br"
        defaultValue={pre.email}
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
    </>
  );
}
