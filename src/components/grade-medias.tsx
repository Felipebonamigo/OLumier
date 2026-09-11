"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { definirCapaAction, moverMediasAction } from "@/app/painel/actions";

export interface MediaExibida {
  id: string;
  nome: string;
  tipo: "foto" | "video";
  url: string;
  bytes: number;
  secaoId: string | null;
  /** Quantas pessoas marcaram esta foto como favorita. 0 = ninguém. */
  favoritas?: number;
}

export interface SecaoOpcao {
  id: string;
  nome: string;
}

const formatar = (b: number) => {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
};

export function GradeMedias({
  medias,
  galeriaId,
  capaId,
  secoes,
}: {
  medias: MediaExibida[];
  galeriaId: string;
  capaId: string | null;
  secoes: SecaoOpcao[];
}) {
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [definindoCapa, setDefinindoCapa] = useState<string | null>(null);
  const [apagandoTudo, setApagandoTudo] = useState(false);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  /* Aberta por padrão: quem acabou de subir quer VER o que subiu. Recolher é
   * para depois, quando a grade vira obstáculo entre a pessoa e o resto da
   * página. */
  const [aberta, setAberta] = useState(true);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const alternarSelecao = (id: string) =>
    setSelecao((s) => {
      const nova = new Set(s);
      if (nova.has(id)) nova.delete(id);
      else nova.add(id);
      return nova;
    });

  function moverPara(secaoId: string) {
    const ids = [...selecao];
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_ids", ids.join(","));
      // A action trata vazio como "tirar do capítulo".
      f.set("secao_id", secaoId === "__nenhum" ? "" : secaoId);
      await moverMediasAction(f);
      setSelecao(new Set());
      router.refresh();
    });
  }

  async function definirCapa(m: MediaExibida) {
    setDefinindoCapa(m.id);
    try {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_id", m.id);
      await definirCapaAction(f);
      router.refresh();
    } finally {
      setDefinindoCapa(null);
    }
  }

  async function apagarTodas() {
    const resposta = prompt(
      `Apagar TODAS as ${medias.length} fotos desta galeria? Não dá para desfazer.\n\n` +
        `Para confirmar, digite ${medias.length}:`,
    );
    if (resposta?.trim() !== String(medias.length)) return;
    setApagandoTudo(true);
    try {
      const r = await fetch(`/api/galerias/${galeriaId}/medias`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      setSelecao(new Set());
      router.refresh();
    } catch {
      alert("Não foi possível apagar agora. Tente de novo.");
    } finally {
      setApagandoTudo(false);
    }
  }

  async function remover(m: MediaExibida) {
    if (!confirm(`Remover “${m.nome}”? Não dá para desfazer.`)) return;
    setRemovendo(m.id);
    try {
      const r = await fetch(`/api/medias/${m.id}/confirmar`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      router.refresh();
    } catch {
      alert("Não foi possível remover agora. Tente de novo.");
    } finally {
      setRemovendo(null);
    }
  }

  if (medias.length === 0) return null;

  const nomeSecao = (id: string | null) =>
    id ? (secoes.find((s) => s.id === id)?.nome ?? null) : null;

  return (
    <section className="mt-8">
      {/*
        RECOLHER EXISTE POR CAUSA DO TAMANHO REAL.

        Um casamento são 192 fotos, medido em 27/08/2026. Aberta, a grade empurra
        para baixo tudo o que vem depois — capítulos, aparência, publicar — e a
        pessoa rola centenas de miniaturas para chegar ao próximo passo. Recolher
        devolve a página; o número no título continua dizendo o que está guardado.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/*
          O ALVO É O BOTÃO INTEIRO, e a seta agora tem tamanho de seta.

          Juan, 05/09/2026: "deixar maior esse tiquinho que faz minimizar ou
          maximizar a pasta das fotos". Era um `▾` de 12 px dentro de um botão
          sem moldura — o alvo existia, mas nada dizia que existia, e mirar num
          caractere de 12 px com o mouse é o que ele estava fazendo.

          Agora é uma pastilha com borda: a seta cresceu para 20 px, ganhou
          rotação em vez de trocar de caractere (o `▸` e o `▾` têm larguras
          diferentes e o texto pulava ao abrir), e o alvo tem 40 px de altura —
          o mínimo confortável para o dedo, no celular também.
        */}
        <button
          type="button"
          onClick={() => setAberta((v) => !v)}
          aria-expanded={aberta}
          className="flex items-center gap-2 rounded-lg border border-linha px-3 py-2 text-sm font-semibold transition hover:border-linha-forte hover:bg-carbon-2"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-texto-faint transition-transform ${aberta ? "rotate-90" : ""}`}
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
          {medias.length} {medias.length === 1 ? "arquivo" : "arquivos"}
          <span className="text-xs font-normal text-texto-faint">
            {aberta ? "recolher" : "abrir"}
          </span>
        </button>

        {aberta && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelecao(new Set(medias.map((m) => m.id)))}
              className="rounded-md border border-linha px-2.5 py-1 text-xs text-texto-soft transition hover:bg-carbon-2"
            >
              selecionar todas
            </button>
            <button
              type="button"
              onClick={() => setSelecao(new Set())}
              disabled={selecao.size === 0}
              className="rounded-md border border-linha px-2.5 py-1 text-xs text-texto-soft transition hover:bg-carbon-2 disabled:opacity-40"
            >
              limpar
            </button>
            {/*
              APAGAR TUDO — pedido do Juan no mesmo dia, e pela mesma razão do
              provedor de envio: o upload dele morreu na metade e ele quis
              recomeçar. Sem isto, recomeçar eram 519 cliques em "remover".

              A confirmação pede o NÚMERO digitado, e não um "ok": esta é a
              única ação do painel que apaga a entrega inteira de uma vez, e não
              tem lixeira. Digitar a contagem obriga a ler a contagem.
            */}
            <button
              type="button"
              onClick={apagarTodas}
              disabled={apagandoTudo}
              className="rounded-md border border-erro/40 px-2.5 py-1 text-xs text-erro transition hover:bg-erro/10 disabled:opacity-40"
            >
              {apagandoTudo ? "apagando…" : "apagar todas"}
            </button>
          </div>
        )}
      </div>

      {/*
        PARA QUE SERVE SELECIONAR — dito aqui, e não só quando já há seleção.

        Antes a frase só aparecia com `selecao.size === 0 && secoes.length > 0`:
        sumia assim que a pessoa selecionava algo, e nunca aparecia para quem
        ainda não tinha criado capítulo — ou seja, faltava exatamente para quem
        não sabia o que a seleção faz.
      */}
      {aberta && (
        <p className="mt-1.5 text-xs text-texto-faint">
          Selecionar serve para agir em várias de uma vez: mover para um capítulo, ou remover.
          Clique na foto (ou na bolinha) para marcar.
        </p>
      )}

      {/* Barra de ações em lote — só aparece com algo selecionado. */}
      {selecao.size > 0 && (
        <div className="sticky top-2 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-acento/40 bg-carbon-2 px-3 py-2.5 shadow-lg">
          <span className="text-sm font-medium">
            {selecao.size} {selecao.size === 1 ? "selecionada" : "selecionadas"}
          </span>

          <span className="ml-auto flex flex-wrap items-center gap-2">
            <label className="text-xs text-texto-soft" htmlFor="mover-para">
              mover para
            </label>
            <select
              id="mover-para"
              disabled={ocupado}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value !== "") moverPara(e.target.value);
                e.target.value = "";
              }}
              className="rounded-md border border-linha bg-void px-2 py-1.5 text-xs focus:border-acento focus:outline-none"
            >
              <option value="" disabled>
                escolha o capítulo…
              </option>
              {secoes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
              <option value="__nenhum">— sem capítulo —</option>
            </select>
          </span>
        </div>
      )}

      {aberta && (
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {medias.map((m) => {
          const selecionada = selecao.has(m.id);
          const capitulo = nomeSecao(m.secaoId);
          return (
            <li key={m.id} className="group relative">
              {/*
                A MOLDURA ACENDE SOB O PONTEIRO (pedido do Juan em 05/09/2026).

                "Senti falta de eu passar a seta aqui e a bordinha ficar
                piscando pra mim conforme eu vou passando a seta." Havia reação
                ao ponteiro — os botões capa/remover surgindo no canto —, mas em
                CIMA da foto, e não em volta dela: quem varre uma grade de 600
                fotos com o mouse não acompanha um botão de 11 px aparecendo,
                acompanha a moldura.

                `group-hover` e não `hover`: quem recebe o ponteiro é o ladrilho
                inteiro, então passar pelo nome do arquivo, embaixo da foto,
                também acende.

                Acende MENOS forte que a selecionada (a cor pela metade, sem
                anel): se os dois desenhassem a mesma borda, varrer a grade
                pareceria ir selecionando foto por foto. E o `hover` do Tailwind
                já vem dentro de `@media (hover: hover)`, então no celular nada
                fica preso aceso depois do toque — `testar-hover-da-grade.mjs`
                confere isso no CSS compilado, não na intenção.
              */}
              <div
                className={`aspect-[4/5] overflow-hidden rounded-lg border bg-carbon-2 transition ${
                  selecionada
                    ? "border-acento ring-2 ring-acento/40"
                    : "border-linha group-hover:border-acento/60"
                }`}
              >
                {m.tipo === "foto" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                  <img
                    src={m.url}
                    alt={m.nome}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <video src={m.url} className="h-full w-full object-cover" preload="metadata" controls />
                )}
              </div>

              {/*
                CLICAR NA FOTO SELECIONA.

                A bolinha de 24px era o único alvo, e num casamento de 192 fotos
                marcar cinquenta pela bolinha é um exercício de pontaria. A foto
                inteira é o alvo óbvio — é onde a mão vai.

                É uma camada por cima da imagem, e não um `onClick` no cartão:
                dentro dele há botões (capa, remover) e um vídeo com controles, e
                aninhar interativo dentro de interativo quebra teclado e leitor de
                tela. Esta camada fica ABAIXO deles no empilhamento, então cada um
                continua recebendo o próprio clique.

                Vídeo fica de fora: ali o clique é play, e roubá-lo para marcar
                faria o fotógrafo não conseguir assistir ao que subiu.
              */}
              {m.tipo === "foto" && (
                <button
                  type="button"
                  onClick={() => alternarSelecao(m.id)}
                  aria-label={`${selecionada ? "Desmarcar" : "Selecionar"} ${m.nome}`}
                  aria-pressed={selecionada}
                  className="absolute inset-x-0 top-0 aspect-[4/5] w-full cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-acento"
                />
              )}

              {/* Bolinha de seleção — sempre visível, para ficar óbvio que dá para selecionar. */}
              <button
                type="button"
                onClick={() => alternarSelecao(m.id)}
                aria-label={`${selecionada ? "Desmarcar" : "Selecionar"} ${m.nome}`}
                aria-pressed={selecionada}
                className={`absolute left-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border text-[11px] transition ${
                  selecionada
                    ? "border-acento bg-acento text-void"
                    : "border-linha-forte bg-void/70 text-transparent hover:text-texto-faint"
                }`}
              >
                ✓
              </button>

              {capaId === m.id && (
                <span className="absolute left-9 top-1.5 z-10 rounded-md bg-acento px-2 py-0.5 text-[10px] font-semibold text-void">
                  capa
                </span>
              )}

              {/*
                Marca do cliente, não do fotógrafo: ele não clica aqui, só lê.
                O número aparece a partir de 2 porque, com uma pessoa só, "♥ 1"
                em toda foto marcada vira ruído — o que importa ali é o coração.
                Com duas ou mais, o número é a informação: foto escolhida pelos
                dois é decisão tomada.
              */}
              {(m.favoritas ?? 0) > 0 && (
                <span
                  title={`${m.favoritas} ${m.favoritas === 1 ? "pessoa marcou" : "pessoas marcaram"} como favorita`}
                  className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-void/80 px-2 py-0.5 text-[11px] font-medium text-acento"
                >
                  ♥{(m.favoritas ?? 0) > 1 ? ` ${m.favoritas}` : ""}
                </span>
              )}

              <span className="absolute right-1.5 top-1.5 z-10 flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                {m.tipo === "foto" && capaId !== m.id && (
                  <button
                    type="button"
                    onClick={() => definirCapa(m)}
                    disabled={definindoCapa === m.id}
                    aria-label={`Usar ${m.nome} como capa`}
                    className="rounded-md bg-void/80 px-2 py-1 text-[11px] text-texto disabled:opacity-50"
                  >
                    {definindoCapa === m.id ? "…" : "capa"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remover(m)}
                  disabled={removendo === m.id}
                  aria-label={`Remover ${m.nome}`}
                  className="rounded-md bg-void/80 px-2 py-1 text-[11px] text-texto disabled:opacity-50"
                >
                  {removendo === m.id ? "…" : "remover"}
                </button>
              </span>

              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] text-texto-faint">
                  {capitulo ?? m.nome}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-texto-faint">
                  {formatar(m.bytes)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      )}
    </section>
  );
}
