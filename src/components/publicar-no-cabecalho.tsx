"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarPublicacaoAction } from "@/app/painel/actions";

/**
 * PUBLICAR DE QUALQUER ABA.
 *
 * Juan, 05/09/2026: "não achei onde publica a galeria… achei, na sessão de
 * entrega. Mas seria ótimo se tivesse lá em cima, em 'rascunho'. Pra publicar
 * independente de qual página estivesse."
 *
 * Ele descreveu o remédio junto com a queixa, e no lugar certo: o selo de
 * estado já respondia "está no ar?" nas quatro abas — faltava ele responder
 * também "e como coloco no ar?". O botão de publicar existia só na Entrega, que
 * é a última aba do menu, e quem acaba de montar o Design não tem motivo para
 * procurar ali.
 *
 * ── O SELO CONTINUA SENDO UM SELO QUANDO NÃO HÁ O QUE FAZER ───────────────
 *
 * Publicada e no cofre viram texto, não botão. "Tirar do ar" existe na Entrega
 * e no menu da lista, e trazê-lo para o cabeçalho poria uma ação destrutiva no
 * mesmo pixel em que, um minuto antes, havia uma ação construtiva — o tipo de
 * troca que faz a mão errar.
 *
 * Publicar a galeria também publica a aparência pendente (ver
 * `promoverRascunhoSePendente`), então este botão fecha o caso das duas
 * usuárias que entregaram a galeria com o tema errado.
 */
export function PublicarNoCabecalho({
  galeriaId,
  publicada,
  noCofre,
}: {
  galeriaId: string;
  publicada: boolean;
  noCofre: boolean;
}) {
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  if (noCofre) {
    return (
      <span className="rounded-full border border-acento/40 bg-acento/10 px-3 py-1 text-xs text-acento-alto">
        no cofre
      </span>
    );
  }

  if (publicada) {
    return (
      <span className="rounded-full border border-ok/40 bg-ok/10 px-3 py-1 text-xs text-ok">
        publicada
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="rounded-full border border-linha px-3 py-1 text-xs text-texto-faint">
        rascunho
      </span>
      <button
        type="button"
        disabled={salvando}
        onClick={() =>
          iniciar(async () => {
            const f = new FormData();
            f.set("galeria_id", galeriaId);
            f.set("publicada", "1");
            await salvarPublicacaoAction(f);
            router.refresh();
          })
        }
        className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-60"
      >
        {salvando ? "Publicando…" : "Publicar galeria"}
      </button>
    </span>
  );
}
