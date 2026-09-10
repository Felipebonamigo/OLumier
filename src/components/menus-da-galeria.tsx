"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { CapituloGaleria } from "@/components/galeria-cliente";

/**
 * A BARRA DE MENUS DO INÍCIO DA GALERIA.
 *
 * ── DE ONDE VEIO (10/09/2026) ─────────────────────────────────────────────
 *
 * Juan: "Criar um sistema de MENUS no início da galeria. MENU das fotos
 * favoritas. MENU do download das fotos."
 *
 * O começo da galeria era uma PILHA de blocos — baixar tudo, aviso do limite,
 * busca por rosto, linha das favoritas, menu de capítulos — cada um aparecendo
 * e sumindo por conta própria. Depois da capa, a primeira coisa que o cliente
 * via era um amontoado de controle, e as fotos começavam meia tela abaixo.
 *
 * A barra junta o que é COMANDO atrás de dois nomes e devolve a tela às fotos.
 * O que é AVISO — "escolha até 30 fotos", "a escolha terminou" — continua fora
 * dela: aviso escondido dentro de menu é aviso que ninguém lê.
 *
 * ── POR QUE `<details>` ───────────────────────────────────────────────────
 *
 * Porque o navegador já tem um menu: abre no clique, abre no Enter, anda com
 * Tab e não precisa de estado nenhum. Some o triângulo padrão e ele vira o que
 * se espera de um menu. O que um menu escrito à mão traria de novo — fechar ao
 * clicar fora e no Esc — são as dez linhas do efeito lá embaixo, e não um
 * componente inteiro de foco, teclado e posicionamento.
 *
 * De quebra, o conteúdo do menu existe no HTML mesmo fechado, e é por isso que
 * `scripts/testar-menus-galeria.mjs` confere os itens sem abrir navegador.
 */

const GATILHO =
  "flex cursor-pointer list-none items-center gap-1.5 rounded-full px-4 py-2 text-sm " +
  "transition hover:opacity-75 [&::-webkit-details-marker]:hidden";

const PAINEL =
  "absolute left-1/2 top-full z-40 mt-2 w-max min-w-[15rem] max-w-[min(20rem,90vw)] " +
  "-translate-x-1/2 rounded-2xl p-1.5 shadow-2xl";

const ITEM = "block w-full rounded-xl px-3 py-2 text-left text-sm transition hover:opacity-70";

export type MenuFavoritas = {
  quantas: number;
  soFavoritas: boolean;
  alternarFiltro: () => void;
  selecaoAberta: boolean;
  limite: number | null;
  cheia: boolean;
  encerrar: () => void;
  fechando: boolean;
};

export type MenuBaixar = {
  quantas: number;
  /** No celular a entrega é pelo menu do sistema, e o verbo muda junto. */
  modoSalvar: boolean;
  baixando: boolean;
  progresso: number;
  baixarTudo: () => void;
  /** Os capítulos, quando há mais de um. Vazio = não há pasta a escolher. */
  pastas: { id: string; nome: string; quantas: number; baixar: () => void }[];
};

export function MenusDaGaleria({
  capitulos,
  favoritas,
  baixar,
  tocarSlideshow,
}: {
  capitulos: CapituloGaleria[];
  /** Null quando não há o que oferecer: escolha encerrada e nenhuma marcada. */
  favoritas: MenuFavoritas | null;
  /** Null quando o fotógrafo não liberou download. */
  baixar: MenuBaixar | null;
  /** Null com menos de duas fotos à vista — tocar uma foto só é abri-la. */
  tocarSlideshow: (() => void) | null;
}) {
  const barra = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const fechar = (menosEste?: Node) => {
      const abertos = barra.current?.querySelectorAll("details[open]") ?? [];
      for (const d of Array.from(abertos)) {
        if (menosEste && d.contains(menosEste)) continue;
        d.removeAttribute("open");
      }
    };
    const noPonteiro = (e: PointerEvent) => fechar(e.target as Node);
    const naTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
    };
    document.addEventListener("pointerdown", noPonteiro);
    document.addEventListener("keydown", naTecla);
    return () => {
      document.removeEventListener("pointerdown", noPonteiro);
      document.removeEventListener("keydown", naTecla);
    };
  }, []);

  if (!favoritas && !baixar && !tocarSlideshow && capitulos.length < 2) return null;

  return (
    <nav
      ref={barra}
      aria-label="Menu da galeria"
      /* `sticky` já é posição não-estática, então a barra serve de âncora para o
         painel dos menus no celular — ver o `max-[600px]:static` do `<details>`.
         Um `relative` junto brigaria com ela pela mesma propriedade. */
      className="sticky top-0 z-30 -mx-4 mt-8 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6"
      style={{
        background: "color-mix(in srgb, var(--g-fundo) 88%, transparent)",
        borderBottom: "1px solid var(--g-linha)",
      }}
    >
      <div className="flex flex-wrap items-center justify-center gap-1">
        {/* Botão, e não menu: o slideshow tem uma escolha só — começar. Um
            `<details>` com um item dentro seria um clique a mais para chegar
            no mesmo lugar. */}
        {tocarSlideshow && (
          <button
            type="button"
            onClick={tocarSlideshow}
            className={GATILHO}
            style={{ color: "var(--g-suave)" }}
          >
            ▶ Slideshow
          </button>
        )}

        {favoritas && (
          <Menu nome={`♥ Favoritas${favoritas.quantas > 0 ? ` (${favoritas.quantas})` : ""}`}>
            {/* Desligado, e não ausente, com zero marcadas: um menu cujos itens
                aparecem e somem conforme o estado ensina que ele muda de forma,
                e obriga a abrir para descobrir o que tem hoje. Apagado, ele diz
                a mesma coisa e continua no mesmo lugar amanhã. */}
            <ItemDoMenu aoTocar={favoritas.alternarFiltro} desligado={favoritas.quantas === 0}>
              {favoritas.soFavoritas
                ? "Ver todas as fotos"
                : `Ver só as favoritas (${favoritas.quantas})`}
            </ItemDoMenu>

            {favoritas.selecaoAberta && (
              <ItemDoMenu aoTocar={favoritas.encerrar} desligado={favoritas.fechando}>
                {favoritas.fechando ? "Encerrando…" : "Terminei minha escolha"}
              </ItemDoMenu>
            )}

            {/* A regra, dita onde a escolha acontece. Repete o aviso de cima
                de propósito: quem chega pelo menu não passou por ele. */}
            {favoritas.limite !== null && favoritas.selecaoAberta && (
              <Rodape>
                {favoritas.quantas} de {favoritas.limite} escolhidas
                {favoritas.cheia && " · desmarque uma para trocar"}
              </Rodape>
            )}
          </Menu>
        )}

        {baixar && (
          <Menu
            nome={
              baixar.baixando
                ? `${baixar.modoSalvar ? "Salvando" : "Baixando"} ${baixar.progresso} de ${baixar.quantas}…`
                : "↓ Baixar"
            }
          >
            <ItemDoMenu aoTocar={baixar.baixarTudo} desligado={baixar.baixando}>
              {baixar.modoSalvar
                ? `Salvar as ${baixar.quantas} fotos no celular`
                : `Todas as fotos (${baixar.quantas})`}
            </ItemDoMenu>

            {/* "…ou separado em pastas": os capítulos, um por linha. A contagem
                no rótulo é o que vai vir — é ela que separa "a pasta inteira"
                de "o que estou vendo agora". */}
            {baixar.pastas.length > 0 && (
              <>
                <p
                  className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: "var(--g-tenue)" }}
                >
                  ou uma pasta
                </p>
                {baixar.pastas.map((p) => (
                  <ItemDoMenu key={p.id} aoTocar={p.baixar} desligado={baixar.baixando}>
                    {`${p.nome} (${p.quantas})`}
                  </ItemDoMenu>
                ))}
              </>
            )}

            <Rodape>
              {baixar.modoSalvar
                ? "vai abrir o menu do seu celular — toque em “Salvar imagem”"
                : "sem limite de downloads — baixe quantas vezes quiser"}
            </Rodape>
          </Menu>
        )}
      </div>

      {/*
        Os capítulos na MESMA barra, e não numa segunda faixa grudada no topo:
        duas barras disputariam o mesmo lugar e o cliente ganharia duas fitas de
        controle sobre as fotos. Continuam sendo âncoras — um link que rola até
        o capítulo é o que o navegador faz melhor do que qualquer script.
      */}
      {capitulos.length > 1 && (
        <ul className="mt-1 flex justify-center gap-1 overflow-x-auto whitespace-nowrap">
          {capitulos.map((c) => (
            <li key={c.id}>
              <a
                href={`#cap-${c.id}`}
                className="inline-block rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition hover:opacity-70"
                style={{ color: "var(--g-suave)" }}
              >
                {c.nome}
              </a>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

function Menu({ nome, children }: { nome: string; children: ReactNode }) {
  return (
    /*
     * O PAINEL SE PENDURA NO GATILHO NO COMPUTADOR E NA BARRA NO CELULAR.
     *
     * Centralizado sob o gatilho, ele é preciso — e num celular de 375 px o
     * menu da direita ficava 90 px para fora da tela, criando rolagem
     * horizontal na galeria inteira (medido em 10/09). Abaixo de 600 px o
     * `static` tira o `<details>` de contexto de posicionamento e o painel
     * passa a se centralizar na BARRA, que tem a largura da tela.
     */
    <details className="relative max-[600px]:static">
      <summary className={GATILHO} style={{ color: "var(--g-suave)" }}>
        {nome}
      </summary>
      <div
        className={PAINEL}
        style={{ background: "var(--g-fundo)", border: "1px solid var(--g-linha)" }}
      >
        {children}
      </div>
    </details>
  );
}

/**
 * Um comando do menu. Fecha o menu ao ser tocado — `<details>` não fecha
 * sozinho, e um menu que fica aberto por cima das fotos depois do clique
 * parece que o clique não pegou.
 */
function ItemDoMenu({
  children,
  aoTocar,
  desligado = false,
}: {
  children: ReactNode;
  aoTocar: () => void;
  desligado?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={desligado}
      onClick={(e) => {
        e.currentTarget.closest("details")?.removeAttribute("open");
        aoTocar();
      }}
      className={`${ITEM} disabled:opacity-50`}
      style={{ color: "var(--g-texto)" }}
    >
      {children}
    </button>
  );
}

function Rodape({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 py-2 text-xs" style={{ color: "var(--g-tenue)" }}>
      {children}
    </p>
  );
}
