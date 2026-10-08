"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaExibida } from "@/components/grade-medias";
import { chaveDaMiniatura, lerMiniatura } from "@/lib/miniaturas-do-painel";

/**
 * A FOTO AMPLIADA, enquanto se organiza a galeria (08/10/2026).
 *
 * ── O PEDIDO ──────────────────────────────────────────────────────────────
 *
 * Uma aluna: "poder ampliar/abrir a foto enquanto estou organizando a galeria.
 * Às vezes preciso ver o rosto do convidado pra botar no lugar certo, ver algum
 * detalhe, escolher as melhores pra botar em primeiro lugar."
 *
 * A miniatura da grade é pequena de propósito — o Juan pediu "bem menores"
 * em 25/09/2026, para varrer 4.500 fotos de uma vez. O que faltava era o outro
 * movimento: olhar UMA com calma. Clicar na foto continua marcando (é o que a
 * mão faz o dia inteiro); ampliar é o botão da lupa, ou o duplo clique.
 *
 * ── PASSAR DE UMA PARA OUTRA ──────────────────────────────────────────────
 *
 * Ver o rosto de uma foto e voltar para a grade para abrir a vizinha seria o
 * mesmo problema de novo. Setas (e o teclado, e o deslize no celular) andam
 * pela lista que a grade mostra AGORA — com um capítulo filtrado, só as fotos
 * dele; com uma busca, só as que casam. E dá para marcar a foto sem sair: quem
 * "escolhe as melhores" é exatamente quem está olhando uma a uma.
 *
 * ── O QUE CARREGA ─────────────────────────────────────────────────────────
 *
 * A prévia de 2048 px (a mesma que o casal vê), pedida só para a foto aberta, a
 * anterior e as duas seguintes — e não para o recorte inteiro. Enquanto ela
 * chega, a miniatura que já está na tela ocupa o lugar, para a troca de foto
 * nunca mostrar um vazio. Ver `lib/previas-assinadas.ts`.
 *
 * `<dialog>` de verdade, com `showModal`: Esc, foco preso e fundo inerte vêm do
 * navegador (a mesma escolha do modal de mover e do enquadramento da capa).
 */
export function AmpliarFoto({
  galeriaId,
  fotos,
  idInicial,
  marcadas,
  capituloDe,
  aoMarcar,
  aoFechar,
}: {
  galeriaId: string;
  /** As fotos do recorte atual da grade, na ordem em que aparecem. */
  fotos: MediaExibida[];
  idInicial: string;
  marcadas: Set<string>;
  capituloDe: (secaoId: string | null) => string | null;
  aoMarcar: (id: string) => void;
  /** `ultimoId` é a foto em que a pessoa parou — para a grade poder levá-la até lá. */
  aoFechar: (ultimoId: string) => void;
}) {
  const caixa = useRef<HTMLDialogElement>(null);
  const palco = useRef<HTMLDivElement>(null);
  const [idAtual, setIdAtual] = useState(idInicial);
  /* id → endereço da prévia; `null` = o servidor respondeu e não há (HEIC sem
     prévia): fica a miniatura, e a tela diz isso. */
  const [previas, setPrevias] = useState<Record<string, string | null>>({});
  const [falhou, setFalhou] = useState(false);
  const [carregada, setCarregada] = useState<string | null>(null);
  const pedidas = useRef(new Set<string>());
  const toqueX = useRef<number | null>(null);

  const indice = useMemo(() => fotos.findIndex((f) => f.id === idAtual), [fotos, idAtual]);
  const foto = indice >= 0 ? fotos[indice] : undefined;

  useEffect(() => {
    const el = caixa.current;
    if (el && !el.open) el.showModal();
    /* O foco no palco, e não no primeiro botão: assim a barra de espaço marca a
       foto (ver `aoTecla`) em vez de apertar "Fechar". */
    palco.current?.focus();
  }, []);

  /* A foto some do recorte enquanto está aberta (apagada em outra aba, ou um
     filtro mudou): não há o que mostrar, e o modal fecha em vez de ficar vazio. */
  useEffect(() => {
    if (indice < 0) caixa.current?.close();
  }, [indice]);

  /*
   * Os ids que importam agora, como TEXTO: a grade manda um array novo a cada
   * desenho dela, e um efeito que dependesse dele rodaria (e se desfaria) o
   * tempo todo — a resposta chegaria depois da limpeza e seria jogada fora, com
   * os ids já marcados como pedidos. Foi o defeito da primeira versão: a foto
   * grande nunca aparecia. Texto igual não dispara nada.
   */
  const vizinhas = [indice, indice + 1, indice - 1, indice + 2]
    .map((i) => (i >= 0 ? (fotos[i]?.id ?? "") : ""))
    .join(",");

  useEffect(() => {
    const quero = vizinhas.split(",").filter((id) => id && !pedidas.current.has(id));
    if (quero.length === 0) return;
    for (const id of quero) pedidas.current.add(id);
    fetch(`/api/galerias/${galeriaId}/previas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: quero }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((corpo: { enderecos: Record<string, string> }) => {
        setFalhou(false);
        setPrevias((atual) => ({
          ...atual,
          ...Object.fromEntries(quero.map((id) => [id, corpo.enderecos[id] ?? null])),
        }));
      })
      .catch(() => {
        /* Libera os ids para uma nova tentativa na próxima passada. */
        for (const id of quero) pedidas.current.delete(id);
        setFalhou(true);
      });
  }, [vizinhas, galeriaId]);

  const vai = (passo: number) => {
    const alvo = fotos[indice + passo];
    if (alvo) setIdAtual(alvo.id);
  };

  function aoTecla(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      vai(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      vai(-1);
    } else if (e.key === " " && foto && e.target === palco.current) {
      /* Só com o foco no palco: com o foco num botão, o espaço já é o clique
         dele, e marcar duas vezes seria não marcar. */
      e.preventDefault();
      aoMarcar(foto.id);
    }
  }

  const miniatura = foto ? lerMiniatura(chaveDaMiniatura(foto))?.url ?? foto.url : undefined;
  const grande = foto ? previas[foto.id] : undefined;
  const marcada = foto ? marcadas.has(foto.id) : false;
  const capitulo = foto ? capituloDe(foto.secaoId) : null;
  const pronta = foto !== undefined && carregada === foto.id;

  return (
    <dialog
      ref={caixa}
      aria-label={foto ? `Foto ampliada: ${foto.nome}` : "Foto ampliada"}
      onClose={() => aoFechar(idAtual)}
      onKeyDown={aoTecla}
      className="fixed inset-0 m-0 h-dvh max-h-none w-dvw max-w-none bg-black p-0 text-white backdrop:bg-black"
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{foto?.nome}</p>
            <p className="truncate text-[11px] text-white/60">
              {indice >= 0 && `${indice + 1} de ${fotos.length}`}
              {capitulo && ` · ${capitulo}`}
              {(foto?.favoritas ?? 0) > 0 && ` · ♥ ${foto?.favoritas}`}
            </p>
          </div>
          <button
            type="button"
            aria-pressed={marcada}
            onClick={() => foto && aoMarcar(foto.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              marcada
                ? "border-acento bg-acento font-semibold text-void"
                : "border-white/30 hover:border-white/60"
            }`}
          >
            {marcada ? "✓ marcada" : "marcar"}
          </button>
          <button
            type="button"
            onClick={() => caixa.current?.close()}
            className="rounded-lg border border-white/30 px-3 py-1.5 text-xs transition hover:border-white/60"
          >
            Fechar
          </button>
        </div>

        <div
          ref={palco}
          tabIndex={-1}
          onTouchStart={(e) => {
            toqueX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const x0 = toqueX.current;
            toqueX.current = null;
            const x1 = e.changedTouches[0]?.clientX;
            if (x0 === null || x1 === undefined) return;
            /* 60 px: um toque que escorrega não vira troca de foto. */
            if (Math.abs(x1 - x0) > 60) vai(x1 < x0 ? 1 : -1);
          }}
          className="relative min-h-0 flex-1 focus:outline-none"
        >
          {foto && (
            <>
              {miniatura && (
                // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                <img
                  src={miniatura}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-contain"
                />
              )}
              {grande && (
                // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                <img
                  key={foto.id}
                  src={grande}
                  alt={foto.nome}
                  onLoad={() => setCarregada(foto.id)}
                  className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-150 ${
                    pronta ? "opacity-100" : "opacity-0"
                  }`}
                />
              )}
            </>
          )}

          <button
            type="button"
            aria-label="Foto anterior"
            disabled={indice <= 0}
            onClick={() => vai(-1)}
            className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-xl transition hover:bg-black/80 disabled:opacity-20"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Próxima foto"
            disabled={indice < 0 || indice >= fotos.length - 1}
            onClick={() => vai(1)}
            className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-xl transition hover:bg-black/80 disabled:opacity-20"
          >
            ›
          </button>
        </div>

        <p role="status" className="px-4 py-2 text-center text-[11px] text-white/50">
          {grande === null
            ? "Esta foto não tem prévia grande (formato que o navegador não abre) — está aparecendo a miniatura."
            : falhou
              ? "Não consegui carregar a foto grande. Passe para outra e volte."
              : null}
          {grande !== null && !falhou && (
            <>
              <span className="[@media(hover:none)]:hidden">← → passam de foto · espaço marca · esc fecha</span>
              <span className="hidden [@media(hover:none)]:inline">deslize para passar de foto</span>
            </>
          )}
        </p>
      </div>
    </dialog>
  );
}
