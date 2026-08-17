import { marca } from "@/config/marca";

/** O azulejo de tabela periódica — o símbolo do elemento. Lê tudo de config/marca. */
export function MarcaTile({ tamanho = 56 }: { tamanho?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-xl border border-linha-forte bg-carbon-2 font-bold text-luz-alta"
      style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.42 }}
      aria-hidden
    >
      {marca.simbolo}
    </div>
  );
}

export function MarcaLockup({ tamanho = 44 }: { tamanho?: number }) {
  return (
    <span className="flex items-center gap-3">
      <MarcaTile tamanho={tamanho} />
      <span>
        <span className="block text-lg font-bold leading-tight tracking-tight">{marca.nome}</span>
        <span className="block font-mono text-[10px] uppercase tracking-[0.24em] text-texto-soft">
          galerias de entrega
        </span>
      </span>
    </span>
  );
}
