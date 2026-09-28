"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  criarSecaoAction,
  criarCapitulosSugeridosAction,
  renomearSecaoAction,
  apagarSecaoAction,
  moverSecaoAction,
  reordenarSecoesAction,
  moverSoltasAction,
  esvaziarSecaoAction,
  ordenarFotosDaSecaoAction,
} from "@/app/painel/actions";
import { ORDENS_DAS_FOTOS } from "@/config/ordens-das-fotos";

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
  const [aviso, setAviso] = useState<string | null>(null);
  const router = useRouter();

  /*
   * ── ARRASTAR PARA REORDENAR (11/09/2026) ────────────────────────────────
   *
   * Carol: "tem que clicar na flechinha e ir subindo um por um. Quero subir a
   * pasta da festa lá pra cima". Com sete capítulos isso eram seis cliques e
   * seis recarregamentos.
   *
   * `ordem` é a lista DESENHADA. Durante o arrasto ela é reordenada a cada
   * item que o cursor cruza, então a linha acompanha o dedo em vez de saltar
   * no fim; ao soltar, ela vai inteira para o servidor. Enquanto for `null`,
   * quem manda é a lista que veio do servidor — é o que faz a tela voltar
   * sozinha ao certo depois do `router.refresh()`.
   *
   * As SETAS FICAM. `draggable` do HTML não existe no toque, e elas também são
   * o caminho de quem usa teclado; trocá-las por arrastar tiraria de uns para
   * dar a outros.
   */
  const [ordem, setOrdem] = useState<string[] | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);

  const lista = ordem
    ? (ordem.map((id) => secoes.find((s) => s.id === id)).filter(Boolean) as SecaoResumo[])
    : secoes;

  function aoCruzar(alvoId: string) {
    if (!arrastando || arrastando === alvoId) return;
    const atual = (ordem ?? secoes.map((s) => s.id)).slice();
    const de = atual.indexOf(arrastando);
    const para = atual.indexOf(alvoId);
    if (de < 0 || para < 0) return;
    atual.splice(para, 0, ...atual.splice(de, 1));
    setOrdem(atual);
  }

  function aoSoltar() {
    setArrastando(null);
    if (!ordem) return;
    /* Mesma ordem de antes: não vale uma ida ao servidor. */
    if (ordem.join() === secoes.map((s) => s.id).join()) return setOrdem(null);
    /*
     * `ordem` vale até a lista do servidor chegar — zerar antes faria a linha
     * piscar de volta ao lugar antigo. Zerar DEPOIS não é detalhe: enquanto ela
     * existir, é ela que a tela desenha, e as setas passam a mexer no banco sem
     * mudar nada na frente de quem clica. Foi o que aconteceu aqui antes de
     * este `aoTerminar` existir.
     */
    executar(reordenarSecoesAction, { ordem: ordem.join(",") }, () => setOrdem(null));
  }

  /* Uma ação pode devolver `{ erro }` — hoje só a de criar, quando o nome já
   * existe. As outras devolvem void e caem no `?.erro` como undefined, então
   * nenhuma delas precisou mudar de assinatura por causa desta. */
  const executar = (
    /* `aviso` entrou em 16/09/2026 com a ordenação: a ação dá certo e ainda
       tem um recado (quantas fotos não tinham data da câmera). É diferente de
       `erro`, que é a ação não ter acontecido. */
    acao: (f: FormData) => Promise<{ erro?: string; aviso?: string } | void>,
    campos: Record<string, string>,
    /* Roda DEPOIS do `router.refresh()`. Existe por causa do arrasto: a lista
       desenhada à mão precisa ser descartada quando a do servidor chega, e só
       aqui dá para saber que ela já chegou. */
    aoTerminar?: () => void,
  ) =>
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      for (const [k, v] of Object.entries(campos)) f.set(k, v);
      const r = await acao(f);
      setErro(r?.erro ?? null);
      /* `aviso` não é erro: a ordenação FUNCIONOU, e o recado é sobre o que ela
         não pôde saber (foto sem data da câmera). Ver `ordenarFotosDaSecaoAction`. */
      setAviso(r?.aviso ?? null);
      router.refresh();
      aoTerminar?.();
    });

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <h2 className="text-sm font-semibold">Capítulos</h2>
      <p className="mt-0.5 text-xs text-texto-faint">
        Dividem a galeria em momentos. O cliente ganha um menu para pular direto ao que quer ver.
      </p>

      {secoes.length === 0 ? (
        /*
         * BORDA SÓLIDA, E FUNDO PRÓPRIO — a tracejada é da área de SOLTAR.
         *
         * Felipe, 16/09/2026: "essa parte dos capítulos ficou semelhante
         * visualmente com a área de 'arrastar fotos para cá'. Eu até tentei
         * jogar as fotos ali, mas vi que ali é a área dos capítulos."
         *
         * As duas caixas tinham exatamente as mesmas classes
         * (`border-dashed border-linha-forte`), e a tracejada é uma convenção
         * forte: em todo lugar da web ela quer dizer "arraste aqui". Aqui ela
         * não aceita nada — o arrasto some no vazio, sem erro e sem resposta.
         *
         * A regra que fica: TRACEJADA É EXCLUSIVA DE ALVO DE ARRASTO. Esta
         * caixa é um estado vazio, então ganha borda contínua e a superfície
         * um degrau acima do painel — lê-se como cartão, não como buraco.
         */
        <div className="mt-4 rounded-lg border border-linha bg-carbon-2 px-4 py-6 text-center">
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
          {lista.map((s, i) => (
            <li
              key={s.id}
              draggable={!ocupado && editando !== s.id}
              onDragStart={(e) => {
                setArrastando(s.id);
                setOrdem(lista.map((x) => x.id));
                /* Sem `setData` o Firefox não inicia o arrasto. */
                e.dataTransfer.setData("text/plain", s.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                aoCruzar(s.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                aoSoltar();
              }}
              onDragEnd={aoSoltar}
              className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${
                arrastando === s.id ? "opacity-40" : ""
              } ${editando === s.id ? "" : "cursor-grab active:cursor-grabbing"}`}
            >
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
                  {/* O punho não é o que arrasta — a linha inteira é. Ele está
                      aqui para DIZER que dá, que é o que faltava na tela da
                      Carol: nada indicava que a linha podia ser pegada. */}
                  <span
                    aria-hidden="true"
                    className="select-none text-texto-faint"
                    title="Arraste para reordenar"
                  >
                    ⠿
                  </span>
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
                      disabled={ocupado || i === lista.length - 1}
                      onClick={() => executar(moverSecaoAction, { secao_id: s.id, direcao: "baixo" })}
                      aria-label={`Mover ${s.nome} para baixo`}
                      className="rounded-md border border-linha px-2 py-1 text-xs text-texto-soft transition hover:bg-carbon-2 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    {/*
                      ── ORDENAR AS FOTOS DO CAPÍTULO (16/09/2026) ──────────

                      Felipe: "poder organizar por ordem de upload/adição // por
                      ordem cronológica // por nome A-Z // por nome Z-A".

                      Um `select` e não quatro botões: são quatro opções
                      EXCLUSIVAS, e quatro botões numa linha que já tem cinco
                      controles viram parede. Volta para o rótulo depois de
                      agir, porque a ordem não é um estado que a linha carrega —
                      é uma ação que acabou de acontecer, e o resultado está na
                      grade logo abaixo.

                      Some com o capítulo vazio: ordenar zero fotos é um menu
                      que não faz nada.
                    */}
                    {s.total > 1 && (
                      <select
                        aria-label={`Ordenar as fotos de ${s.nome}`}
                        disabled={ocupado}
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          executar(ordenarFotosDaSecaoAction, {
                            secao_id: s.id,
                            criterio: e.target.value,
                          });
                          e.target.value = "";
                        }}
                        className="rounded-md border border-linha bg-void px-2 py-1 text-xs text-texto-soft transition hover:bg-carbon-2 disabled:opacity-50"
                      >
                        <option value="">ordenar…</option>
                        {ORDENS_DAS_FOTOS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.nome}
                          </option>
                        ))}
                      </select>
                    )}
                    {/*
                      O CAMINHO DE VOLTA (28/09/2026).

                      "Outras fotos" tem "mover todas para…" desde 04/09; o
                      capítulo não tinha como devolver. Quem mandou a pasta
                      errada no envio só desfazia foto a foto — ou APAGAVA o
                      capítulo, que é um botão vermelho com aviso de que não dá
                      para desfazer, para uma intenção que era só reorganizar.

                      Esvaziar não apaga o capítulo: ele fica ali, vazio, que é
                      justamente o estado de quem vai remontar a divisão.
                    */}
                    {s.total > 0 && (
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => {
                          const quantas = `${s.total} ${s.total === 1 ? "foto" : "fotos"}`;
                          if (
                            confirm(
                              `Tirar as ${quantas} de “${s.nome}”?\n\n` +
                                `Elas voltam para "Outras fotos". O capítulo continua, vazio.`,
                            )
                          ) {
                            executar(esvaziarSecaoAction, { secao_id: s.id });
                          }
                        }}
                        className="rounded-md border border-linha px-2 py-1 text-xs text-texto-soft transition hover:bg-carbon-2 disabled:opacity-50"
                      >
                        tirar as fotos
                      </button>
                    )}
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
      {/* O aviso da ordenação: a ação deu certo e tem um recado. Cor de alerta
          e não de erro, porque nada falhou — ver `ordenarFotosDaSecaoAction`. */}
      {aviso && (
        <p role="status" className="mt-3 text-xs text-alerta">
          {aviso}
        </p>
      )}
      {erro && (
        <p role="alert" className="mt-2 text-xs text-alerta">
          {erro}
        </p>
      )}
    </section>
  );
}
