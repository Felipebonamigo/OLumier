"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { trocarSenhaAction, type EstadoSenha } from "@/app/painel/actions";
import { Erro, BotaoEnviar } from "@/components/form-ui";
import { CampoSenha } from "@/components/campo-senha";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Trocar senha</BotaoEnviar>;
}

/**
 * Troca de senha do fotógrafo.
 *
 * Antes disso só existia o caminho manual: alguém rodava um script no servidor e
 * mandava a senha nova por WhatsApp. Ou seja, para trocar a própria senha a
 * pessoa precisava passar a senha por uma terceira — o contrário do que trocar
 * senha deveria significar.
 *
 * Fica fechado por padrão: é raro, e um formulário de senha sempre aberto na
 * página da conta convida a mexer sem necessidade.
 */
export function TrocarSenha({ minimo }: { minimo: number }) {
  const [aberto, setAberto] = useState(false);
  const [estado, action] = useActionState<EstadoSenha, FormData>(trocarSenhaAction, {});

  // Fecha quando gravou. Ajuste durante a render — num efeito, o formulário
  // chegaria a ser desenhado aberto por um quadro depois do sucesso.
  const [visto, setVisto] = useState(estado);
  if (estado !== visto) {
    setVisto(estado);
    if (estado.ok) setAberto(false);
  }

  return (
    <section className="mt-6 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Senha</h2>
        {!aberto && (
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="text-xs text-texto-faint underline underline-offset-4 hover:text-texto"
          >
            trocar
          </button>
        )}
      </div>

      {estado.ok && !aberto && (
        <p role="status" className="mt-3 text-sm text-ok">
          {estado.ok}
        </p>
      )}

      {!aberto ? (
        <p className="mt-1 text-xs text-texto-faint">
          Trocar a senha desconecta os outros aparelhos. Este continua conectado.
        </p>
      ) : (
        <form action={action} className="mt-4 flex flex-col gap-4">
          <CampoSenha
            label="Senha atual"
            name="senha_atual"
            
            autoComplete="current-password"
            required
            dica="Pedimos mesmo com você já logado — é o que separa você de quem pegou seu computador aberto."
          />
          <CampoSenha
            label="Senha nova"
            name="senha_nova"
            
            autoComplete="new-password"
            required
            minLength={minimo}
            dica={`Pelo menos ${minimo} caracteres.`}
          />
          <CampoSenha
            label="Repita a senha nova"
            name="senha_repetida"
            
            autoComplete="new-password"
            required
            minLength={minimo}
          />

          <Erro mensagem={estado.erro} />

          <div className="flex items-center gap-3">
            <Botao />
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-sm text-texto-faint hover:text-texto"
            >
              cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
