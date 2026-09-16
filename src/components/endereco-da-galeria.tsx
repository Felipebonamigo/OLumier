"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  esquecerApelidoGaleriaAction,
  trocarEnderecoGaleriaAction,
} from "@/app/painel/actions";

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
        É a parte final do link do cliente. Depois de publicada, trocar o endereço mantém o
        anterior abrindo, para os links que você já entregou não quebrarem. Antes disso, o
        anterior simplesmente deixa de existir.
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

      {/*
        ── APAGAR UM ENDEREÇO ANTIGO (16/09/2026) ──────────────────────────
 
        Felipe: "quando alterar o endereço da galeria, apagar o antigo".
 
        A troca já não guarda apelido quando não há link em circulação — ver
        `jaCirculou`. O que sobra é o caso em que apagar é o OBJETIVO: o link
        foi entregue, vazou para quem não devia, e trocar o endereço era
        justamente para revogá-lo. Enquanto o anterior continuasse abrindo, a
        troca não revogava nada.
 
        Pergunta antes, e a pergunta diz a consequência pelo nome: é a única
        ação desta tela que pode matar um link que está na mão de alguém.
      */}
      {apelidos.length > 0 && (
        <div className="mt-2 text-xs text-texto-faint">
          <span>Também continuam abrindo:</span>
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
        </div>
      )}

      {esquecido.erro && <p className="mt-2 text-xs text-erro">{esquecido.erro}</p>}
      {esquecido.ok && <p className="mt-2 text-xs text-ok">{esquecido.ok}</p>}

      {estado.erro && <p className="mt-2 text-xs text-erro">{estado.erro}</p>}
      {estado.ok && <p className="mt-2 text-xs text-ok">{estado.ok}</p>}
    </div>
  );
}
