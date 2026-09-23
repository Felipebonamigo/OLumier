"use client";

import { useEffect, type RefObject } from "react";

/**
 * FECHAR MENU AO CLICAR FORA (e no Esc).
 *
 * ── POR QUE ISTO EXISTE COMO ARQUIVO ──────────────────────────────────────
 *
 * Os menus do produto são `<details>`/`<summary>` nativos, e a razão está
 * escrita em `menus-da-galeria.tsx`: o navegador já traz abertura por clique e
 * por teclado, navegação com Tab e leitura correta por leitor de tela, sem
 * estado nem biblioteca. O que ele NÃO traz é o descarte leve — clicar fora e
 * o menu sumir.
 *
 * A barra da galeria ganhou esse efeito em 10/09/2026. A lista de galerias do
 * painel ficou sem, e em 16/09/2026 o Felipe topou com a diferença: "aqui ao
 * clicar fora disso, deveria fechar esse pop-up". Não era decisão nenhuma —
 * era o mesmo efeito escrito num arquivo só, e o outro nasceu depois.
 *
 * Extrair foi a resposta para o defeito não voltar no terceiro menu.
 *
 * ── POR QUE `pointerdown`, E NÃO `click` ────────────────────────────────
 *
 * `click` só dispara quando o botão sobe, depois de o alvo já ter reagido —
 * num item que navega, o menu fecharia junto com a página saindo, e o gesto
 * pareceria ter escapado. `pointerdown` fecha no instante em que o dedo
 * encosta, que é quando a pessoa já decidiu sair dali.
 *
 * @param escopo Onde procurar menus abertos. Sem `current`, o efeito não faz
 *   nada — é o estado normal antes da montagem, e não um erro.
 */
export function useFecharMenuAoClicarFora(escopo: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const fechar = (menosEste?: Node) => {
      const abertos = escopo.current?.querySelectorAll("details[open]") ?? [];
      for (const d of Array.from(abertos)) {
        /* O menu que contém o alvo do clique NÃO fecha: é ele que está sendo
           usado, e fechá-lo aqui engoliria o clique no próprio item. */
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
  }, [escopo]);
}
