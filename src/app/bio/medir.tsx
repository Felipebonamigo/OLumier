"use client";

import { useEffect } from "react";

/**
 * Avisa o servidor que a página abriu. É a única coisa de JavaScript da página.
 *
 * Uma vez por aba (`sessionStorage`): recarregar ou voltar para a página não
 * conta de novo. Navegador sem `sessionStorage` (modo privado de alguns) conta
 * a cada abertura — contar a mais é menos grave que não contar.
 *
 * A origem chega PRONTA do servidor, que já a leu da URL e do endereço de
 * onde a pessoa veio: ler de novo aqui seria duas regras para a mesma coisa.
 *
 * `keepalive` deixa o pedido terminar mesmo que a pessoa toque num botão e a
 * página mude no meio.
 */
export function MedirBio({ fonte, meio, campanha }: { fonte: string; meio: string; campanha: string | null }) {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("bio_page_view")) return;
      sessionStorage.setItem("bio_page_view", "1");
    } catch {
      /* segue: conta */
    }
    void fetch("/api/bio/evento", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ evento: "page_view", fonte, meio, campanha }),
      keepalive: true,
    }).catch(() => {});
  }, [fonte, meio, campanha]);

  return null;
}
