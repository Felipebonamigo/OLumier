import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/** Peças de formulário compartilhadas — mesma aparência em login, cadastro e painel. */

const baseCampo =
  "w-full rounded-lg border border-linha bg-carbon px-3 py-2.5 text-sm text-texto " +
  "placeholder:text-exemplo focus:border-acento focus:outline-none";

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

/**
 * Campo de texto longo. Mesma moldura do `Campo` — a diferença é só a altura,
 * e o contador de tamanho, que existe porque os limites do site do estúdio
 * cortam em silêncio: sem o contador, o fotógrafo escreveria 4 mil caracteres e
 * descobriria o corte só ao ver a página pronta.
 */
export function Area({
  label,
  dica,
  limite,
  ...props
}: { label: string; dica?: string; limite?: number } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const usado = typeof props.value === "string" ? props.value.length : null;
  const apertado = limite != null && usado != null && usado > limite * 0.9;

  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-3 text-sm font-medium">
        {label}
        {limite != null && usado != null && (
          <span
            className={`font-mono text-[11px] tabular-nums ${apertado ? "text-alerta" : "text-texto-faint"}`}
          >
            {usado}/{limite}
          </span>
        )}
      </span>
      <textarea className={`${baseCampo} min-h-28 resize-y leading-relaxed`} {...props} />
      {dica ? <span className="text-xs text-texto-faint">{dica}</span> : null}
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
