import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { galeriaDoPainel } from "@/lib/galeria-painel";
import { comoChamar } from "@/lib/favoritas";
import { dataHora } from "@/lib/data-na-tela";
import { lerPerguntas, recadosDaGaleria, TETO_DO_CONVITE } from "@/lib/recados";
import { EditorRecados } from "@/components/editor-recados";

export const metadata: Metadata = { title: "Recados da galeria" };
export const dynamic = "force-dynamic";

/**
 * A aba RECADOS — o que o casal escreveu, e como pedir.
 *
 * Juan, 01/10/2026: "disponibilizar uma área de feedbacks (…) montado e
 * organizado lá na área de feedbacks da organização da galeria (…) Só o
 * fotógrafo/dono da galeria poderá acessar as respostas."
 *
 * As duas coisas na mesma tela, e é o que ele descreveu: montar o pedido e ler
 * as respostas são o mesmo assunto, e separá-los faria o fotógrafo configurar
 * numa aba e descobrir o resultado em outra.
 *
 * A TRANCA é `galeriaDoPainel`, que amarra `tenant_id` — a mesma das outras
 * abas, e a razão de ela ser uma função só está escrita lá. Não existe rota
 * pública que leia recado: `/api/g/[id]/recado` é POST e nada mais.
 */
export default async function RecadosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");
  const galeria = await galeriaDoPainel(id, tenantId);
  if (!galeria) notFound();

  const recados = await recadosDaGaleria(galeria.id);
  const perguntas = lerPerguntas(galeria.recado_perguntas);

  /* A média por pergunta, só com quem respondeu aquela pergunta. Contar quem
     não respondeu como zero rebaixaria a nota de todo mundo que escreveu só o
     texto — e é o tipo de número errado que se usa para tomar decisão. */
  const medias = perguntas.map((q) => {
    const notas = recados.map((r) => r.notas[q]).filter((n) => typeof n === "number");
    return {
      pergunta: q,
      quantas: notas.length,
      media: notas.length ? notas.reduce((t, n) => t + n, 0) / notas.length : null,
    };
  });

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-medium">Pedir recado nesta galeria</h2>
        <p className="mt-1 text-xs text-texto-faint">
          Ligado, o casal encontra o convite no menu da galeria, junto das favoritas, e no fim da
          entrega. Só você lê as respostas.
        </p>
        <div className="mt-4 rounded-xl border border-linha p-4">
          <EditorRecados
            galeriaId={galeria.id}
            config={{
              ativo: galeria.recado_ativo,
              estrelas: galeria.recado_estrelas,
              convite: (galeria.recado_convite ?? "").slice(0, TETO_DO_CONVITE),
              perguntas,
            }}
          />
        </div>
      </section>

      {medias.length > 0 && (
        <section>
          <h2 className="text-sm font-medium">As notas</h2>
          <ul className="mt-3 space-y-2">
            {medias.map((m) => (
              <li
                key={m.pergunta}
                className="flex items-baseline justify-between gap-3 rounded-lg border border-linha px-3 py-2"
              >
                <span className="min-w-0 text-xs text-texto-soft">{m.pergunta}</span>
                <span className="shrink-0 text-sm tabular-nums">
                  {m.media === null ? (
                    <span className="text-xs text-texto-faint">sem resposta ainda</span>
                  ) : (
                    <>
                      {m.media.toFixed(1)}
                      <span className="text-xs text-texto-faint">
                        {" "}
                        de 5 · {m.quantas} {m.quantas === 1 ? "resposta" : "respostas"}
                      </span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium">
          Recados {recados.length > 0 && <span className="text-texto-faint">({recados.length})</span>}
        </h2>
        {recados.length === 0 ? (
          <p className="mt-2 text-xs text-texto-faint">
            Ninguém escreveu ainda. Os recados aparecem aqui conforme o casal responde.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {recados.map((r) => (
              <li key={r.id} className="rounded-xl border border-linha p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">{comoChamar(r)}</span>
                  <span className="text-[11px] text-texto-faint">
                    {dataHora(r.quando)}
                    {r.corrigido && " · corrigido depois"}
                  </span>
                </div>
                {r.email && r.nome && (
                  <p className="mt-0.5 text-[11px] text-texto-faint">{r.email}</p>
                )}
                {r.texto && (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-texto-soft">
                    {r.texto}
                  </p>
                )}
                {Object.keys(r.notas).length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {Object.entries(r.notas).map(([q, n]) => (
                      <li key={q} className="flex items-baseline justify-between gap-3 text-[11px]">
                        <span className="min-w-0 text-texto-faint">{q}</span>
                        <span className="shrink-0 tabular-nums text-texto-soft">{n} de 5</span>
                      </li>
                    ))}
                  </ul>
                )}
                {r.autoriza && (
                  /* A autorização foi pedida na hora de escrever e não se pede
                     depois — por isso ela é mostrada aqui, com a frase. */
                  <p className="mt-3 text-[11px] text-acento-alto">
                    Autorizou usar como depoimento.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
