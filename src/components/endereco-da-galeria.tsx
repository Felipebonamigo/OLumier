"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { trocarEnderecoGaleriaAction } from "@/app/painel/actions";

/**
 * O endereço da galeria: editável enquanto dá, explicado quando não dá.
 *
 * Juan, 05/09/2026: "to tentando trocar o url e não consigo, clico e a área não
 * é clicável" — e depois, sobre `paula-bruno-2`, "não consegui arrumar o 2".
 *
 * O campo não era travado por esquecimento (ver `lib/endereco-galeria.ts`): o
 * link vai para o WhatsApp do casal, e a galeria não tem apelido para o
 * endereço antigo continuar valendo. O que faltava era a tela DIZER isso. Campo
 * que não responde ao clique é lido como defeito; campo travado com o motivo ao
 * lado é lido como regra — e a diferença é quem a pessoa culpa.
 */
export function EnderecoDaGaleria({
  galeriaId,
  slug,
  podeTrocar,
}: {
  galeriaId: string;
  slug: string;
  podeTrocar: boolean;
}) {
  const router = useRouter();
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

      {podeTrocar ? (
        <>
          <p className="mt-0.5 text-xs text-texto-faint">
            É a parte final do link do cliente. Dá para trocar enquanto a galeria não foi publicada
            nem aberta por ninguém — depois disso ele fica fixo, para não quebrar o link que você
            entregou.
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
              className="rounded-lg border border-linha-forte px-3 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-50"
            >
              {ocupado ? "Salvando…" : "Salvar"}
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="mt-1 font-mono text-sm text-texto">/{slug}</p>
          <p className="mt-1.5 text-xs text-texto-faint">
            Fixo: esta galeria já foi publicada ou já foi aberta por alguém. Trocar o endereço
            agora transformaria em erro o link que já está circulando — e a galeria não tem
            endereço antigo que continue valendo.
          </p>
        </>
      )}

      {estado.erro && <p className="mt-2 text-xs text-erro">{estado.erro}</p>}
      {estado.ok && <p className="mt-2 text-xs text-ok">{estado.ok}</p>}
    </div>
  );
}
