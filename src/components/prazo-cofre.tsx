"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PRAZOS } from "@/config/prazos";
import { definirPrazoAction, arquivarAgoraAction, reativarAction } from "@/app/painel/actions";

/**
 * Prazo no ar e cofre.
 *
 * O texto explicativo fica sempre visível, não escondido num "saiba mais": a
 * palavra "arquivar" assusta, e a dúvida ("vou perder as fotos?") aparece
 * exatamente na hora de escolher o prazo.
 */
export function PrazoCofre({
  galeriaId,
  arquivada,
  mesesAtual,
  diasRestantes,
  arquivadaEm,
}: {
  galeriaId: string;
  arquivada: boolean;
  /** null = sem prazo */
  mesesAtual: number | null;
  diasRestantes: number | null;
  arquivadaEm: string | null;
}) {
  const [ocupado, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  // Arquivar e reativar podem RECUSAR agora (cofre cheio, ou sem espaço no ar
  // para trazer de volta). Engolir esse retorno deixaria a pessoa clicando de
  // novo sem entender por que nada acontece.
  const executar = (
    acao: (f: FormData) => Promise<void | { erro?: string }>,
    extra: Record<string, string> = {},
  ) =>
    iniciar(async () => {
      setErro(null);
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      for (const [k, v] of Object.entries(extra)) f.set(k, v);
      const r = await acao(f);
      if (r?.erro) {
        setErro(r.erro);
        return;
      }
      router.refresh();
    });

  const Aviso = () =>
    erro ? (
      <p role="alert" className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta">
        {erro}
      </p>
    ) : null;

  if (arquivada) {
    return (
      <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
        <h2 className="text-sm font-semibold">No cofre</h2>
        <p className="mt-1 max-w-[58ch] text-xs text-texto-faint">
          O link está fora do ar, mas <strong className="text-texto-soft">nada foi apagado</strong>
          {arquivadaEm
            ? ` — guardada desde ${new Date(arquivadaEm).toLocaleDateString("pt-BR")}.`
            : "."}{" "}
          Reative quando um cliente pedir; volta no ar na hora, com o mesmo link.
        </p>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => executar(reativarAction)}
          className="mt-4 rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-50"
        >
          {ocupado ? "Reativando…" : "Tirar do cofre"}
        </button>
        <p className="mt-2 text-[11px] text-texto-faint">
          Volta com mais 12 meses no ar, contados de hoje.
        </p>
        <Aviso />
      </section>
    );
  }

  const perto = diasRestantes !== null && diasRestantes <= 30;

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <h2 className="text-sm font-semibold">Quanto tempo no ar</h2>
      <p className="mt-1 max-w-[62ch] text-xs text-texto-faint">
        Quando o prazo terminar, a galeria desce para o cofre: o link sai do ar, mas{" "}
        <strong className="text-texto-soft">nada é apagado</strong>. Você reativa em um clique
        quando quiser.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {PRAZOS.map((p) => {
          const ativo = mesesAtual === p.meses;
          return (
            <button
              key={p.rotulo}
              type="button"
              disabled={ocupado}
              onClick={() => executar(definirPrazoAction, { meses: p.meses?.toString() ?? "" })}
              className={`rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                ativo
                  ? "border-acento bg-acento/10 text-acento-alto"
                  : "border-linha text-texto-soft hover:border-linha-forte hover:text-texto"
              }`}
            >
              {p.rotulo}
            </button>
          );
        })}
      </div>

      {diasRestantes !== null ? (
        <p className={`mt-3 text-xs ${perto ? "text-alerta" : "text-texto-soft"}`}>
          {diasRestantes > 0
            ? `Vai para o cofre em ${diasRestantes} ${diasRestantes === 1 ? "dia" : "dias"}.`
            : "O prazo já venceu — vai para o cofre na próxima verificação."}
        </p>
      ) : (
        <p className="mt-3 text-xs text-texto-soft">Fica no ar até você decidir o contrário.</p>
      )}

      <button
        type="button"
        disabled={ocupado}
        onClick={() => {
          if (confirm("Guardar esta galeria no cofre agora?\n\nO link sai do ar, mas nada é apagado — dá para reativar quando quiser.")) {
            executar(arquivarAgoraAction);
          }
        }}
        className="mt-4 rounded-lg border border-linha-forte px-4 py-2 text-sm text-texto-soft transition hover:bg-carbon-2 disabled:opacity-50"
      >
        Guardar no cofre agora
      </button>
      <Aviso />
    </section>
  );
}
