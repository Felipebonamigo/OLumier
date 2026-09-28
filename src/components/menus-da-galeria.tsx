"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { enderecoNaGaleria } from "@/lib/endereco-na-galeria";
import { useFecharMenuAoClicarFora } from "@/lib/fechar-menu-client";
import type { CapituloGaleria } from "@/components/galeria-cliente";
import type { ModoDeEntrega } from "@/lib/modo-de-entrega";
import { tamanhoLegivel, toquesPrevistos } from "@/lib/salvar-client";

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
  /** Há escolha combinada (limite ou prazo) ainda aberta. Sem ela, favorita é
      só favorita e o menu não oferece encerrar nada. */
  podeEncerrar: boolean;
  limite: number | null;
  cheia: boolean;
  encerrar: () => void;
  fechando: boolean;
};

export type MenuBaixar = {
  /** Como este aparelho recebe as fotos — o verbo e o caminho mudam junto. */
  modo: ModoDeEntrega;
  /** Quantas fotos a galeria tem — é o que "todas" entrega, em qualquer aparelho. */
  quantasNaGaleria: number;
  bytesDaGaleria: number;
  /** A entrega em curso, ou null. */
  progresso: { feitas: number; total: number } | null;
  baixarTudo: () => void;
  /** Os capítulos, quando há mais de um. Vazio = não há pasta a escolher. */
  pastas: { id: string; nome: string; quantas: number; baixar: () => void }[];
  /** Quantas o casal marcou. Zero = a linha das favoritas não aparece. */
  favoritas: number;
  baixarFavoritas: () => void;
  /**
   * O zip da galeria inteira, oferecido como opção a mais no celular — no
   * computador ele já é o "baixar tudo". Ausente = não oferecer.
   */
  baixarZip?: () => void;
  /** Manda o link para a pessoa baixar no computador. Só no celular. */
  enviarParaOComputador?: () => void;
  /** As fotos da tela `?fotos=` (busca por rosto), ou null fora dela. */
  recorte?: { quantas: number; baixar: () => void } | null;
};

export function MenusDaGaleria({
  capitulos,
  enderecoBase,
  fatia = null,
  favoritas,
  baixar,
  tocarSlideshow,
}: {
  capitulos: CapituloGaleria[];
  /** O endereço público da galeria, sem capítulo. Ver `enderecoNaGaleria`. */
  enderecoBase: string;
  /** Só numa galeria que não coube inteira — ver `config/fatia-galeria.ts`. */
  fatia?: { total: number; capituloAtivo: string | null } | null;
  /** Null quando não há o que oferecer: escolha encerrada e nenhuma marcada. */
  favoritas: MenuFavoritas | null;
  /** Null quando o fotógrafo não liberou download. */
  baixar: MenuBaixar | null;
  /** Null com menos de duas fotos à vista — tocar uma foto só é abri-la. */
  tocarSlideshow: (() => void) | null;
}) {
  const barraRef = useRef<HTMLElement | null>(null);
  const busca = useSearchParams();

  useFecharMenuAoClicarFora(barraRef);

  /*
   * ── O CAPÍTULO EM QUE A PESSOA ESTÁ (16/09/2026) ────────────────────────
   *
   * Felipe: "o primeiro capítulo (que está aparecendo) ele está sumido. Só
   * aparece a partir do próximo. Talvez possa aparecer o capítulo que está no
   * momento, com a marcação mais definida de capítulo selecionado".
   *
   * Até aqui a pastilha só acendia na galeria FATIADA, onde o capítulo aberto é
   * um parâmetro da URL. Na galeria que cabe inteira — que é a maioria — as
   * pastilhas são âncoras, ninguém troca de endereço ao rolar, e portanto
   * nenhuma delas acendia nunca: a barra dizia onde dava para ir e não dizia
   * onde a pessoa estava.
   *
   * Qual capítulo é esse, e como se decide, está no efeito lá embaixo — a
   * regra mudou em 21/09/2026, de "o primeiro que cruza uma faixa" para "o que
   * ocupa mais tela abaixo da barra", e o porquê está escrito lá.
   */
  const [capituloVisivel, setCapituloVisivel] = useState<string | null>(null);

  /*
   * A PASTILHA ATIVA ENTRA NA FAIXA VISÍVEL — só ela, e só na horizontal.
   *
   * O `safe center` da lista garante que o começo SEJA alcançável; não garante
   * que a pastilha do capítulo atual esteja à vista. Quem abre o link de um
   * capítulo do fim ainda cairia com a barra mostrando o começo dela.
   *
   * Mexe em `scrollLeft` da própria lista, e não em `scrollIntoView`: aquele
   * rola o ANCESTRAL mais próximo que rolar — e o ancestral aqui é a página. A
   * barra é `sticky`, então a pessoa que está rolando a galeria veria a página
   * dar um pulinho a cada troca de capítulo, causado pela barra que só queria
   * se ajeitar por dentro.
   *
   * Só age quando a pastilha está FORA: dentro da faixa, mexer em `scrollLeft`
   * seria movimento sem motivo no meio da leitura.
   */
  const listaDeCapitulos = useRef<HTMLUListElement | null>(null);
  const ativoNaBarra = fatia ? (fatia.capituloAtivo ?? null) : capituloVisivel;
  useEffect(() => {
    const lista = listaDeCapitulos.current;
    if (!lista || !ativoNaBarra) return;
    const pastilha = lista.querySelector<HTMLElement>('[data-ativo="sim"]');
    if (!pastilha) return;

    const folga = 16;
    const esquerdaDela = pastilha.offsetLeft;
    const direitaDela = esquerdaDela + pastilha.offsetWidth;
    const esquerdaVisivel = lista.scrollLeft;
    const direitaVisivel = esquerdaVisivel + lista.clientWidth;

    if (esquerdaDela < esquerdaVisivel + folga) {
      lista.scrollTo({ left: Math.max(0, esquerdaDela - folga), behavior: "smooth" });
    } else if (direitaDela > direitaVisivel - folga) {
      lista.scrollTo({ left: direitaDela - lista.clientWidth + folga, behavior: "smooth" });
    }
  }, [ativoNaBarra]);
  useEffect(() => {
    if (fatia || capitulos.length < 2) return;
    const secoes = capitulos
      .map((c) => ({ id: c.id, el: document.getElementById(`cap-${c.id}`) }))
      .filter((x): x is { id: string; el: HTMLElement } => x.el !== null);
    if (secoes.length === 0) return;

    /*
     * ── QUAL CAPÍTULO A PESSOA ESTÁ VENDO (21/09/2026) ──────────────────────
     *
     * Felipe, com o print da barra: "lá em cima tá marcado making of e ali
     * aparece decoração. A pessoa já tá vendo o capítulo da decoração".
     *
     * A regra antiga era uma FAIXA (10% a 55% da tela) e, entre os capítulos
     * que a cruzavam, o PRIMEIRO da galeria. Bastava sobrar uma fileira do
     * Making Of lá em cima para ele vencer a Decoração, que estava ocupando o
     * resto da tela.
     *
     * Trocar a faixa por uma linha fina não resolve — só muda onde fica o
     * empate. Medido: com a linha logo abaixo da barra, a emenda a 20%, 35% e
     * 50% da tela continuava acendendo o capítulo de cima, porque a linha ainda
     * estava dentro dele. O problema não era ONDE medir: era O QUE medir.
     *
     * O que a pessoa chama de "o capítulo que estou vendo" é o que OCUPA MAIS
     * TELA abaixo da barra. Então é isso que se mede, e o observador serve para
     * dizer QUANDO remedir, em vez de decidir sozinho.
     */
    const barra = barraRef.current;
    const decidir = () => {
      const topo = barra?.getBoundingClientRect().bottom ?? 0;
      const base = window.innerHeight;
      let escolhido: string | null = null;
      let maior = 0;
      for (const { id, el } of secoes) {
        const r = el.getBoundingClientRect();
        const visivel = Math.min(r.bottom, base) - Math.max(r.top, topo);
        if (visivel > maior) {
          maior = visivel;
          escolhido = id;
        }
      }
      /* Nada à vista (a capa, o rodapé) fica com o último: apagar a pastilha ali
         faria a barra piscar a cada emenda. */
      if (escolhido) setCapituloVisivel(escolhido);
    };

    /*
     * ── E QUEM AVISA SÃO OS DOIS ───────────────────────────────────────────
     *
     * A ROLAGEM, presa a um quadro: é ela que muda o que está na tela, e só
     * limiares de visibilidade deixavam a barra parada quando a rolagem não
     * cruzava nenhum deles — medido, numa emenda em cada cinco.
     *
     * O OBSERVADOR, para o que a rolagem não conta: imagem que carrega e
     * empurra a grade, fotos novas chegando pela rolagem infinita, a tela que
     * gira. Aí a página muda de altura sem ninguém rolar.
     *
     * `requestAnimationFrame` junta as duas fontes num quadro só, e a conta é
     * meia dúzia de `getBoundingClientRect` — barata o suficiente para rodar
     * durante a rolagem sem travar nada.
     */
    let pedido = 0;
    const agendar = () => {
      if (pedido) return;
      pedido = requestAnimationFrame(() => {
        pedido = 0;
        decidir();
      });
    };
    const observador = new IntersectionObserver(agendar, {
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });
    for (const { el } of secoes) observador.observe(el);
    window.addEventListener("scroll", agendar, { passive: true });
    window.addEventListener("resize", agendar, { passive: true });
    decidir();
    return () => {
      observador.disconnect();
      window.removeEventListener("scroll", agendar);
      window.removeEventListener("resize", agendar);
      if (pedido) cancelAnimationFrame(pedido);
    };
  }, [capitulos, fatia]);

  if (!favoritas && !baixar && !tocarSlideshow && capitulos.length < 2) return null;

  return (
    <nav
      ref={barraRef}
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

            {favoritas.podeEncerrar && (
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
              baixar.progresso
                ? `${baixar.modo === "menu" ? "Salvando" : "Baixando"} ${baixar.progresso.feitas} de ${baixar.progresso.total}…`
                : "↓ Baixar"
            }
          >
            {/*
              "TODAS" É TODAS, EM QUALQUER APARELHO (16/09/2026).

              Numa galeria que não coube inteira, o que está na tela é um pedaço
              — 600 de 2.108, no casamento da Carol. Até 11/09 o menu oferecia
              "Todas as fotos (600)" e o cliente levava 28% achando que tinha o
              casamento inteiro. A correção daquele dia foi dizer "desta parte".

              A de hoje é entregar tudo: no computador o zip é montado no
              servidor, e no celular a lista vem inteira de `api/g/[id]/lista`.
              O número é o da galeria nos dois, e a ressalva deixou de existir.

              O verbo muda com o aparelho porque o destino muda:
                iPhone   "Salvar" — o menu do sistema grava no app Fotos
                Android  "Baixar" — vai para a pasta Download, que a Galeria mostra
            */}
            {baixar.recorte && (
              <ItemDoMenu aoTocar={baixar.recorte.baixar} desligado={Boolean(baixar.progresso)}>
                {baixar.modo === "computador"
                  ? `Baixar estas ${baixar.recorte.quantas} fotos num zip`
                  : `${baixar.modo === "menu" ? "Salvar" : "Baixar"} estas ${baixar.recorte.quantas} fotos no celular`}
              </ItemDoMenu>
            )}
            <ItemDoMenu aoTocar={baixar.baixarTudo} desligado={Boolean(baixar.progresso)}>
              {baixar.modo === "computador"
                ? `Todas as fotos num zip (${baixar.quantasNaGaleria})`
                : `${baixar.modo === "menu" ? "Salvar" : "Baixar"} as ${baixar.quantasNaGaleria} fotos no celular`}
            </ItemDoMenu>
            {/* O tamanho ANTES de começar: 2108 fotos são gigas, e quem está no
                4G do salão precisa saber disso antes do primeiro toque. */}
            {baixar.modo !== "computador" && baixar.bytesDaGaleria > 0 && (
              <Rodape>
                {tamanhoLegivel(baixar.bytesDaGaleria)}
                {baixar.modo === "menu"
                  ? ` · cerca de ${toquesPrevistos(baixar.quantasNaGaleria, baixar.bytesDaGaleria)} toques`
                  : " · deixe a tela aberta até terminar"}
              </Rodape>
            )}

            {/*
              A GALERIA INTEIRA CABE MELHOR NO COMPUTADOR.

              Um casamento inteiro pelo celular são gigas e dezenas de toques, e
              no iPhone passa dos 5 GB do iCloud grátis. No computador é um zip
              só. O item manda o LINK para a própria pessoa — WhatsApp, e-mail —
              sem arquivo nenhum; lá ela abre e clica.
            */}
            {baixar.enviarParaOComputador && (
              <>
                <ItemDoMenu aoTocar={baixar.enviarParaOComputador}>Baixar tudo no computador</ItemDoMenu>
                <Rodape>manda o link para você — lá as fotos vêm num zip só</Rodape>
              </>
            )}

            {/*
              O ZIP NO CELULAR É OPÇÃO A MAIS, e a linha embaixo diz por quê:
              ele não cai onde a noiva procura as fotos.
            */}
            {baixar.baixarZip && (
              <>
                <ItemDoMenu aoTocar={baixar.baixarZip} desligado={Boolean(baixar.progresso)}>
                  {`Todas num arquivo .zip (${baixar.quantasNaGaleria})`}
                </ItemDoMenu>
                <Rodape>
                  {baixar.modo === "menu"
                    ? "o zip vai para Arquivos, não para o app Fotos"
                    : "o zip vai para Downloads e precisa ser extraído"}
                </Rodape>
              </>
            )}

            {/*
              AS FAVORITAS LOGO DEPOIS DE "TUDO", e antes das pastas.

              É a segunda coisa que o casal quer baixar — muitas vezes a
              primeira — porque é a lista que ELES montaram. Some quando não há
              nenhuma marcada: um item "As favoritas (0)" é um botão que não faz
              nada.
            */}
            {baixar.favoritas > 0 && (
              <ItemDoMenu aoTocar={baixar.baixarFavoritas} desligado={Boolean(baixar.progresso)}>
                {`${baixar.modo === "menu" ? "Salvar" : "Baixar"} as favoritas (${baixar.favoritas})`}
              </ItemDoMenu>
            )}

            {/* "…ou separado em pastas": os capítulos, um por linha. A contagem
                no rótulo é o que vai vir — a pasta inteira, carregada ou não. */}
            {baixar.pastas.length > 0 && (
              <>
                <p
                  className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-[0.14em]"
                  style={{ color: "var(--g-tenue)" }}
                >
                  ou uma pasta
                </p>
                {baixar.pastas.map((p) => (
                  <ItemDoMenu key={p.id} aoTocar={p.baixar} desligado={Boolean(baixar.progresso)}>
                    {`${p.nome} (${p.quantas})`}
                  </ItemDoMenu>
                ))}
              </>
            )}

            <Rodape>
              {baixar.modo === "menu"
                ? "vai abrir o menu do seu celular — toque em “Salvar imagens”"
                : baixar.modo === "download"
                  ? "vão para a pasta Download — no Google Fotos, em Coleções › No dispositivo"
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
        /*
         * `safe center` — e é ele que devolve o primeiro capítulo.
         *
         * Com `justify-content: center` numa lista que ROLA, o que transborda
         * some dos DOIS lados, e o excedente do lado de início fica fora da área
         * rolável: não há como alcançá-lo nem arrastando. Com seis capítulos num
         * notebook é exatamente o que o Felipe viu — "AKING OF NOIVO" cortado na
         * borda esquerda, e a lista começando no segundo.
         *
         * `safe` manda o navegador desistir da centralização assim que ela
         * causaria esse corte, caindo em `flex-start`. Enquanto tudo couber, a
         * barra continua centralizada como sempre esteve.
         */
        <ul
          ref={listaDeCapitulos}
          className="mt-1 flex gap-1 overflow-x-auto whitespace-nowrap"
          style={{ justifyContent: "safe center" }}
        >
          {capitulos.map((c) => {
            /*
              ── ÂNCORA OU ENDEREÇO, E QUEM DECIDE É O TAMANHO (11/09/2026) ──

              Abaixo do teto a galeria vem inteira e a âncora continua sendo a
              melhor coisa: rolar até o capítulo é o que o navegador faz melhor
              do que qualquer script, e nada recarrega.

              Acima do teto o capítulo não ESTÁ na página — é justamente o que
              tirou 6,35 MB do documento que estourava o iPhone. Aí a pastilha
              precisa ir buscá-lo, e vira um link de verdade.
            */
            /* Sem `cap`, a galeria fatiada abre pelo primeiro capítulo — é o
               que ela de fato mostra. A ressalva "da parte 2 em diante"
               desapareceu junto com a paginação em 16/09/2026: agora existe
               UMA tela por capítulo, e o resto chega rolando. */
            const aberto = fatia ? (fatia.capituloAtivo ?? capitulos[0]?.id) : null;
            const ativo = fatia ? aberto === c.id : capituloVisivel === c.id;
            return (
              <li key={c.id}>
                <a
                  /* O APELIDO no link, o ID na âncora. O link é o que a
                     pessoa copia e manda; a âncora é interna. Ver
                     `CapituloGaleria.apelido` e a migração 034. */
                  href={enderecoNaGaleria(enderecoBase, busca.toString(), { cap: c.apelido })}
                  aria-current={ativo ? "page" : undefined}
                  data-ativo={ativo ? "sim" : undefined}
                  className="inline-block rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition hover:opacity-70"
                  /*
                   * ── A MARCAÇÃO DE SELECIONADO, EM TRÊS SINAIS ──────────────
                   *
                   * Era só o fundo em `--g-superficie`, que nos temas claros fica
                   * a um passo do branco da página — Felipe pediu "a marcação
                   * mais definida", e "talvez o fundo mais escuro ainda".
                   *
                   * O fundo agora mistura o texto no fundo: escurece no tema
                   * claro e clareia no escuro, então a pastilha se destaca nos
                   * três temas sem cada um precisar de uma cor própria. A borda
                   * dá contorno onde a mistura ficar sutil, e o texto sobe para
                   * a cor cheia. Cor de AÇÃO (`--g-destaque`) fica de fora de
                   * propósito: ela é dos botões, e a barra não é um botão.
                   */
                  style={{
                    color: ativo ? "var(--g-texto)" : "var(--g-suave)",
                    background: ativo
                      ? "color-mix(in srgb, var(--g-texto) 12%, transparent)"
                      : undefined,
                    border: `1px solid ${ativo ? "var(--g-linha)" : "transparent"}`,
                  }}
                >
                  {c.nome}
                </a>
              </li>
            );
          })}
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
