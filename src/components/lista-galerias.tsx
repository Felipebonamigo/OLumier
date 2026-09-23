"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apagarGaleriaAction, salvarPublicacaoAction } from "@/app/painel/actions";
import { useFecharMenuAoClicarFora } from "@/lib/fechar-menu-client";

export interface GaleriaDaLista {
  id: string;
  titulo: string;
  subtitulo: string | null;
  slug: string;
  estudioSlug: string;
  publicada: boolean;
  estado: string;
  /** Dias até o cofre; `null` quando não há prazo. */
  diasAteCofre: number | null;
  dataFormatada: string | null;
  arquivos: number;
  tamanho: string;
}

/**
 * A lista de galerias do painel — com busca e atalhos.
 *
 * ── OS TRÊS PEDIDOS QUE ISTO ATENDE (05/09/2026) ──────────────────────────
 *
 * Juan, em sequência: "ter algum tipo de botão aqui, pois quero apagar a
 * galeria que fiz errada. Ter outro botão que seja atalho: copiar link, tirar
 * galeria do ar, etc. E adicionar também algum mecanismo de busca, para
 * pesquisar entre as galerias".
 *
 * O contexto explica os três de uma vez: ele tinha três galerias e DUAS se
 * chamavam "Paula & Bruno" — a certa e a errada. Cada ação que ele queria
 * exigia abrir a galeria, e abrir a galeria era justamente o que ele não
 * conseguia decidir.
 *
 * ── CARTÕES EM GRADE, E NÃO LINHAS LARGAS (23/09/2026) ────────────────────
 *
 * Felipe, com a foto do painel numa tela grande: "como fica quando ficar
 * muitas galerias? a lista aqui. E no sistema também, parece que nao
 * aproveitamos a tela toda quando é desktop".
 *
 * Ele tinha razão nas duas metades. Medido antes desta mudança: numa tela de
 * 1920 o conteúdo ocupava 1024 px — 47% da largura era margem vazia (29% em
 * 1440). E cada galeria era uma linha que atravessava a tela inteira para
 * carregar um título, uma data e dois números: quanto mais larga a tela, mais
 * vazio entre o nome e a contagem de arquivos, e menos galerias cabiam de uma
 * olhada.
 *
 * Em cartões, a largura vira galerias por tela em vez de espaço entre colunas:
 * uma coluna no celular, duas a partir de `sm`, três a partir de `xl`. É a
 * grade que precisa de espaço para crescer — por isso o painel foi para
 * `max-w-7xl` junto.
 *
 * ── O MENU É UM <details>, E NÃO UM POPOVER ───────────────────────────────
 *
 * Abre com teclado, anda com Tab, é lido certo por leitor de tela e não precisa
 * de biblioteca nenhuma.
 *
 * O que ele não traz de fábrica é o descarte leve, e até 16/09/2026 esta lista
 * ficou sem: Felipe, com a foto do menu aberto, "aqui ao clicar fora disso,
 * deveria fechar esse pop-up". A barra da galeria já fechava — o efeito existia
 * num arquivo só. Agora ele mora em `lib/fechar-menu-client.ts` e serve aos
 * dois, que é o que impede o terceiro menu de nascer sem.
 */
export function ListaGalerias({
  galerias,
  busca: buscaAtual,
  pagina,
  paginas,
  total,
}: {
  galerias: GaleriaDaLista[];
  /** O termo que o SERVIDOR aplicou — ver `listarGalerias`. */
  busca: string;
  pagina: number;
  paginas: number;
  /** Quantas galerias casam com a busca, na conta inteira e não nesta tela. */
  total: number;
}) {
  /* O clique fora fecha o menu de três pontos. Ver `fechar-menu-client.ts`:
     era o mesmo efeito que a barra da galeria já tinha, e esta lista não. */
  const lista = useRef<HTMLDivElement | null>(null);
  useFecharMenuAoClicarFora(lista);
  const router = useRouter();
  const [enviando, iniciar] = useTransition();
  /*
   * ── A BUSCA FOI PARA O SERVIDOR (23/09/2026) ────────────────────────────
   *
   * Ela filtrava no navegador uma lista que chegava inteira. Com a tela de 24
   * isso esconderia a galeria que está na página 3 — o comentário que ficava
   * aqui já previa: "se um dia a lista passar de umas centenas, isto vira
   * paginação no servidor, e aí a busca vai junto".
   *
   * O campo continua respondendo a cada tecla; o que mudou é que a resposta vem
   * do banco. O `setTimeout` de 250 ms é o que impede uma consulta por tecla —
   * quem digita "Paula" dispara uma, não cinco. `replace` e não `push`: a busca
   * não é um lugar a que se volta com o botão do navegador, tecla por tecla.
   *
   * Buscar volta para a página 1 de propósito (o endereço sai sem `p`): quem
   * está na página 3 e digita um nome quer o resultado, não a terceira fatia
   * dele — que muitas vezes nem existe.
   */
  const [busca, setBusca] = useState(buscaAtual);
  const [buscando, aoBuscar] = useTransition();

  /*
   * O ENDEREÇO MANDA NO CAMPO — e o acerto é no DESENHO, não num efeito.
   *
   * O campo precisa seguir a URL: quem volta no navegador depois de buscar tem
   * de ver o termo anterior de volta, e não o que ficou digitado. Isso é o
   * padrão "ajustar estado quando uma prop muda" da documentação do React, e o
   * jeito certo é este — comparar com o que se viu da última vez, ali no meio
   * do desenho. Num `useEffect` o React desenharia a tela com o texto velho,
   * descobriria depois e desenharia de novo: um piscar, e o `eslint` reprova.
   */
  const [enderecoVisto, setEnderecoVisto] = useState(buscaAtual);
  if (buscaAtual !== enderecoVisto) {
    setEnderecoVisto(buscaAtual);
    setBusca(buscaAtual);
  }

  /* Só vai ao servidor quando o que está no campo DIVERGE do que o endereço já
     pediu — o que também elimina a consulta do primeiro desenho, quando os dois
     nascem iguais. */
  useEffect(() => {
    if (busca === buscaAtual) return;
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (busca.trim()) p.set("q", busca.trim());
      aoBuscar(() => router.replace(p.toString() ? `/painel?${p}` : "/painel", { scroll: false }));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, buscaAtual, router]);

  const [apagando, setApagando] = useState<string | null>(null);
  const [digitado, setDigitado] = useState("");
  const [copiada, setCopiada] = useState<string | null>(null);

  async function copiarLink(g: GaleriaDaLista) {
    const url = `${location.origin}/g/${g.estudioSlug}/${g.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiada(g.id);
      setTimeout(() => setCopiada((atual) => (atual === g.id ? null : atual)), 2000);
    } catch {
      /* Sem permissão de área de transferência (acontece em http sem TLS e em
         alguns navegadores embutidos): mostra o link para copiar à mão em vez
         de falhar em silêncio. */
      prompt("Copie o link:", url);
    }
  }

  function trocarPublicacao(g: GaleriaDaLista) {
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", g.id);
      f.set("publicada", g.publicada ? "0" : "1");
      await salvarPublicacaoAction(f);
      router.refresh();
    });
  }

  const alvo = galerias.find((g) => g.id === apagando) ?? null;
  const confere = alvo != null && digitado.trim() === alvo.titulo.trim();

  /* A busca viaja junto na paginação: sem isto, ir para a página 2 de uma
     busca devolveria a página 2 de TUDO — o fotógrafo veria galerias que não
     casam com o que ele digitou e concluiria, com razão, que a busca é
     mentirosa. */
  const enderecoDaPagina = (n: number) => {
    const p = new URLSearchParams();
    if (buscaAtual.trim()) p.set("q", buscaAtual.trim());
    if (n > 1) p.set("p", String(n));
    return p.toString() ? `/painel?${p}` : "/painel";
  };

  return (
    /* A `div` existe para o `ref`: o efeito de fechar menu precisa de um escopo,
       e sem ela a alternativa seria varrer o documento inteiro — o que fecharia
       junto qualquer `<details>` que este painel venha a usar como sanfona. */
    <div ref={lista}>
      {/*
        A busca aparece sempre que há mais de uma galeria.

        A tentação é escondê-la abaixo de um punhado — "com três galerias ela é
        mobília". O caso do Juan desmente: ele tinha TRÊS e duas se chamavam
        "Paula & Bruno". O que faz a busca valer não é a quantidade, é a
        semelhança entre os nomes, e fotógrafo repete nome de casal o tempo
        todo. Com uma galeria só não há o que buscar, e aí ela some.

        `busca` entra na conta porque agora quem filtra é o servidor: uma busca
        que sobra com um resultado só não pode fazer sumir o campo em que ela
        foi digitada — seria impossível apagar o termo.
      */}
      {(total > 1 || busca !== "") && (
        <div className="mt-6">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, local ou endereço…"
            aria-label="Buscar galerias"
            className="w-full rounded-lg border border-linha bg-carbon px-4 py-2.5 text-sm text-texto placeholder:text-texto-faint focus:border-acento focus:outline-none"
          />
        </div>
      )}

      {/*
        UMA COLUNA NO CELULAR, DUAS EM `sm`, TRÊS EM `xl`.

        Três e não quatro: com quatro colunas dentro de `max-w-7xl` cada cartão
        fica com ~300 px, e aí "Júlia & Gustavo — Casamento na Serra" quebra em
        três linhas. O cartão precisa caber o nome de um casal, que é o que o
        fotógrafo procura na tela.

        `items-start` impede que o cartão com a confirmação de apagar aberta
        estique os vizinhos da mesma linha da grade.
      */}
      <ul
        aria-busy={buscando}
        className={`mt-4 grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3 ${
          buscando ? "opacity-60 transition-opacity" : ""
        }`}
      >
        {galerias.map((g) => (
          <li
            key={g.id}
            /* `min-w-0`: item de grade nasce com `min-width: auto`, e aí ele se
               recusa a ficar menor que o conteúdo. Com o `truncate` da linha
               de baixo (que é `white-space: nowrap`) isso virou cartão de 418
               px numa tela de 390 — rolagem horizontal no celular, medida.
               Truncar SEM isto não trunca: empurra. */
            className="flex min-w-0 flex-col rounded-xl border border-linha bg-carbon transition hover:border-linha-forte"
          >
            <div className="flex items-start gap-3 px-5 pt-4">
              {/* `line-clamp-2` no nome e `truncate` na linha de baixo: sem os
                  dois, um nome de casal com o local junto ("Vinícola Casa
                  Valduga, Bento Gonçalves") faz UM cartão ficar mais alto que
                  os vizinhos da mesma linha, e a grade sai com a régua de baixo
                  desencontrada. O título ainda pode ter 120 caracteres — o
                  limite do campo —, e duas linhas é onde ele para. */}
              <Link href={`/painel/galerias/${g.id}`} className="group min-w-0 flex-1">
                <span className="line-clamp-2 block font-medium leading-snug group-hover:text-acento">
                  {g.titulo}
                </span>
                <span
                  className="mt-1 block truncate text-xs text-texto-faint"
                  title={[g.dataFormatada, g.subtitulo].filter(Boolean).join(" · ")}
                >
                  {[g.dataFormatada, g.subtitulo].filter(Boolean).join(" · ") || "sem data"}
                </span>
              </Link>

              <details className="relative -mt-1 shrink-0">
                <summary
                  aria-label={`Ações de ${g.titulo}`}
                  className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-lg border border-linha text-texto-soft transition hover:border-acento hover:bg-acento/5 hover:text-texto [&::-webkit-details-marker]:hidden"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </summary>
                <div className="absolute right-0 z-20 mt-1 flex w-52 flex-col rounded-lg border border-linha bg-carbon-2 p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => copiarLink(g)}
                    className="rounded-md px-3 py-2 text-left text-xs text-texto-soft transition hover:bg-acento/10 hover:text-texto"
                  >
                    {copiada === g.id ? "link copiado ✓" : "Copiar link"}
                  </button>
                  <a
                    href={`/g/${g.estudioSlug}/${g.slug}?previa=1`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md px-3 py-2 text-left text-xs text-texto-soft transition hover:bg-acento/10 hover:text-texto"
                  >
                    Ver como o cliente vê
                  </a>
                  <button
                    type="button"
                    onClick={() => trocarPublicacao(g)}
                    disabled={enviando}
                    className="rounded-md px-3 py-2 text-left text-xs text-texto-soft transition hover:bg-acento/10 hover:text-texto disabled:opacity-50"
                  >
                    {g.publicada ? "Tirar do ar" : "Publicar"}
                  </button>
                  <Link
                    href={`/painel/galerias/${g.id}/entrega`}
                    className="rounded-md px-3 py-2 text-left text-xs text-texto-soft transition hover:bg-acento/10 hover:text-texto"
                  >
                    Link, senha e prazo
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setApagando(g.id);
                      setDigitado("");
                    }}
                    className="mt-0.5 rounded-md border-t border-linha px-3 py-2 text-left text-xs text-erro transition hover:bg-erro/10"
                  >
                    Apagar
                  </button>
                </div>
              </details>
            </div>

            {/* O rodapé do cartão: etiqueta de um lado, o peso da entrega do
                outro. `mt-auto` gruda no fundo para que os cartões de uma
                mesma linha alinhem a régua de baixo mesmo com títulos de
                alturas diferentes. */}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 px-5 pb-4 pt-3">
              <Etiqueta galeria={g} />
              <span className="text-xs tabular-nums text-texto-soft">
                {g.arquivos} {g.arquivos === 1 ? "arquivo" : "arquivos"}
                <span className="text-texto-faint"> · {g.tamanho}</span>
              </span>
            </div>

            {/*
              A CONFIRMAÇÃO É DIGITADA, e é a mesma da Conta.

              Aqui as galerias estão lado a lado e os alvos ficam a poucos
              pixels uns dos outros; um `confirm()` seria um "OK" que a mão dá
              sozinha, e o alvo do clique errado é a entrega de um casamento. No
              caso do Juan é literal: duas galerias chamadas "Paula & Bruno".

              Vai para a LIXEIRA, onde fica 30 dias — e o texto diz isso, porque
              aviso mais assustador que a verdade ensina a ignorar avisos.
            */}
            {apagando === g.id && (
              <div className="mx-5 mb-4 rounded-lg border border-erro/40 bg-erro/5 p-3">
                <p className="text-xs leading-relaxed text-texto-soft">
                  Vai para a lixeira, onde fica 30 dias. Para confirmar, digite o nome da galeria:{" "}
                  <strong className="text-texto">{g.titulo}</strong>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={digitado}
                    onChange={(e) => setDigitado(e.target.value)}
                    aria-label={`Digite ${g.titulo} para confirmar`}
                    className="min-w-0 flex-1 rounded-lg border border-linha bg-carbon px-3 py-2 text-sm text-texto focus:border-erro focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!confere || enviando}
                    onClick={() =>
                      iniciar(async () => {
                        const f = new FormData();
                        f.set("galeria_id", g.id);
                        await apagarGaleriaAction(f);
                        setApagando(null);
                        setDigitado("");
                        router.refresh();
                      })
                    }
                    className="rounded-lg border border-erro/40 px-3 py-2 text-sm text-erro transition hover:bg-erro/10 disabled:opacity-40"
                  >
                    {enviando ? "Apagando…" : "Apagar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setApagando(null)}
                    className="text-xs text-texto-faint underline underline-offset-4 hover:text-texto"
                  >
                    cancelar
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {total === 0 && busca !== "" && (
        <p className="mt-6 text-center text-sm text-texto-faint">
          Nenhuma galeria com “{busca}”.
        </p>
      )}

      {/*
        ── A PAGINAÇÃO É DE LINKS, E NÃO DE BOTÕES ─────────────────────────
        Página é um lugar: o `p=3` no endereço é o que faz o "olha na página 3"
        mandado para o sócio funcionar, o voltar do navegador voltar uma página
        de verdade, e a tela continuar a mesma depois de publicar uma galeria e
        o `router.refresh()` acontecer. Botão com estado no componente não faz
        nenhuma das três.

        Anterior/Próxima e não a régua de números: 24 por tela dá 7 páginas para
        os 168 casamentos que um estúdio movimentado entrega num ano. Quem
        precisa de mais alcance que isso está procurando um nome — e para
        procurar nome existe a busca, que é uma linha acima.
      */}
      {paginas > 1 && (
        <nav
          aria-label="Páginas de galerias"
          className="mt-6 flex items-center justify-center gap-3 text-sm"
        >
          {pagina > 1 ? (
            <Link
              href={enderecoDaPagina(pagina - 1)}
              rel="prev"
              className="rounded-lg border border-linha px-3 py-2 text-texto-soft transition hover:border-acento hover:text-texto"
            >
              ← Anterior
            </Link>
          ) : (
            <span className="rounded-lg border border-linha px-3 py-2 text-texto-faint opacity-40">
              ← Anterior
            </span>
          )}

          <span className="tabular-nums text-texto-faint">
            Página {pagina} de {paginas}
          </span>

          {pagina < paginas ? (
            <Link
              href={enderecoDaPagina(pagina + 1)}
              rel="next"
              className="rounded-lg border border-linha px-3 py-2 text-texto-soft transition hover:border-acento hover:text-texto"
            >
              Próxima →
            </Link>
          ) : (
            <span className="rounded-lg border border-linha px-3 py-2 text-texto-faint opacity-40">
              Próxima →
            </span>
          )}
        </nav>
      )}
    </div>
  );
}

function Etiqueta({ galeria }: { galeria: GaleriaDaLista }) {
  if (galeria.estado === "arquivada") {
    return (
      <span className="rounded-full border border-linha px-2 py-0.5 text-[11px] text-texto-faint">
        no cofre
      </span>
    );
  }

  // Avisa antes de vencer: descobrir que a galeria saiu do ar pelo cliente
  // reclamando seria o pior jeito de saber.
  const dias = galeria.diasAteCofre;
  if (dias !== null && dias <= 30) {
    return (
      <span className="rounded-full border border-alerta/40 bg-alerta/10 px-2 py-0.5 text-[11px] text-alerta">
        {dias > 0 ? `cofre em ${dias}d` : "vence hoje"}
      </span>
    );
  }
  return galeria.publicada ? (
    <span className="rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] text-ok">
      publicada
    </span>
  ) : (
    <span className="rounded-full border border-linha px-2 py-0.5 text-[11px] text-texto-faint">
      rascunho
    </span>
  );
}
