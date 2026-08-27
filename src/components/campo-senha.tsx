"use client";

import { useId, useState, type InputHTMLAttributes } from "react";

/**
 * Campo de senha com o olho de mostrar.
 *
 * Senha escondida é proteção contra quem olha por cima do ombro — e no celular,
 * sozinho, sem teclado físico, ela vira só uma forma de errar sem saber. Pedir a
 * senha duas vezes sem deixar VER nenhuma das duas dobra o trabalho de quem já
 * errou uma vez, e não resolve: a pessoa erra igual nas duas, ou desiste.
 *
 * O padrão é escondido. Mostrar é escolha de quem está digitando, tomada no
 * momento em que ela sabe se tem alguém olhando — que é a única hora em que dá
 * para saber isso.
 *
 * O botão fica DENTRO da moldura do campo, e não ao lado: ao lado ele empurraria
 * o campo e quebraria o alinhamento com os outros do formulário.
 */
export function CampoSenha({
  label,
  dica,
  ...props
}: { label: string; dica?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const [visivel, setVisivel] = useState(false);
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          {...props}
          type={visivel ? "text" : "password"}
          className={
            "w-full rounded-lg border border-linha bg-carbon py-2.5 pl-3 pr-16 text-sm text-texto " +
            "placeholder:text-texto-faint focus:border-acento focus:outline-none"
          }
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          /* O rótulo diz a AÇÃO, não o estado: leitor de tela lendo "senha
             visível" num botão deixa a pessoa sem saber o que acontece ao
             apertar. `aria-pressed` é quem carrega o estado. */
          aria-label={visivel ? "Ocultar a senha" : "Mostrar a senha"}
          aria-pressed={visivel}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-texto-faint transition hover:text-texto focus:outline-none focus-visible:ring-1 focus-visible:ring-acento"
        >
          {visivel ? "ocultar" : "ver"}
        </button>
      </div>
      {dica ? <span className="text-xs text-texto-faint">{dica}</span> : null}
    </div>
  );
}
