"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  esquecerApelidoGaleriaAction,
  trocarEnderecoGaleriaAction,
} from "@/app/painel/actions";

/**
 * O endereço da galeria, editável — e o aviso de que trocar mata o anterior.
 *
 * Juan, 05/09/2026: "to tentando trocar o url e não consigo, clico e a área não
 * é clicável" — e depois, sobre `paula-bruno-2`, "não consegui arrumar o 2".
 *
 * O campo era travado com razão (o link vai para o WhatsApp do casal). A trava
 * caiu primeiro guardando o endereço de saída como apelido; desde 16/09/2026,
 * não: Felipe pediu "quando alterar o endereço da galeria, apagar o antigo" e,
 * perguntado sobre a galeria já entregue, "pode apagar sempre o endereço
 * antigo". Ver `lib/endereco-galeria.ts`.
 *
 * ── O AVISO É O QUE FAZ A TROCA SER UMA DECISÃO ───────────────────────────
 *
 * Antes, a tela listava os endereços que continuavam abrindo, e essa lista era
 * a prova de uma promessa boa. Agora a notícia é a oposta, e esconder notícia
 * ruim é pior que não ter tido a boa: o texto embaixo do campo diz o que
 * acontece, e a galeria NO AR ainda pergunta antes — é a única tela em que
 * salvar um campo pode matar um link que está na mão de alguém.
 */
export function EnderecoDaGaleria({
  galeriaId,
  slug,
  publicada,
  apelidos,
}: {
  galeriaId: string;
  slug: string;
  /** No ar = pode haver link entregue, e aí a troca pergunta antes. */
  publicada: boolean;
  /** Endereços anteriores que ainda levam para cá, do mais novo ao mais velho. */
  apelidos: string[];
}) {
  const router = useRouter();
  const [esquecido, esquecer, esquecendo] = useActionState(
    async (anterior: { ok?: string; erro?: string }, form: FormData) => {
      const r = await esquecerApelidoGaleriaAction(anterior, form);
      if (r.ok) router.refresh();
      return r;
    },
    {},
  );
  const [estado, agir, ocupado] = useActionState(
    async (anterior: { ok?: string; erro?: string }, form: FormData) => {
      const r = await trocarEnderecoGaleriaAction(anterior, form);
      if (r.ok) router.refresh();
      return r;
    },
    {},
  );

  return (
    <div className="rounded-xl border border-linha bg-carbon p-4">
      <span className="block text-sm font-medium">Endereço da galeria</span>
      <p className="mt-0.5 text-xs text-texto-faint">
        É a parte final do link do cliente. Trocar o endereço apaga o anterior: quem já tiver o link
        antigo vai ver uma página de endereço não encontrado.
      </p>

      <form action={agir} className="mt-2.5 flex flex-wrap items-center gap-2">
        <input type="hidden" name="galeria_id" value={galeriaId} />
        <span className="font-mono text-sm text-texto-faint">/</span>
        <input
          name="slug"
          defaultValue={slug}
          spellCheck={false}
          aria-label="Endereço da galeria"
          className="min-w-0 flex-1 rounded-lg border border-linha bg-void px-3 py-2 font-mono text-sm text-texto focus:border-acento focus:outline-none"
        />
        <button
          type="submit"
          disabled={ocupado}
          onClick={(e) => {
            /* Só com a galeria no ar: em rascunho não existe link entregue, e
               perguntar ali seria o susto sem a notícia — justamente o caso do
               `paula-bruno-2`, endereço corrigido antes de qualquer entrega. */
            if (!publicada) return;
            if (
              !confirm(
                `Trocar o endereço de /${slug}?\n\n` +
                  `Esta galeria está no ar. O endereço atual para de abrir na hora, e quem já ` +
                  `tiver esse link vai ver uma página de endereço não encontrado.`,
              )
            ) {
              e.preventDefault();
            }
          }}
          className="rounded-lg border border-linha-forte px-3 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-50"
        >
          {ocupado ? "Salvando…" : "Salvar"}
        </button>
      </form>

      {/*
        ── O QUE SOBROU DAS TROCAS ANTIGAS (16/09/2026) ────────────────────
 
        A troca não guarda mais apelido, mas as galerias que trocaram ANTES
        disso carregam os seus, e eles continuam abrindo. Some da tela sozinho:
        a próxima troca leva todos junto, e o "apagar" leva um agora — que é o
        que importa quando o link vazou e a pressa é essa.
 
        Pergunta antes, e a pergunta diz a consequência pelo nome.
      */}
      {apelidos.length > 0 && (
        <div className="mt-2 text-xs text-texto-faint">
          <span>De trocas anteriores, ainda abrem:</span>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {apelidos.map((a) => (
              <li key={a} className="flex items-center gap-1.5">
                <span className="font-mono text-texto-soft">/{a}</span>
                <form action={esquecer} className="contents">
                  <input type="hidden" name="galeria_id" value={galeriaId} />
                  <input type="hidden" name="slug" value={a} />
                  <button
                    type="submit"
                    disabled={esquecendo}
                    aria-label={`Fazer /${a} parar de abrir esta galeria`}
                    onClick={(e) => {
                      if (
                        !confirm(
                          `Fazer /${a} parar de abrir esta galeria?\n\n` +
                            `Quem tiver esse link vai passar a ver uma página de endereço não encontrado.`,
                        )
                      ) {
                        e.preventDefault();
                      }
                    }}
                    className="underline underline-offset-4 transition hover:text-erro disabled:opacity-50"
                  >
                    apagar
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="mt-1">Salvar um endereço novo também apaga estes.</p>
        </div>
      )}

      {esquecido.erro && <p className="mt-2 text-xs text-erro">{esquecido.erro}</p>}
      {esquecido.ok && <p className="mt-2 text-xs text-ok">{esquecido.ok}</p>}

      {estado.erro && <p className="mt-2 text-xs text-erro">{estado.erro}</p>}
      {estado.ok && <p className="mt-2 text-xs text-ok">{estado.ok}</p>}
    </div>
  );
}
