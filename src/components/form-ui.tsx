import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/** Peças de formulário compartilhadas — mesma aparência em login, cadastro e painel. */

const baseCampo =
  "w-full rounded-lg border border-linha bg-carbon px-3 py-2.5 text-sm text-texto " +
  "placeholder:text-texto-faint focus:border-acento focus:outline-none";

export function Campo({
  label,
  dica,
  ...props
}: { label: string; dica?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input className={baseCampo} {...props} />
      {dica ? <span className="text-xs text-texto-faint">{dica}</span> : null}
    </label>
  );
}

export function Selecao({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <select className={baseCampo} {...props}>
        {children}
      </select>
    </label>
  );
}

export function Erro({ mensagem }: { mensagem?: string }) {
  if (!mensagem) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-erro/40 bg-erro/10 px-3 py-2.5 text-sm text-erro"
    >
      {mensagem}
    </p>
  );
}

export function BotaoEnviar({
  children,
  carregando,
}: {
  children: ReactNode;
  carregando?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={carregando}
      className="mt-2 rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:cursor-not-allowed disabled:opacity-60"
    >
      {carregando ? "Aguarde…" : children}
    </button>
  );
}
