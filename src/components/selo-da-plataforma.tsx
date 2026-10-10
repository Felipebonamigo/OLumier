import { marca } from "@/config/marca";
import type { LugarDoSelo } from "@/lib/bio-regras";

/**
 * "ENTREGUE COM GALERIA ÁTOMO" — o selo do fim da galeria e da vitrine.
 *
 * O desenho é o de sempre (a home promete "um selo discreto no fim da galeria",
 * e é isso que ele continua sendo). O que mudou em 10/10/2026 é que ele virou
 * LINK: quem gostou da entrega — muitas vezes outro fotógrafo, olhando a
 * galeria de um colega — chega à casa por ele, e `/selo/<estudio>` conta o
 * clique e deixa a origem para o cadastro. Ver `EVENTO_SELO` em
 * `lib/bio-regras.ts`.
 *
 * Endereço ABSOLUTO no domínio da casa: o selo vive no subdomínio do estúdio
 * (ou no domínio dele), e um caminho relativo cairia na rota de galeria de lá.
 *
 * Nova aba, porque quem toca no selo está no meio das fotos de alguém e não
 * pode perdê-las. `noreferrer` porque o endereço da galeria de um casal não
 * precisa viajar para lugar nenhum — a origem já vai no próprio link.
 */
export function SeloDaPlataforma({
  estudio,
  lugar,
  arredondado = "var(--g-pilula,9999px)",
  simbolo = false,
}: {
  /** O slug do estúdio — vira a campanha do clique. */
  estudio: string;
  lugar: LugarDoSelo;
  arredondado?: string;
  /** A marquinha "GA" à esquerda (a galeria tem; a vitrine, não). */
  simbolo?: boolean;
}) {
  return (
    <a
      href={`https://${marca.dominio}/selo/${encodeURIComponent(estudio)}?no=${lugar}`}
      target="_blank"
      rel="noopener noreferrer"
      data-selo={lugar}
      className="inline-flex items-center gap-2 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] transition hover:opacity-75"
      style={{ border: "1px solid var(--g-linha)", color: "var(--g-tenue)", borderRadius: arredondado }}
    >
      {simbolo && (
        <span
          className="grid h-4 w-4 place-items-center rounded-[3px] text-[8px] font-bold"
          style={{ border: "1px solid var(--g-linha)", color: "var(--g-destaque)" }}
        >
          {marca.simbolo}
        </span>
      )}
      entregue com {marca.nome}
    </a>
  );
}
