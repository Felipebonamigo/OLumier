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

/*
 * ── A FORMA DE UM BOTÃO MORA AQUI (16/09/2026) ────────────────────────────
 *
 * Felipe, com a foto do assistente de nova galeria: "botões estranhos e em
 * tamanhos diferentes". "Continuar" tinha `py-2`, "Criar mesmo assim" tinha
 * `py-2.5` e ainda um `mt-2` — lado a lado, um mais alto que o outro e os dois
 * desencontrados na linha de base.
 *
 * Não era descuido de ninguém: cada tela escrevia as classes do próprio botão,
 * e classe copiada envelhece separada. Com a forma num lugar só, dois botões
 * vizinhos não têm COMO sair de tamanhos diferentes.
 *
 * Primário e secundário existem porque duas ações do mesmo peso, uma ao lado da
 * outra, não dizem qual é o caminho. "Continuar" é o caminho; "Criar mesmo
 * assim" é a saída de emergência — mesma altura, ênfase diferente.
 */
export const BOTAO_BASE =
  "rounded-lg px-4 py-2.5 text-sm font-semibold transition " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export const BOTAO_PRIMARIO = `${BOTAO_BASE} bg-acento text-void hover:bg-acento-alto`;

export const BOTAO_SECUNDARIO =
  `${BOTAO_BASE} border border-linha-forte font-medium text-texto-soft hover:bg-carbon-2 hover:text-texto`;

export function BotaoEnviar({
  children,
  carregando,
  /**
   * `mt-2` é o respiro de quem vem logo abaixo de um campo, que é o caso da
   * maioria dos formulários. Numa FILEIRA de botões ele vira desalinhamento:
   * o botão de enviar desce dois pixels em relação aos vizinhos. Ver a foto de
   * 16/09/2026 no comentário acima.
   */
  emLinha = false,
  variante = "primario",
}: {
  children: ReactNode;
  carregando?: boolean;
  emLinha?: boolean;
  variante?: "primario" | "secundario";
}) {
  return (
    <button
      type="submit"
      disabled={carregando}
      className={`${emLinha ? "" : "mt-2 "}${
        variante === "primario" ? BOTAO_PRIMARIO : BOTAO_SECUNDARIO
      }`}
    >
      {carregando ? "Aguarde…" : children}
    </button>
  );
}
