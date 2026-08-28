"use client";

import { CHAVE_TEMA, TEMAS, type TemaEscolhido } from "@/config/tema";

/**
 * Escolha do tema da interface: claro, escuro e Movimento Átomo.
 *
 * NÃO GUARDA ESTADO EM REACT, de propósito. Quem desenha o tema é o CSS
 * (`color-scheme` + `light-dark()` para os dois primeiros, um bloco próprio
 * para o terceiro); aqui só gravamos a escolha no <html> e no localStorage.
 * Sem estado não há hidratação divergente e não há o piscar clássico de tema —
 * o servidor não sabe (nem pode saber) o que a pessoa escolheu, então qualquer
 * marca de estado no HTML entregue estaria errada metade das vezes.
 *
 * Qual botão aparece MARCADO também sai do CSS, lendo o `data-tema` do <html>
 * (ver globals.css). Era um botão só, cego, que alternava entre dois; com três
 * temas, cego vira adivinhação — mas o remédio não podia ser estado no
 * cliente, pelo motivo do parágrafo acima.
 */
export function SeletorTema({ className = "" }: { className?: string }) {
  function escolher(tema: TemaEscolhido) {
    /* `setAttribute` e não `dataset.tema =`: o lint do React Compiler recusa a
       atribuição dentro de uma função chamada por outra (o `onClick` de cada
       botão), porque não consegue provar que o alvo é local. É a mesma escrita
       no HTML, e o script do <head> lê o mesmo atributo. */
    document.documentElement.setAttribute("data-tema", tema);
    try {
      localStorage.setItem(CHAVE_TEMA, tema);
    } catch {
      // Navegação privada pode recusar o armazenamento. A troca vale nesta aba
      // mesmo assim; só não sobrevive ao recarregar.
    }
  }

  return (
    <div
      role="group"
      aria-label="Tema da interface"
      className={`flex items-center gap-0.5 rounded-full border border-linha p-0.5 ${className}`}
    >
      {TEMAS.map(({ valor, rotulo, icone }) => (
        <button
          key={valor}
          type="button"
          data-tema-opcao={valor}
          onClick={() => escolher(valor)}
          title={`Tema ${rotulo}`}
          aria-label={`Tema ${rotulo}`}
          className="grid h-7 w-7 place-items-center rounded-full text-[13px] leading-none text-texto-soft transition hover:text-texto"
        >
          <span aria-hidden>{icone}</span>
        </button>
      ))}
    </div>
  );
}
