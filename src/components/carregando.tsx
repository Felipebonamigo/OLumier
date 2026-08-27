import { MarcaSimbolo } from "@/components/marca-tile";

/**
 * A tela de espera da casa: o próprio átomo, com os elétrons girando.
 *
 * (27/08/2026, pedido do dono: "as telas quando estiverem carregando, utilize
 * esse mesmo logo".) Não há spinner genérico aqui de propósito — o símbolo já
 * anda sozinho (os elétrons percorrem as órbitas via <animateMotion> dentro de
 * MarcaSimbolo), então a marca É o movimento. Um círculo girando ao lado dela
 * seria dois relógios na mesma parede.
 *
 * Quem pediu menos movimento no sistema vê o átomo parado — a regra mora no
 * próprio símbolo, e o texto abaixo continua dizendo o que está acontecendo.
 *
 * Usada pelos `loading.tsx` dos segmentos. É o mecanismo nativo do App Router:
 * a navegação mostra isto INSTANTANEAMENTE enquanto o servidor monta a página,
 * o que importa mais no painel (consultas) e na galeria (fotos).
 */
export function Carregando() {
  return (
    <main className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-4">
        <MarcaSimbolo tamanho={64} />
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-texto-faint">
          carregando
        </p>
      </div>
    </main>
  );
}
