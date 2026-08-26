"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarRegrasSelecaoAction, reabrirSelecaoAction } from "@/app/painel/actions";

/**
 * A escolha do álbum, do lado de quem entrega.
 *
 * O que estava faltando não era a marcação — os corações já funcionavam desde a
 * migração 010. Faltava tudo o que vem depois dela: quantas fotos cabem, até
 * quando dá para escolher, e o sinal de que acabou.
 *
 * Sem esse sinal o fotógrafo não tem como saber quando pode editar. Ele volta ao
 * WhatsApp perguntar "já escolheram?", que é exatamente o vai e volta que a
 * seleção veio matar.
 *
 * ── POR QUE A LISTA FICA AQUI, E EM TEXTO ─────────────────────────────────
 * Porque o próximo passo dele é o Lightroom, e lá se filtra por NOME DE
 * ARQUIVO. Um botão de "exportar CSV" daria um arquivo para ele abrir, converter
 * e colar; o texto pronto para copiar entra direto no campo de busca do editor.
 * É o degrau mais baixo que resolve.
 */
export function PainelSelecao({
  galeriaId,
  total,
  limite,
  prazo,
  fechadaEm,
  aberta,
  motivo,
  lista,
}: {
  galeriaId: string;
  total: number;
  limite: number | null;
  prazo: string | null;
  fechadaEm: string | null;
  aberta: boolean;
  motivo: "fechada" | "prazo" | null;
  lista: { nome: string; capitulo: string | null }[];
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [mostrandoLista, setMostrandoLista] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const executar = (acao: (f: FormData) => Promise<{ erro?: string } | void>, campos: Record<string, string>) =>
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      for (const [k, v] of Object.entries(campos)) f.set(k, v);
      const r = await acao(f);
      setErro(r?.erro ?? null);
      router.refresh();
    });

  const texto = lista.map((l) => l.nome).join("\n");

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* Área de transferência bloqueada (http, permissão negada): a lista está
       * aberta na tela logo abaixo, então dá para selecionar à mão. Um alerta
       * aqui só assustaria por algo que tem saída óbvia. */
      setMostrandoLista(true);
    }
  };

  const dataBonita = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" }) : "";

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Escolha do álbum</h2>
          <p className="mt-0.5 text-xs text-texto-faint">
            O cliente marca as favoritas na própria galeria. A lista é uma só — o casal escolhe
            junto, de qualquer aparelho.
          </p>
        </div>

        <span
          className={`rounded-full border px-2.5 py-1 text-xs ${
            !aberta ? "border-ok/40 bg-ok/10 text-ok" : "border-linha text-texto-faint"
          }`}
        >
          {motivo === "fechada"
            ? "escolha encerrada"
            : motivo === "prazo"
              ? "prazo vencido"
              : "escolhendo"}
        </span>
      </div>

      {/* O número primeiro: é o que ele abre a tela para ver. */}
      <p className="mt-4 text-sm text-texto-soft">
        <strong className="text-texto">{total}</strong>{" "}
        {total === 1 ? "foto escolhida" : "fotos escolhidas"}
        {limite !== null && <> de {limite}</>}
        {motivo === "fechada" && fechadaEm && <> · encerrada em {dataBonita(fechadaEm)}</>}
      </p>

      {/*
        Só depois de encerrada é que a lista serve para editar: antes disso ela
        muda a cada clique do cliente, e copiar no meio da escolha leva um recorte
        que envelhece em minutos.
      */}
      {total > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copiar}
            className="rounded-lg border border-linha-forte px-3 py-1.5 text-sm transition hover:bg-carbon-2"
          >
            {copiado ? "copiado ✓" : "copiar os nomes dos arquivos"}
          </button>
          <button
            type="button"
            onClick={() => setMostrandoLista((v) => !v)}
            className="text-xs text-texto-faint underline-offset-2 hover:underline"
          >
            {mostrandoLista ? "esconder a lista" : "ver a lista"}
          </button>
          {aberta && (
            <span className="text-xs text-texto-faint">
              — o cliente ainda está escolhendo, a lista pode mudar
            </span>
          )}
        </div>
      )}

      {mostrandoLista && total > 0 && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-linha bg-void p-3 text-xs leading-relaxed text-texto-soft">
          {lista.map((l) => (l.capitulo ? `${l.nome}\t${l.capitulo}` : l.nome)).join("\n")}
        </pre>
      )}

      {/* Regras */}
      <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-linha pt-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-texto-soft">Quantas fotos o cliente escolhe</span>
          <input
            type="number"
            min={1}
            defaultValue={limite ?? ""}
            placeholder="sem limite"
            id="selecao-limite"
            disabled={ocupado}
            className="w-36 rounded-lg border border-linha bg-void px-3 py-1.5 text-sm focus:border-acento focus:outline-none disabled:opacity-50"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-texto-soft">Até quando</span>
          <input
            type="date"
            defaultValue={prazo ? prazo.slice(0, 10) : ""}
            id="selecao-prazo"
            disabled={ocupado}
            className="rounded-lg border border-linha bg-void px-3 py-1.5 text-sm focus:border-acento focus:outline-none disabled:opacity-50"
          />
        </label>

        <button
          type="button"
          disabled={ocupado}
          onClick={() => {
            const l = (document.getElementById("selecao-limite") as HTMLInputElement).value;
            const p = (document.getElementById("selecao-prazo") as HTMLInputElement).value;
            executar(salvarRegrasSelecaoAction, { limite: l, prazo: p });
          }}
          className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-40"
        >
          Salvar
        </button>

        {!aberta && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => executar(reabrirSelecaoAction, {})}
            className="rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-40"
          >
            Reabrir a escolha
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-texto-faint">
        Deixe em branco para não limitar. O limite vale para a galeria inteira, não por pessoa —
        e baixar o limite nunca apaga escolha que já foi feita.
      </p>

      {erro && <p className="mt-3 text-sm text-erro">{erro}</p>}
    </section>
  );
}
