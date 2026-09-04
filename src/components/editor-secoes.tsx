"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  criarSecaoAction,
  criarCapitulosSugeridosAction,
  renomearSecaoAction,
  apagarSecaoAction,
  moverSecaoAction,
  moverSoltasAction,
} from "@/app/painel/actions";

export interface SecaoResumo {
  id: string;
  nome: string;
  total: number;
}

/**
 * Capítulos da galeria (Making Of, Cerimônia, Festa…).
 *
 * Apagar um capítulo NÃO apaga as fotos dele — elas voltam para "sem capítulo".
 * Isso é dito na tela, porque a dúvida aparece na hora de clicar.
 */
export function EditorSecoes({
  galeriaId,
  secoes,
  semCapitulo,
}: {
  galeriaId: string;
  secoes: SecaoResumo[];
  semCapitulo: number;
}) {
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [nomeEditado, setNomeEditado] = useState("");
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  /* Uma ação pode devolver `{ erro }` — hoje só a de criar, quando o nome já
   * existe. As outras devolvem void e caem no `?.erro` como undefined, então
   * nenhuma delas precisou mudar de assinatura por causa desta. */
  const executar = (
    acao: (f: FormData) => Promise<{ erro?: string } | void>,
    campos: Record<string, string>,
  ) =>
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      for (const [k, v] of Object.entries(campos)) f.set(k, v);
      const r = await acao(f);
      setErro(r?.erro ?? null);
      router.refresh();
    });

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <h2 className="text-sm font-semibold">Capítulos</h2>
      <p className="mt-0.5 text-xs text-texto-faint">
        Dividem a galeria em momentos. O cliente ganha um menu para pular direto ao que quer ver.
      </p>

      {secoes.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-linha-forte px-4 py-6 text-center">
          <p className="text-sm text-texto-soft">Nenhum capítulo ainda</p>
          <p className="mx-auto mt-1 max-w-[42ch] text-xs text-texto-faint">
            Sem capítulos, a galeria mostra tudo numa sequência só — o que também funciona bem.
          </p>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => executar(criarCapitulosSugeridosAction, {})}
            className="mt-4 rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-50"
          >
            Criar os capítulos de um casamento
          </button>
          <p className="mt-2 text-[11px] text-texto-faint">
            Making Of · Cerimônia · Decoração · Recepção · Festa · Ensaio
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-linha rounded-lg border border-linha">
          {secoes.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              {editando === s.id ? (
                <>
                  <input
                    value={nomeEditado}
                    onChange={(e) => setNomeEditado(e.target.value)}
                    autoFocus
                    className="min-w-0 flex-1 rounded-md border border-linha bg-void px-2 py-1 text-sm focus:border-acento focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => {
                      executar(renomearSecaoAction, { secao_id: s.id, nome: nomeEditado });
                      setEditando(null);
                    }}
                    className="rounded-md bg-acento px-3 py-1 text-xs font-semibold text-void"
                  >
                    ok
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditando(null)}
                    className="rounded-md border border-linha px-3 py-1 text-xs text-texto-soft"
                  >
                    cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.nome}</span>
                    <span className="text-[11px] text-texto-faint">
                      {s.total} {s.total === 1 ? "foto" : "fotos"}
                    </span>
                  </span>

                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={ocupado || i === 0}
                      onClick={() => executar(moverSecaoAction, { secao_id: s.id, direcao: "cima" })}
                      aria-label={`Mover ${s.nome} para cima`}
                      className="rounded-md border border-linha px-2 py-1 text-xs text-texto-soft transition hover:bg-carbon-2 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={ocupado || i === secoes.length - 1}
                      onClick={() => executar(moverSecaoAction, { secao_id: s.id, direcao: "baixo" })}
                      aria-label={`Mover ${s.nome} para baixo`}
                      className="rounded-md border border-linha px-2 py-1 text-xs text-texto-soft transition hover:bg-carbon-2 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => {
                        setEditando(s.id);
                        setNomeEditado(s.nome);
                      }}
                      className="rounded-md border border-linha px-2 py-1 text-xs text-texto-soft transition hover:bg-carbon-2"
                    >
                      renomear
                    </button>
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => {
                        const aviso =
                          s.total > 0
                            ? `Apagar o capítulo “${s.nome}”?\n\nAs ${s.total} fotos NÃO são apagadas — elas voltam para "sem capítulo".`
                            : `Apagar o capítulo “${s.nome}”?`;
                        if (confirm(aviso)) executar(apagarSecaoAction, { secao_id: s.id });
                      }}
                      className="rounded-md border border-erro/40 px-2 py-1 text-xs text-erro transition hover:bg-erro/10"
                    >
                      apagar
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}

          {semCapitulo > 0 && (
            <li className="flex flex-wrap items-center gap-2 bg-carbon-2/50 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-texto-soft">Sem capítulo</span>
                <span className="text-[11px] text-texto-faint">
                  {semCapitulo} {semCapitulo === 1 ? "foto aparece" : "fotos aparecem"} como{" "}
                  <strong className="font-normal text-texto-soft">Outras fotos</strong>, antes dos
                  capítulos
                </span>
              </span>
              {/*
                MOVER TODAS DE UMA VEZ — pedido do sócio em 04/09/2026: "as
                fotos sem capítulo devem ir obrigatoriamente para um capítulo".

                Obrigar no ENVIO seria atrito no pior momento: quem está subindo
                600 fotos não quer responder pergunta. Um botão que arruma
                depois entrega o mesmo resultado e não cobra nada de quem não se
                importa — e quem não clicar não fica com pastilha sem nome na
                galeria, porque o grupo agora se chama "Outras fotos".
              */}
              <select
                aria-label={`Mover as ${semCapitulo} fotos sem capítulo`}
                disabled={ocupado}
                value=""
                onChange={(e) => {
                  if (e.target.value) executar(moverSoltasAction, { secao_id: e.target.value });
                }}
                className="rounded-lg border border-linha bg-void px-2 py-1 text-xs text-texto-soft focus:border-acento focus:outline-none disabled:opacity-50"
              >
                <option value="">mover todas para…</option>
                {secoes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </li>
          )}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && novo.trim()) {
              executar(criarSecaoAction, { nome: novo });
              setNovo("");
            }
          }}
          placeholder="Novo capítulo…"
          maxLength={60}
          className="min-w-0 flex-1 rounded-lg border border-linha bg-void px-3 py-2 text-sm placeholder:text-exemplo focus:border-acento focus:outline-none"
        />
        <button
          type="button"
          disabled={ocupado || !novo.trim()}
          onClick={() => {
            executar(criarSecaoAction, { nome: novo });
            setNovo("");
          }}
          className="rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-40"
        >
          Adicionar
        </button>
      </div>

      {/* Logo abaixo do campo, que é onde o olho está depois de clicar. */}
      {erro && (
        <p role="alert" className="mt-2 text-xs text-alerta">
          {erro}
        </p>
      )}
    </section>
  );
}
