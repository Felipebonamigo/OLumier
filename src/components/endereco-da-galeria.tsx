"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { trocarEnderecoGaleriaAction } from "@/app/painel/actions";

/**
 * O endereço da galeria, editável — e a lista dos que continuam abrindo.
 *
 * Juan, 05/09/2026: "to tentando trocar o url e não consigo, clico e a área não
 * é clicável" — e depois, sobre `paula-bruno-2`, "não consegui arrumar o 2".
 *
 * O campo era travado com razão (o link vai para o WhatsApp do casal), e a
 * trava caiu quando o endereço anterior passou a virar apelido: ele continua
 * abrindo, com redirecionamento permanente. Ver `lib/endereco-galeria.ts`.
 *
 * ── OS APELIDOS APARECEM, E É ISSO QUE FAZ A TROCA SER UMA DECISÃO ────────
 *
 * Sem a lista, "o endereço anterior continua funcionando" é uma promessa que a
 * pessoa tem de acreditar. Com ela, é uma coisa que ela vê — e no dia em que
 * alguém perguntar "aquele link antigo ainda abre?", a resposta está na tela em
 * vez de num comentário de código.
 */
export function EnderecoDaGaleria({
  galeriaId,
  slug,
  apelidos,
}: {
  galeriaId: string;
  slug: string;
  /** Endereços anteriores que ainda levam para cá, do mais novo ao mais velho. */
  apelidos: string[];
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
      <p className="mt-0.5 text-xs text-texto-faint">
        É a parte final do link do cliente. Se você trocar, o endereço anterior continua abrindo e
        leva para cá — os links que você já entregou não quebram.
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

      {apelidos.length > 0 && (
        <p className="mt-2 text-xs text-texto-faint">
          Também continuam abrindo:{" "}
          {apelidos.map((a, i) => (
            <span key={a}>
              {i > 0 && ", "}
              <span className="font-mono text-texto-soft">/{a}</span>
            </span>
          ))}
        </p>
      )}

      {estado.erro && <p className="mt-2 text-xs text-erro">{estado.erro}</p>}
      {estado.ok && <p className="mt-2 text-xs text-ok">{estado.ok}</p>}
    </div>
  );
}
