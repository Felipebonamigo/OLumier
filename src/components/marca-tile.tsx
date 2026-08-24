import { marca } from "@/config/marca";

/**
 * A marca desenhada: o diafragma aberto.
 *
 * Um "O" que é um anel de lente — com um arco aceso onde a luz bate na borda e
 * um ponto de luz dentro. Diz três coisas ao mesmo tempo: fotografia (o
 * diafragma), cinema (a íris do projetor — o eco de Lumière que deu o nome) e a
 * inicial de Olumier. Substituiu o "azulejo de tabela periódica" da era
 * Fotônio, cuja metáfora morreu com o rename de 24/08/2026.
 *
 * SVG inline de propósito: escala sem servir arquivo, herda cor por
 * currentColor onde precisar, e o favicon (src/app/icon.svg) é este mesmo
 * desenho com fundo — mudou aqui, mudou lá.
 */
export function MarcaSimbolo({ tamanho = 40 }: { tamanho?: number }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      {/* o anel — o "O", a lente */}
      <circle cx="24" cy="24" r="17" stroke="var(--luz)" strokeWidth="2.4" opacity="0.5" />
      {/* a luz batendo na borda: um arco aceso no alto-direito */}
      <path
        d="M 33.5 9.55 A 17 17 0 0 1 41.45 24"
        stroke="var(--luz-alta)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* o ponto de luz que entrou */}
      <circle cx="30" cy="18" r="2.6" fill="var(--luz-alta)" />
    </svg>
  );
}

/** Compatível com os usos antigos do azulejo — hoje desenha o símbolo livre. */
export function MarcaTile({ tamanho = 56 }: { tamanho?: number }) {
  return <MarcaSimbolo tamanho={tamanho} />;
}

export function MarcaLockup({ tamanho = 44 }: { tamanho?: number }) {
  return (
    <span className="flex items-center gap-3">
      <MarcaSimbolo tamanho={tamanho} />
      <span>
        <span className="block font-serif text-xl font-bold leading-tight tracking-tight">
          {marca.nome}
        </span>
        <span className="block font-mono text-[10px] uppercase tracking-[0.24em] text-texto-soft">
          galerias de entrega
        </span>
      </span>
    </span>
  );
}
