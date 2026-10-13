"use client";

import { useEffect } from "react";

/**
 * A MEMÓRIA DAS SEÇÕES DA ADMINISTRAÇÃO, E OS BOTÕES DE RECOLHER TUDO (13/10/2026).
 *
 * Felipe: "permita minimizar os menus dessa página, separando por seção". Cada
 * `<Bloco recolhivel>` é um `<details open data-secao="…">` que fecha e abre
 * sozinho, sem JavaScript. Este componente cuida do que o HTML não faz:
 *
 *   · LEMBRAR o que ficou fechado, entre uma visita e outra, no navegador de
 *     quem fechou (`localStorage`: é conveniência de quem olha, e não dado do
 *     sistema — se o navegador não deixar guardar, tudo abre como de costume);
 *   · ABRIR a seção para onde um link do índice (ou `#estudios` na barra de
 *     endereço) aponta — um destino dentro de uma seção fechada pareceria um
 *     link quebrado;
 *   · RECOLHER TUDO e EXPANDIR TUDO, para ficar só com o que se quer ver.
 *
 * Age direto no DOM, sem estado de React: o servidor entrega tudo aberto, e
 * depois de montar este componente fecha o que a pessoa tinha fechado. React
 * não reaplica `open` (a propriedade não muda), então o que foi fechado fica.
 */

const CHAVE = "admin.secoes-fechadas";

const secoes = () => Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-secao]"));

function lerFechadas(): string[] {
  try {
    const bruto = localStorage.getItem(CHAVE);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function guardarFechadas() {
  try {
    const fechadas = secoes()
      .filter((d) => !d.open)
      .map((d) => d.dataset.secao as string);
    localStorage.setItem(CHAVE, JSON.stringify(fechadas));
  } catch {
    /* sem armazenamento (janela privada, bloqueado): a página funciona do mesmo jeito */
  }
}

/** Abre a seção que contém o destino de um `#id` (a própria seção ou algo dentro dela). */
function abrirDestino(hash: string) {
  if (hash.length < 2) return;
  let alvo: Element | null = null;
  try {
    alvo = document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return;
  }
  const detalhes = alvo?.querySelector<HTMLDetailsElement>(":scope > details[data-secao]") ?? alvo?.closest<HTMLDetailsElement>("details[data-secao]");
  if (detalhes && !detalhes.open) {
    detalhes.open = true;
    /* Aberta depois do salto, a seção mudou de altura: volta ao destino. */
    alvo?.scrollIntoView();
  }
}

export function ControleDasSecoes() {
  useEffect(() => {
    const fechadas = new Set(lerFechadas());
    for (const d of secoes()) if (fechadas.has(d.dataset.secao as string)) d.open = false;
    /* `#estudios` na barra de endereço vence a memória: quem chegou por um link
       quer ver aquela seção. */
    abrirDestino(window.location.hash);

    /* `toggle` não borbulha; a captura pega o de todas as seções. */
    const aoAlternar = (e: Event) => {
      if (e.target instanceof HTMLDetailsElement && e.target.dataset.secao) guardarFechadas();
    };
    const aoMudarOHash = () => abrirDestino(window.location.hash);
    /* O índice do topo: abre ANTES de a âncora levar até lá, e vale também
       para clicar de novo no mesmo link, que não dispara `hashchange`. */
    const aoClicar = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href^='#']") : null;
      if (link) abrirDestino(link.getAttribute("href") ?? "");
    };
    document.addEventListener("toggle", aoAlternar, true);
    window.addEventListener("hashchange", aoMudarOHash);
    document.addEventListener("click", aoClicar);
    return () => {
      document.removeEventListener("toggle", aoAlternar, true);
      window.removeEventListener("hashchange", aoMudarOHash);
      document.removeEventListener("click", aoClicar);
    };
  }, []);

  const todas = (abrir: boolean) => {
    for (const d of secoes()) d.open = abrir;
  };

  const botao =
    "rounded-md border border-linha px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-texto-faint transition hover:border-linha-forte hover:text-texto";
  return (
    <span className="ml-auto flex gap-2">
      <button type="button" onClick={() => todas(false)} className={botao}>
        Recolher tudo
      </button>
      <button type="button" onClick={() => todas(true)} className={botao}>
        Expandir tudo
      </button>
    </span>
  );
}
