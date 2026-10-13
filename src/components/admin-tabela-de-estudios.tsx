"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ordenarPorChaves, proximaOrdem, type OrdemDaTabela, type Sentido, type Valor } from "@/lib/ordem-por-chaves";

/**
 * A TABELA DE ESTÚDIOS DA ADMINISTRAÇÃO, QUE ORDENA NO NAVEGADOR (13/10/2026).
 *
 * Felipe, com 44 estúdios na tela: "está bem bugado para mexer aqui e
 * reordenar". Cada título de coluna era um link para a MESMA página com outro
 * `?ordem=`. Clicar refazia a Administração inteira no servidor — uma dúzia de
 * consultas para mudar a ordem de uma tabela — e depois o navegador saltava
 * para a âncora: com a tabela rolada até o meio, o clique parecia não fazer
 * nada por alguns segundos e então jogava a página para outro lugar.
 *
 * Aqui o servidor manda UMA vez as células de cada estúdio e as chaves de
 * ordenação de cada coluna; quem decide a ordem é o navegador, na hora, sem
 * pedir nada e sem mexer na rolagem. A regra de ordenar é a mesma que o
 * servidor usa (`lib/ordem-por-chaves.ts`) — a primeira ordem, a do endereço,
 * já sai pronta no HTML, e o link ordenado continua indo para um sócio.
 *
 * ── O QUE FICOU DE FORA DA ROLAGEM ───────────────────────────────────────
 *
 * A tabela rola dentro da própria caixa, com o cabeçalho (os botões de
 * ordenar) e a linha de total sempre à vista. Antes, quem estivesse na linha
 * 30 tinha de subir a página inteira para achar o título da coluna.
 *
 * ── O ENDEREÇO ───────────────────────────────────────────────────────────
 *
 * Cada título continua sendo um link de verdade (`?ordem=…&sentido=…`): sem
 * JavaScript, com Ctrl/Cmd+clique ou no "copiar endereço", ele funciona como
 * sempre funcionou. O clique simples é interceptado, ordena e troca o endereço
 * com `history.replaceState` — o que o Next documenta para mudar a URL sem
 * recarregar — para o link da barra continuar certo.
 */

export interface LinhaDaTabelaDeEstudios {
  id: string;
  /** O valor de cada coluna para ordenar — o número que a célula mostra. */
  chaves: Record<string, Valor>;
  /** As `<td>` do estúdio, desenhadas no servidor. */
  celulas: ReactNode;
}

export interface ColunaDaTabelaDeEstudios {
  id: string;
  titulo: string;
  /** O sentido do primeiro clique. */
  primeiro: Sentido;
  /** Explica o que a coluna ordena, quando o título não basta. */
  dica?: string;
}

const buscaDe = (o: OrdemDaTabela) => `?ordem=${o.coluna}&sentido=${o.sentido}`;
/* O link guarda a âncora (`#estudios`) para quem navega de verdade — sem
   JavaScript, em outra aba. */
const enderecoDe = (o: OrdemDaTabela) => `${buscaDe(o)}#estudios`;

export function TabelaDeEstudios({
  colunas,
  linhas,
  ordemInicial,
  rodape,
}: {
  colunas: ColunaDaTabelaDeEstudios[];
  linhas: LinhaDaTabelaDeEstudios[];
  ordemInicial: OrdemDaTabela;
  /** A linha de total (`<tr>` de `<tfoot>`), desenhada no servidor. */
  rodape: ReactNode;
}) {
  const [ordem, setOrdem] = useState(ordemInicial);
  const ordenadas = useMemo(() => ordenarPorChaves(linhas, ordem), [linhas, ordem]);
  const ativa = colunas.find((c) => c.id === ordem.coluna);
  const caixa = useRef<HTMLDivElement>(null);

  /* Depois de ordenar, a tabela volta ao topo: quem ordenou quer ver quem ficou
     em primeiro. Sem isto, o navegador "ancora" na linha que estava à vista e
     a leva consigo para onde ela foi parar — a tabela parecia pular sozinha.
     (Mexer na rolagem não é estado: não há redesenho.) */
  useEffect(() => {
    if (caixa.current) caixa.current.scrollTop = 0;
  }, [ordem]);

  function aoClicar(e: MouseEvent<HTMLAnchorElement>, coluna: ColunaDaTabelaDeEstudios) {
    /* Aba nova, janela nova, "copiar link": o navegador faz o que sempre fez. */
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const proxima = proximaOrdem(ordem, coluna.id, coluna.primeiro);
    setOrdem(proxima);
    /* Sem trocar o hash: o Next leva a página até a âncora quando ele muda, e
       era isso que fazia o primeiro clique saltar. Quem chegou com `#estudios`
       continua com ele; quem não chegou, não ganha um. */
    window.history.replaceState(null, "", `${buscaDe(proxima)}${window.location.hash}`);
  }

  return (
    <div ref={caixa} className="max-h-[78vh] overflow-auto rounded-xl border border-linha [overflow-anchor:none]">
      <table
        className={
          /* `border-separate` e as bordas nas células, não na linha: com as bordas
             colapsadas, a linha que separa o cabeçalho rolaria embora e deixaria o
             título fixo sem nada embaixo. */
          "w-full min-w-[1180px] border-separate border-spacing-0 text-sm " +
          "[&_tbody_td]:border-b [&_tbody_td]:border-linha [&_tbody_tr:last-child_td]:border-b-0 " +
          "[&_tfoot_td]:sticky [&_tfoot_td]:bottom-0 [&_tfoot_td]:border-t-2 [&_tfoot_td]:border-linha [&_tfoot_td]:bg-carbon"
        }
      >
        <caption className="sr-only">Estúdios, ordenáveis pelos títulos das colunas</caption>
        <thead>
          <tr className="text-left">
            {colunas.map((c) => {
              const eAtiva = ordem.coluna === c.id;
              return (
                <th
                  key={c.id}
                  aria-sort={eAtiva ? (ordem.sentido === "asc" ? "ascending" : "descending") : undefined}
                  className="sticky top-0 z-10 whitespace-nowrap border-b border-linha bg-carbon px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-texto-faint"
                >
                  <a
                    href={enderecoDe(proximaOrdem(ordem, c.id, c.primeiro))}
                    onClick={(e) => aoClicar(e, c)}
                    title={c.dica}
                    className={`group inline-flex items-center gap-1 py-1 transition hover:text-texto ${eAtiva ? "text-texto" : ""}`}
                  >
                    {c.titulo}
                    <span aria-hidden="true" className={eAtiva ? "" : "opacity-0 group-hover:opacity-40"}>
                      {eAtiva && ordem.sentido === "asc" ? "↑" : "↓"}
                    </span>
                  </a>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((l) => (
            <tr key={l.id} className="align-top">
              {l.celulas}
            </tr>
          ))}
        </tbody>
        <tfoot>{rodape}</tfoot>
      </table>
      {/* Quem usa leitor de tela não vê a seta: ouve a nova ordem. */}
      <p role="status" className="sr-only">
        {ativa ? `Ordenado por ${ativa.titulo}, ${ordem.sentido === "asc" ? "do menor para o maior" : "do maior para o menor"}.` : ""}
      </p>
    </div>
  );
}
