"use client";

import { useMemo, useRef, useState, useTransition } from "react";
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
  /** De onde a galeria veio, quando não nasceu no painel — migração 039.
   *  `"atomatiza"` é a criada a partir de um contrato, pela chave de API. */
  origem: string | null;
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
 * ── POR QUE A BUSCA É NO CLIENTE ──────────────────────────────────────────
 *
 * A lista inteira já vem do servidor: um fotógrafo tem dezenas de galerias, não
 * milhares, e a página já as carrega todas para desenhar. Filtrar no servidor
 * seria uma ida e volta por tecla digitada para reordenar um array que já está
 * na memória. Se um dia a lista passar de umas centenas, isto vira paginação no
 * servidor — e aí a busca vai junto.
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
export function ListaGalerias({ galerias }: { galerias: GaleriaDaLista[] }) {
  /* O clique fora fecha o menu de três pontos. Ver `fechar-menu-client.ts`:
     era o mesmo efeito que a barra da galeria já tinha, e esta lista não. */
  const lista = useRef<HTMLDivElement | null>(null);
  useFecharMenuAoClicarFora(lista);
  const [busca, setBusca] = useState("");
  const [apagando, setApagando] = useState<string | null>(null);
  const [digitado, setDigitado] = useState("");
  const [copiada, setCopiada] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const router = useRouter();

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return galerias;
    /* Título, subtítulo e endereço: são os três jeitos de a pessoa lembrar de
       uma galeria — o nome do casal, o local, ou o link que ela mandou. */
    return galerias.filter((g) =>
      [g.titulo, g.subtitulo ?? "", g.slug, g.dataFormatada ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(termo),
    );
  }, [galerias, busca]);

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
      */}
      {galerias.length > 1 && (
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

      <ul className="mt-4 grid gap-3">
        {filtradas.map((g) => (
          <li
            key={g.id}
            className="rounded-xl border border-linha bg-carbon transition hover:border-linha-forte"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
              <Link href={`/painel/galerias/${g.id}`} className="min-w-0 flex-1 group">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium group-hover:text-acento">{g.titulo}</span>
                  <Etiqueta galeria={g} />
                  {/* Procedência, não estado — por isso fica ao lado da
                    * `Etiqueta` e não dentro dela: aquela diz em que pé a
                    * entrega está (rascunho, no ar, no cofre), esta diz de onde
                    * a galeria veio. Só aparece quando veio de fora, e para
                    * quem usa os dois produtos é o que explica uma galeria que
                    * ele não lembra de ter criado. */}
                  {g.origem === "atomatiza" && (
                    <span
                      title="Criada pelo Atomatiza, a partir de um contrato"
                      className="rounded-full border border-linha px-2 py-0.5 text-[11px] text-texto-faint"
                    >
                      do contrato
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-texto-faint">
                  {[g.dataFormatada, g.subtitulo].filter(Boolean).join(" · ") || "sem data"}
                </span>
              </Link>

              <span className="text-right text-xs tabular-nums text-texto-soft">
                <span className="block">
                  {g.arquivos} {g.arquivos === 1 ? "arquivo" : "arquivos"}
                </span>
                <span className="block text-texto-faint">{g.tamanho}</span>
              </span>

              <details className="relative">
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

            {/*
              A CONFIRMAÇÃO É DIGITADA, e é a mesma da Conta.

              Aqui as galerias estão empilhadas e os alvos ficam a poucos pixels
              uns dos outros; um `confirm()` seria um "OK" que a mão dá sozinha,
              e o alvo do clique errado é a entrega de um casamento. No caso do
              Juan é literal: duas galerias chamadas "Paula & Bruno".

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

      {filtradas.length === 0 && (
        <p className="mt-6 text-center text-sm text-texto-faint">
          Nenhuma galeria com “{busca}”.
        </p>
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
