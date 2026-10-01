"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import {
  definirCapaAction,
  definirCapaDaPastaAction,
  moverMediasAction,
  moverFotoAction,
  moverFotosAction,
} from "@/app/painel/actions";
import { depoisDoClique } from "@/lib/trecho-selecionado";
import { moverBloco, type DestinoDoBloco } from "@/lib/ordem-em-bloco";
import {
  chaveDaMiniatura,
  guardarMiniatura,
  lerMiniatura,
  observarMiniatura,
  ouvirMiniatura,
  pedirMiniatura,
  type EnderecoDaMiniatura,
} from "@/lib/miniaturas-do-painel";
import {
  ESTADO_INICIAL,
  ID_DA_GRADE,
  copiasRepetidas,
  lerEstadoDaGrade,
  mudarEstadoDaGrade,
  ouvirEstadoDaGrade,
} from "@/lib/filtro-da-grade";

export interface MediaExibida {
  id: string;
  nome: string;
  tipo: "foto" | "video";
  /**
   * A miniatura assinada — só nos ladrilhos da primeira tela. Os outros pedem
   * o endereço quando chegam perto da tela: `lib/miniaturas-do-painel.ts`.
   */
  url?: string;
  /** O endereço do FILME. Só em vídeo — ver o comentário na aba Fotos. */
  urlFilme?: string;
  /** Muda quando o arquivo é republicado na mesma chave. */
  versao: number;
  /** Há miniatura de verdade? Sem ela o `poster` não pode ser desenhado. */
  temCapa?: boolean;
  bytes: number;
  secaoId: string | null;
  /** Quantas pessoas marcaram esta foto como favorita. 0 = ninguém. */
  favoritas?: number;
  /** Quantas vezes o cliente baixou ESTA foto. Ver `downloadsPorFoto`. */
  baixadas?: number;
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
  capasDasPastas = {},
  mostrarCapaDaPasta = false,
}: {
  /** A conta usa Pastas? Sem isso o botão "capa da pasta" não aparece. */
  mostrarCapaDaPasta?: boolean;
  medias: MediaExibida[];
  galeriaId: string;
  capaId: string | null;
  secoes: SecaoOpcao[];
  /** Capítulo → foto de frente da pasta, só onde o fotógrafo escolheu. */
  capasDasPastas?: Record<string, string>;
}) {
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [definindoCapa, setDefinindoCapa] = useState<string | null>(null);
  const [apagandoTudo, setApagandoTudo] = useState(false);
  const [apagandoSelecao, setApagandoSelecao] = useState(false);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  /* Aberta por padrão: quem acabou de subir quer VER o que subiu. Recolher é
   * para depois, quando a grade vira obstáculo entre a pessoa e o resto da
   * página. Mora em `lib/filtro-da-grade.ts` junto do recorte, porque o "ver
   * as fotos" de um capítulo, lá na lista, precisa abrir a grade. */
  const ouvirGrade = useCallback((avisar: () => void) => ouvirEstadoDaGrade(galeriaId, avisar), [galeriaId]);
  const { filtro: filtroPedido, aberta } = useSyncExternalStore(
    ouvirGrade,
    () => lerEstadoDaGrade(galeriaId),
    () => ESTADO_INICIAL,
  );
  const [busca, setBusca] = useState("");
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  /*
    ── SHIFT PARA MARCAR UM TRECHO INTEIRO (25/09/2026) ────────────────────

    Juan: "adicionar a função de selecionar várias através do comando 'segurar
    shift ou alt', como é padrão na movimentação de arquivos. Clica em uma,
    segura shift, clica em outra. E todas entre elas serem selecionadas."

    A REGRA mora em `lib/trecho-selecionado.ts`, e não aqui, porque nenhum
    teste desta casa abre navegador: dentro do `onClick` ela seria intestável.
    Lá também está por que a âncora não anda e por que `alt` ficou de fora.

    Aqui fica só o que é de tela: a âncora atravessa cliques num `ref` (mudá-la
    não redesenha nada), e a ordem dos ids é a da GRADE, que é o que define o
    "entre elas" — reordenar a galeria muda o trecho, e tem de mudar.
  */
  const ancora = useRef<string | null>(null);

  /*
   * ── O RECORTE: UM CAPÍTULO, AS REPETIDAS, UM NOME (01/10/2026) ───────────
   *
   * Juan, com 4.000 fotos em 15 capítulos: "Subi 200 fotos em um capítulo X.
   * Mas, 6 fotos repetiram, quero remover elas. Impossível eu achar (…). Eu não
   * consigo ver apenas as fotos que estão dentro do capítulo X." O aviso de
   * repetidas lá em cima mandava "marcar a cópia extra na grade abaixo" — numa
   * grade de 4.000, a mesma agulha no mesmo palheiro.
   *
   * A grade mostra um recorte por vez. Repetida é mesmo nome E mesmo tamanho
   * (`copiasRepetidas`); nessa visão elas vêm lado a lado, pelo nome, e um
   * botão marca as cópias extras — a "apagar selecionadas" de sempre resolve.
   *
   * Capítulo que sumiu (apagado em outra aba) e repetidas já resolvidas voltam
   * para "todas": recorte vazio por motivo velho parece galeria vazia.
   */
  const copias = useMemo(() => copiasRepetidas(medias), [medias]);
  const filtro =
    (filtroPedido.startsWith("cap:") && !secoes.some((s) => `cap:${s.id}` === filtroPedido)) ||
    (filtroPedido === "repetidas" && copias.grupos === 0)
      ? "todas"
      : filtroPedido;
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const visiveis = useMemo(() => {
    let lista = medias;
    if (filtro === "repetidas") {
      lista = lista
        .filter((m) => copias.repetidas.has(m.id))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }) || a.bytes - b.bytes);
    } else if (filtro === "sem-capitulo") {
      lista = lista.filter((m) => !m.secaoId);
    } else if (filtro.startsWith("cap:")) {
      const id = filtro.slice(4);
      lista = lista.filter((m) => m.secaoId === id);
    }
    if (termo) lista = lista.filter((m) => m.nome.toLocaleLowerCase("pt-BR").includes(termo));
    return lista;
  }, [medias, filtro, termo, copias]);
  const recortada = filtro !== "todas" || termo !== "";
  const ordemNaTela = useMemo(() => visiveis.map((m) => m.id), [visiveis]);
  const naTela = useMemo(() => new Set(ordemNaTela), [ordemNaTela]);
  /*
   * SÓ AGE SOBRE O QUE ESTÁ À VISTA. Marcar dez no capítulo X, trocar para o Y
   * e apagar não pode levar as dez que sumiram da tela junto. A seleção
   * escondida fica guardada (voltar ao X as mostra marcadas), mas não conta,
   * não move e não apaga.
   */
  const marcadas = useMemo(() => new Set([...selecao].filter((id) => naTela.has(id))), [selecao, naTela]);
  const porCapitulo = useMemo(() => {
    const c = new Map<string | null, number>();
    for (const m of medias) c.set(m.secaoId, (c.get(m.secaoId) ?? 0) + 1);
    return c;
  }, [medias]);
  const recortar = (novo: string) => {
    setSelecao(new Set());
    mudarEstadoDaGrade(galeriaId, { filtro: novo, aberta: true });
  };

  const alternarSelecao = (id: string, comShift = false) => {
    const r = depoisDoClique(ordemNaTela, marcadas, id, ancora.current, comShift);
    ancora.current = r.ancora;
    setSelecao(r.selecao);
  };

  function moverPara(secaoId: string) {
    const ids = [...marcadas];
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_ids", ids.join(","));
      // A action trata vazio como "tirar do capítulo".
      f.set("secao_id", secaoId === "__nenhum" ? "" : secaoId);
      await moverMediasAction(f);
      setSelecao(new Set());
    });
  }

  /*
   * A CAPA DA PASTA (30/09/2026) — a frente do capítulo no formato Pastas.
   *
   * Mesmo gesto da capa da galeria, e ao lado dela: o fotógrafo já sabe que
   * "capa" no canto da foto escolhe a frente de alguma coisa. O capítulo é o
   * da própria foto — quem decide é o servidor (`definirCapaDaPasta`).
   */
  const ehCapaDaPasta = (m: MediaExibida) =>
    Boolean(m.secaoId && capasDasPastas[m.secaoId] === m.id);
  async function definirCapaDaPasta(m: MediaExibida) {
    setDefinindoCapa(`pasta:${m.id}`);
    try {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_id", m.id);
      await definirCapaDaPastaAction(f);
    } finally {
      setDefinindoCapa(null);
    }
  }

  async function definirCapa(m: MediaExibida) {
    setDefinindoCapa(m.id);
    try {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_id", m.id);
      await definirCapaAction(f);
    } finally {
      setDefinindoCapa(null);
    }
  }

  /**
   * O QUE O SERVIDOR DISSE, ou o palpite mais útil que dá para fazer sem ele.
   *
   * ── DE ONDE VEIO (18/09/2026) ──────────────────────────────────────────
   *
   * Ana Carolina mandou a foto do aviso: "Não foi possível apagar agora. Tente
   * de novo." Foi tudo o que a tela disse, e foi tudo o que sobrou para
   * investigar — a rota respondia com `{ erro }` em 401 e em 404, e este
   * `catch` jogava a resposta inteira fora antes de mostrar a frase fixa.
   *
   * "Tente de novo" é conselho quando o problema passa sozinho. Sessão
   * expirada não passa sozinha: a pessoa tenta dez vezes e desiste achando que
   * o sistema está quebrado. O texto do servidor cabe na mesma linha e diz o
   * que fazer.
   */
  async function motivo(r: Response): Promise<string> {
    try {
      const corpo = await r.json();
      if (typeof corpo?.erro === "string" && corpo.erro) return corpo.erro;
    } catch {
      /* Resposta sem JSON — 502 e 504 do proxy são HTML. Cai no genérico. */
    }
    if (r.status === 401) return "Sua sessão expirou — entre de novo.";
    if (r.status === 504 || r.status === 502) return "O servidor demorou demais para responder. Tente de novo.";
    return `Tente de novo. (erro ${r.status})`;
  }

  async function apagarTodas() {
    const resposta = prompt(
      `Apagar TODOS os ${medias.length} arquivos desta galeria, fotos e vídeos? Não dá para desfazer.\n\n` +
        `Para confirmar, digite ${medias.length}:`,
    );
    if (resposta?.trim() !== String(medias.length)) return;
    setApagandoTudo(true);
    try {
      const r = await fetch(`/api/galerias/${galeriaId}/medias`, { method: "DELETE" });
      if (!r.ok) throw new Error(await motivo(r));
      setSelecao(new Set());
      router.refresh();
    } catch (e) {
      alert(`Não foi possível apagar agora. ${(e as Error).message}`);
    } finally {
      setApagandoTudo(false);
    }
  }

  /*
   * A ORDEM ENQUANTO O DEDO ANDA — igual à da lista de capítulos.
   *
   * `null` quer dizer "quem manda é a lista do servidor", e é o que faz a tela
   * voltar sozinha ao certo quando a resposta da ação chega. Zerar antes da
   * volta do servidor faria o ladrilho piscar no lugar antigo.
   */
  const [ordemLocal, setOrdemLocal] = useState<string[] | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  /*
   * VÁRIAS DE UMA VEZ (01/10/2026). Vitória: "tentei selecionar todas que eu
   * queria e quando arrastei só deu pra fazer de uma em uma". Arrastar uma foto
   * MARCADA, com outras marcadas junto, leva o grupo inteiro — para antes da
   * foto onde ele for solto. A regra é `moverBloco`, a mesma do servidor.
   */
  const [bloco, setBloco] = useState<string[] | null>(null);
  const destinoDoBloco = useRef<string | null>(null);

  function moverSelecao(destino: DestinoDoBloco, ids = ordemNaTela.filter((id) => marcadas.has(id))) {
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_ids", ids.join(","));
      f.set("destino", destino);
      await moverFotosAction(f);
      setOrdemLocal(null);
    });
  }

  function aoCruzar(alvoId: string) {
    if (bloco) {
      destinoDoBloco.current = alvoId;
      setOrdemLocal(moverBloco(ordemNaTela, bloco, alvoId));
      return;
    }
    if (!arrastando || arrastando === alvoId) return;
    const atual = (ordemLocal ?? medias.map((m) => m.id)).slice();
    const de = atual.indexOf(arrastando);
    const para = atual.indexOf(alvoId);
    if (de < 0 || para < 0) return;
    atual.splice(para, 0, ...atual.splice(de, 1));
    setOrdemLocal(atual);
  }

  function aoSoltar() {
    const arrastada = arrastando;
    setArrastando(null);
    if (bloco) {
      /* `onDrop` e `onDragEnd` chamam os dois; o segundo chega sem bloco. */
      const grupo = bloco;
      const destino = destinoDoBloco.current;
      setBloco(null);
      destinoDoBloco.current = null;
      const previsto = destino ? moverBloco(ordemNaTela, grupo, destino) : ordemNaTela;
      if (!destino || previsto.join() === ordemNaTela.join()) return setOrdemLocal(null);
      return moverSelecao(destino, grupo);
    }
    if (!arrastada || !ordemLocal) return;
    const original = medias.map((m) => m.id);
    if (ordemLocal.join() === original.join()) return setOrdemLocal(null);

    /*
     * Vai o PAR, e não a lista inteira: numa galeria de 4.577 fotos a lista
     * seriam 169 KB de formulário e 4.577 linhas reescritas para mover uma. O
     * servidor refaz o mesmo `splice` e mexe só no trecho entre as duas.
     *
     * O alvo é quem ESTAVA na posição onde ela caiu, lido da ordem original —
     * é a informação que o servidor precisa para chegar ao mesmo resultado.
     */
    const destino = ordemLocal.indexOf(arrastada);
    const alvo = original[destino];
    if (!alvo || alvo === arrastada) return setOrdemLocal(null);

    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("arrastado", arrastada);
      f.set("alvo", alvo);
      await moverFotoAction(f);
      setOrdemLocal(null);
    });
  }

  function comecarArrasto(id: string, e: DragEvent<HTMLLIElement>) {
    /* Nas repetidas a ordem é a do NOME, para as cópias ficarem lado a lado:
       arrastar ali mexeria numa ordem que não é a da galeria. */
    if (ocupado || apagandoSelecao || filtro === "repetidas") {
      e.preventDefault();
      return;
    }
    setArrastando(id);
    setOrdemLocal(medias.map((x) => x.id));
    /* Sem `setData` o Firefox não inicia o arrasto. */
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    /* Marcada, com outras marcadas: vai o grupo, e o que o cursor
       carrega diz quantas. */
    if (marcadas.has(id) && marcadas.size > 1) {
      const grupo = ordemNaTela.filter((x) => marcadas.has(x));
      setBloco(grupo);
      destinoDoBloco.current = null;
      const etiqueta = document.createElement("div");
      etiqueta.textContent = `${grupo.length} fotos`;
      etiqueta.style.cssText =
        "position:fixed;top:-100px;left:0;padding:6px 10px;border-radius:999px;background:#111;color:#fff;font:600 12px system-ui";
      document.body.appendChild(etiqueta);
      e.dataTransfer.setDragImage(etiqueta, 10, 10);
      setTimeout(() => etiqueta.remove(), 0);
    }
  }

  async function apagarSelecionadas() {
    const quantas = marcadas.size;
    if (quantas === 0) return;
    if (!confirm(`Apagar ${quantas} ${quantas === 1 ? "arquivo" : "arquivos"}? Não dá para desfazer.`)) {
      return;
    }
    setApagandoSelecao(true);
    try {
      /* A MESMA rota do "apagar todas", com a lista — uma transação só, um
         gatilho de uso só. Trinta chamadas à rota de uma foto seriam trinta
         transações e trinta recontagens do espaço da galeria. */
      const r = await fetch(`/api/galerias/${galeriaId}/medias`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...marcadas] }),
      });
      if (!r.ok) throw new Error();
      setSelecao(new Set());
      router.refresh();
    } catch {
      alert("Não foi possível apagar agora. Tente de novo.");
    } finally {
      setApagandoSelecao(false);
    }
  }

  async function remover(m: MediaExibida) {
    if (!confirm(`Remover “${m.nome}”? Não dá para desfazer.`)) return;
    setRemovendo(m.id);
    try {
      const r = await fetch(`/api/medias/${m.id}/confirmar`, { method: "DELETE" });
      if (!r.ok) throw new Error(await motivo(r));
      router.refresh();
    } catch (e) {
      alert(`Não foi possível remover agora. ${(e as Error).message}`);
    } finally {
      setRemovendo(null);
    }
  }

  /*
   * ── AS AÇÕES DO LADRILHO, ESTÁVEIS (01/10/2026) ──────────────────────────
   *
   * Juan, com galerias de até 4.577 arquivos: "tá tudo bem lagado". Medido
   * numa de 3.000: marcar UMA foto levava de 640 a 880 ms para acender, porque
   * cada clique redesenhava os 3.000 ladrilhos — eles eram desenhados aqui
   * dentro, com funções novas a cada desenho.
   *
   * Agora cada ladrilho é um `Ladrilho` memorizado, e as funções que ele
   * recebe são SEMPRE as mesmas: chamam a versão mais recente pela `ref`, que
   * é atualizada depois de cada desenho. Marcar uma foto redesenha aquela foto.
   */
  const atuais = useRef<AcoesDoLadrilho | null>(null);
  useLayoutEffect(() => {
    atuais.current = {
      marcar: alternarSelecao,
      capa: definirCapa,
      capaDaPasta: definirCapaDaPasta,
      remover,
      comecarArrasto,
      cruzar: aoCruzar,
      soltar: aoSoltar,
    };
  });
  const acoes = useMemo<AcoesDoLadrilho>(
    () => ({
      marcar: (id, comShift) => atuais.current?.marcar(id, comShift),
      capa: (m) => atuais.current?.capa(m),
      capaDaPasta: (m) => atuais.current?.capaDaPasta(m),
      remover: (m) => atuais.current?.remover(m),
      comecarArrasto: (id, e) => atuais.current?.comecarArrasto(id, e),
      cruzar: (id) => atuais.current?.cruzar(id),
      soltar: () => atuais.current?.soltar(),
    }),
    [],
  );
  /* Durante o arrasto a ordem é refeita a cada ladrilho cruzado: procurar
     cada id na lista inteira eram 9 milhões de comparações por passo. */
  const porId = useMemo(() => new Map(medias.map((m) => [m.id, m])), [medias]);
  const noBloco = useMemo(() => new Set(bloco ?? []), [bloco]);

  if (medias.length === 0) return null;

  const nomeSecao = (id: string | null) =>
    id ? (secoes.find((s) => s.id === id)?.nome ?? null) : null;

  return (
    <section id={ID_DA_GRADE} className="mt-8 scroll-mt-4">
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
          onClick={() => mudarEstadoDaGrade(galeriaId, { aberta: !aberta })}
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
              onClick={() => setSelecao(new Set(ordemNaTela))}
              disabled={ordemNaTela.length === 0}
              className="rounded-md border border-linha px-2.5 py-1 text-xs text-texto-soft transition hover:bg-carbon-2 disabled:opacity-40"
            >
              {recortada ? `selecionar estas ${ordemNaTela.length}` : "selecionar todas"}
            </button>
            <button
              type="button"
              onClick={() => setSelecao(new Set())}
              disabled={marcadas.size === 0}
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

      {aberta && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Mostrar na grade">
          <input
            type="search"
            value={busca}
            onChange={(e) => {
              setSelecao(new Set());
              setBusca(e.target.value);
            }}
            placeholder="buscar pelo nome do arquivo…"
            aria-label="Buscar pelo nome do arquivo"
            className="mr-1 w-full rounded-lg border border-linha bg-void px-3 py-1.5 text-xs placeholder:text-exemplo focus:border-acento focus:outline-none sm:w-56"
          />
          {(secoes.length > 0 || copias.grupos > 0) && (
            <>
              <Ficha ativa={filtro === "todas"} onClick={() => recortar("todas")}>
                Todas · {medias.length}
              </Ficha>
              {secoes
                .filter((s) => (porCapitulo.get(s.id) ?? 0) > 0)
                .map((s) => (
                  <Ficha key={s.id} ativa={filtro === `cap:${s.id}`} onClick={() => recortar(`cap:${s.id}`)}>
                    {s.nome} · {porCapitulo.get(s.id)}
                  </Ficha>
                ))}
              {secoes.length > 0 && (porCapitulo.get(null) ?? 0) > 0 && (
                <Ficha ativa={filtro === "sem-capitulo"} onClick={() => recortar("sem-capitulo")}>
                  Sem capítulo · {porCapitulo.get(null)}
                </Ficha>
              )}
              {copias.grupos > 0 && (
                <Ficha ativa={filtro === "repetidas"} alerta onClick={() => recortar("repetidas")}>
                  Repetidas · {copias.extras.length}
                </Ficha>
              )}
            </>
          )}
        </div>
      )}

      {aberta && filtro === "repetidas" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-alerta/40 bg-alerta/5 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-texto-soft">
            {copias.extras.length} {copias.extras.length === 1 ? "cópia extra" : "cópias extras"} de{" "}
            {copias.grupos} {copias.grupos === 1 ? "arquivo" : "arquivos"} — mesmo nome e mesmo tamanho,
            lado a lado. Fica uma de cada: a que o cliente marcou ou baixou, ou a primeira da galeria.
          </p>
          <button
            type="button"
            onClick={() => setSelecao(new Set(copias.extras))}
            className="rounded-md border border-alerta/60 px-2.5 py-1.5 text-xs font-medium text-alerta transition hover:bg-alerta/10"
          >
            marcar as cópias extras
          </button>
        </div>
      )}

      {/*
        PARA QUE SERVE SELECIONAR — dito aqui, e não só quando já há seleção.

        Antes a frase só aparecia com `selecao.size === 0 && secoes.length > 0`:
        sumia assim que a pessoa selecionava algo, e nunca aparecia para quem
        ainda não tinha criado capítulo — ou seja, faltava exatamente para quem
        não sabia o que a seleção faz.
      */}
      {aberta && (
        <p className="mt-1.5 text-xs text-texto-faint">
          Selecionar serve para agir em várias de uma vez: levar para o início ou o fim, mover
          para um capítulo, ou remover — e arrastar uma das marcadas leva todas juntas. Clique na
          foto (ou na bolinha) para marcar. Para pegar um trecho inteiro, clique na primeira e,
          segurando <kbd className="rounded border border-linha px-1">Shift</kbd>, clique na
          última.
        </p>
      )}

      {/* Barra de ações em lote — só aparece com algo selecionado. */}
      {marcadas.size > 0 && (
        <div className="sticky top-2 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-acento/40 bg-carbon-2 px-3 py-2.5 shadow-lg">
          <span className="text-sm font-medium">
            {marcadas.size} {marcadas.size === 1 ? "selecionada" : "selecionadas"}
          </span>

          <span className="ml-auto flex flex-wrap items-center gap-2">
            {/*
              PARA O INÍCIO / PARA O FIM (01/10/2026). Vitória: "eu gosto de
              selecionar minhas favoritas e colocar como as primeiras da
              galeria". Marcar e clicar, sem arrastar — e no celular, onde não
              existe arrastar, é o único caminho.
            */}
            <button
              type="button"
              disabled={ocupado}
              onClick={() => moverSelecao("inicio")}
              className="rounded-md border border-linha px-2.5 py-1.5 text-xs transition hover:border-acento hover:bg-acento/5 disabled:opacity-40"
            >
              para o início
            </button>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => moverSelecao("fim")}
              className="rounded-md border border-linha px-2.5 py-1.5 text-xs transition hover:border-acento hover:bg-acento/5 disabled:opacity-40"
            >
              para o fim
            </button>
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

            {/*
              APAGAR AS MARCADAS (28/09/2026).

              Juan: "Marquei algumas que eu quero excluir. Mas não tem botão de
              excluir. Só apagar todas. Ou apagar individualmente." A frase acima
              desta barra já prometia "mover para um capítulo, ou remover" — e a
              barra só movia. Quem marcava trinta fotos escolhia entre apagar a
              galeria inteira e trinta confirmações.

              Confirmação simples, e não a digitação da contagem que "apagar
              todas" exige: ali o clique errado custa o casamento inteiro, aqui
              custa o que está marcado na tela, à vista de quem marcou.
            */}
            <button
              type="button"
              disabled={ocupado || apagandoSelecao}
              onClick={apagarSelecionadas}
              className="rounded-md border border-erro/40 px-2.5 py-1.5 text-xs text-erro transition hover:bg-erro/10 disabled:opacity-40"
            >
              {apagandoSelecao ? "apagando…" : `apagar selecionadas (${marcadas.size})`}
            </button>
          </span>
        </div>
      )}

      {/*
        ── CONTATO, E NÃO GALERIA (25/09/2026) ───────────────────────────────

        Juan, com 4.577 arquivos na tela: "deixar essas miniaturas beeeem
        menores. Tá quase uma visualização de galeria. Pode ser algo bem menor,
        pra ter mais praticidade (…) só pra ver por cima mesmo sobre qual foto
        se trata."

        Ele está certo sobre o que a grade virou. Medido numa tela de 1440 com
        uma galeria de 4.577 arquivos, igual à dele: o ladrilho tinha 236×295 px
        — tamanho de VER a foto, e esta tela não é para ver, é para achar,
        marcar e mover. A página saía com 370.051 px de altura.

        Quatro colunas viram oito na mesma largura: 116 px por ladrilho, um
        quarto da área de antes, e a página cai para 102.173 px. É a folha de
        contato do laboratório — cabe reconhecer a foto, que é o que ele pediu,
        e cabem seis vezes mais fotos na tela sem rolar.

        ── E O "LAGZINHO" É A MESMA CONTA ────────────────────────────────────

        "Quando eu rodo muito rápido nessa parte aqui dá um lagzinho." Dá, e é
        medível: nove elementos por ladrilho dão 41.409 numa página só. O
        `loading="lazy"` segura o DOWNLOAD da imagem e não o trabalho de layout
        e pintura, que o navegador refaz a cada rolada.

        `content-visibility: auto` é exatamente o remédio: o navegador pula
        layout e pintura do que está fora da tela, e `contain-intrinsic-size`
        diz a altura a reservar para a barra de rolagem não dançar. Duas linhas
        de CSS no lugar de uma virtualização inteira, sem estado e sem
        biblioteca.

        Varrendo a galeria inteira em 150 quadros, antes e depois: a mediana
        por quadro caiu de 57,1 ms para 27,3 ms, o pior quadro de 418,8 para
        148,1, e os quadros abaixo de 30 fps de 148 (de 149) para 43. Com 1.008
        fotos não dá para ver diferença nenhuma — ali já eram 60 fps dos dois
        lados. O defeito é de escala, e só aparece na escala dele
      */}
      {aberta && recortada && ordemNaTela.length === 0 && (
        <p className="mt-4 text-sm text-texto-faint">
          {termo ? `Nenhum arquivo com “${busca.trim()}” no nome aqui.` : "Nada aqui."}
        </p>
      )}
      {aberta && (
      <ul className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10">
        {(ordemLocal
          ? (ordemLocal.map((id) => porId.get(id)).filter((m) => m && naTela.has(m.id)) as typeof medias)
          : visiveis
        ).map((m) => (
          <Ladrilho
            key={m.id}
            m={m}
            galeriaId={galeriaId}
            acoes={acoes}
            selecionada={marcadas.has(m.id)}
            /* Recortada, a grade já diz de onde são as fotos: o rótulo volta
               a ser o nome do arquivo, que é o que se procura ali. */
            capitulo={recortada ? null : nomeSecao(m.secaoId)}
            ehCapa={capaId === m.id}
            ehCapaDaPasta={ehCapaDaPasta(m)}
            mostrarCapaDaPasta={mostrarCapaDaPasta}
            esmaecido={arrastando === m.id || noBloco.has(m.id)}
            definindo={
              definindoCapa === m.id ? "capa" : definindoCapa === `pasta:${m.id}` ? "pasta" : null
            }
            removendo={removendo === m.id}
          />
        ))}
      </ul>
      )}
    </section>
  );
}

interface AcoesDoLadrilho {
  marcar: (id: string, comShift: boolean) => void;
  capa: (m: MediaExibida) => void;
  capaDaPasta: (m: MediaExibida) => void;
  remover: (m: MediaExibida) => void;
  comecarArrasto: (id: string, e: DragEvent<HTMLLIElement>) => void;
  cruzar: (id: string) => void;
  soltar: () => void;
}

interface PropsDoLadrilho {
  m: MediaExibida;
  galeriaId: string;
  acoes: AcoesDoLadrilho;
  selecionada: boolean;
  capitulo: string | null;
  ehCapa: boolean;
  ehCapaDaPasta: boolean;
  mostrarCapaDaPasta: boolean;
  esmaecido: boolean;
  definindo: "capa" | "pasta" | null;
  removendo: boolean;
}

/*
 * Redesenha só quando algo que ELE mostra mudou. A mídia chega como objeto
 * novo a cada volta do servidor, então ela é comparada campo a campo — menos
 * os endereços, que quem decide é `useEnderecoDaMiniatura`: o guardado vale
 * mais que o recém-assinado, e é isso que segura a imagem no lugar.
 */
function mesmoLadrilho(a: PropsDoLadrilho, b: PropsDoLadrilho): boolean {
  for (const k of Object.keys(a) as (keyof PropsDoLadrilho)[]) {
    if (k === "m") continue;
    if (a[k] !== b[k]) return false;
  }
  const x = a.m;
  const y = b.m;
  return (
    x.id === y.id &&
    x.nome === y.nome &&
    x.tipo === y.tipo &&
    x.bytes === y.bytes &&
    x.secaoId === y.secaoId &&
    x.favoritas === y.favoritas &&
    x.baixadas === y.baixadas &&
    x.versao === y.versao &&
    x.temCapa === y.temCapa
  );
}

/**
 * O endereço do ladrilho: o guardado, se houver; senão o que veio da página
 * (primeira tela); senão nenhum — e aí ele pede quando chegar perto da tela.
 */
function useEnderecoDaMiniatura(
  galeriaId: string,
  m: MediaExibida,
  caixa: RefObject<HTMLLIElement | null>,
): EnderecoDaMiniatura | undefined {
  const chave = chaveDaMiniatura(m);
  const ouvir = useCallback((avisar: () => void) => ouvirMiniatura(chave, avisar), [chave]);
  const guardado = useSyncExternalStore(
    ouvir,
    () => lerMiniatura(chave),
    () => undefined,
  );
  const { id, url, urlFilme } = m;
  useEffect(() => {
    if (url) guardarMiniatura(chave, { url, urlFilme });
  }, [chave, url, urlFilme]);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    return observarMiniatura(el, () => pedirMiniatura(galeriaId, id, chave));
  }, [galeriaId, id, chave, caixa]);
  return guardado ?? (url ? { url, urlFilme } : undefined);
}

const Ladrilho = memo(function Ladrilho({
  m,
  galeriaId,
  acoes,
  selecionada,
  capitulo,
  ehCapa,
  ehCapaDaPasta,
  mostrarCapaDaPasta,
  esmaecido,
  definindo,
  removendo,
}: PropsDoLadrilho) {
  const caixa = useRef<HTMLLIElement>(null);
  const endereco = useEnderecoDaMiniatura(galeriaId, m, caixa);
  return (
    <li
      ref={caixa}
      /*
        ARRASTAR PARA REORDENAR (28/09/2026).

        Felipe: "quero adicionar as fotos analógicas que fiz no 'local'
        certo, na ordem cronológica e não consigo arrastar". A ordem era
        decidida no ENVIO e ponto — quem revela um filme depois não tinha
        onde encaixá-lo.

        Mesmo idioma da lista de capítulos: a ordem local manda enquanto
        o dedo anda, o servidor recebe só o par (arrastada, alvo) e a
        lista do servidor volta a mandar quando a resposta da ação
        chega. E a conta do servidor usa o MESMO `splice` daqui — se as
        duas discordassem, o ladrilho pularia de lugar ao recarregar.

        `draggable` não existe no toque, e é por isso que o "mover para"
        do menu continua: no celular ele é o único caminho.
      */
      /* Sempre arrastável: com a grade ocupada, quem recusa é
         `comecarArrasto`. Um `draggable` que liga e desliga redesenhava
         os 4.577 ladrilhos a cada clique da aba. */
      draggable
      onDragStart={(e) => acoes.comecarArrasto(m.id, e)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        acoes.cruzar(m.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        acoes.soltar();
      }}
      onDragEnd={acoes.soltar}
      className={`group relative [contain-intrinsic-size:auto_170px] [content-visibility:auto] ${
        esmaecido ? "opacity-40" : ""
      }`}
    >
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
            src={endereco?.url}
            alt={m.nome}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          /* `src` é o filme e `poster` é a capa: são dois endereços
             para duas coisas, e o HTML tem um atributo para cada uma.
             Sem capa o `poster` some — apontá-lo para o original
             mandaria o navegador desenhar um filme como imagem. */
          <video
            src={endereco?.urlFilme ?? endereco?.url}
            poster={m.temCapa ? endereco?.url : undefined}
            className="h-full w-full object-cover"
            preload="metadata"
            controls
          />
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
          /* O navegador pinta uma seleção de TEXTO entre dois cliques
             com shift. Sem isto, marcar um trecho de 300 fotos deixa
             meia grade azulada por baixo. */
          onMouseDown={(e) => {
            if (e.shiftKey) e.preventDefault();
          }}
          onClick={(e) => acoes.marcar(m.id, e.shiftKey)}
          aria-label={`${selecionada ? "Desmarcar" : "Selecionar"} ${m.nome}`}
          aria-pressed={selecionada}
          className="absolute inset-x-0 top-0 aspect-[4/5] w-full cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-acento"
        />
      )}

      {/* Bolinha de seleção — sempre visível, para ficar óbvio que dá para selecionar. */}
      <button
        type="button"
        onMouseDown={(e) => {
          if (e.shiftKey) e.preventDefault();
        }}
        onClick={(e) => acoes.marcar(m.id, e.shiftKey)}
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

      {(ehCapa || (mostrarCapaDaPasta && ehCapaDaPasta)) && (
        <span className="absolute left-9 top-1.5 z-10 flex flex-col items-start gap-1">
          {ehCapa && (
            <span className="rounded-md bg-acento px-2 py-0.5 text-[10px] font-semibold text-void">
              capa
            </span>
          )}
          {mostrarCapaDaPasta && ehCapaDaPasta && (
            <span className="whitespace-nowrap rounded-md bg-void/85 px-2 py-0.5 text-[10px] font-semibold text-acento-alto">
              capa da pasta
            </span>
          )}
        </span>
      )}

      {/*
        Marca do cliente, não do fotógrafo: ele não clica aqui, só lê.
        O número aparece a partir de 2 porque, com uma pessoa só, "♥ 1"
        em toda foto marcada vira ruído — o que importa ali é o coração.
        Com duas ou mais, o número é a informação: foto escolhida pelos
        dois é decisão tomada.
      */}
      {((m.favoritas ?? 0) > 0 || (m.baixadas ?? 0) > 0) && (
        /*
          ── ANCORADO NA FOTO, E NÃO NO ITEM INTEIRO ────────────────
          A caixa da imagem não é `relative`, então um `absolute` aqui
          se mede contra o `<li>` — que inclui a linha do nome e do
          tamanho embaixo. Medido: a pastilha nascia 17 px ABAIXO da
          foto, em cima de "1.0 MiB".
          O coração de favorita tinha o mesmo defeito desde que nasceu;
          ele só não aparecia porque quase nenhuma galeria de teste
          tinha favorita marcada. Este invólucro repete o truque que o
          alvo de clique já usa — `inset-x-0 top-0 aspect-[4/5]` tem
          exatamente a altura da foto — e aí `items-end` encosta as duas
          pastilhas no rodapé da IMAGEM.
          `pointer-events-none` porque isto é leitura, não alvo: sem
          ele, o invólucro cobriria a foto inteira e mataria o clique
          que seleciona.
        */
        <span className="pointer-events-none absolute inset-x-0 top-0 flex aspect-[4/5] items-end justify-end p-1.5">
        <span className="flex items-center gap-1">
          {(m.favoritas ?? 0) > 0 && (
            <span
              title={`${m.favoritas} ${m.favoritas === 1 ? "pessoa marcou" : "pessoas marcaram"} como favorita`}
              className="rounded-full bg-void/80 px-1.5 text-[10px] font-medium text-acento"
            >
              ♥{(m.favoritas ?? 0) > 1 ? ` ${m.favoritas}` : ""}
            </span>
          )}
          {/*
            O CONTADOR DE DOWNLOADS, ao lado do coração.

            Felipe, 23/09/2026: "e o numero de downloads de cada foto".
            Coração e seta respondem perguntas diferentes — "gostaram" e
            "levaram" —, e uma foto pode ter muito de um e nada do
            outro. Por isso são duas pastilhas e não uma.

            Aqui o número aparece SEMPRE, inclusive no 1, ao contrário
            do coração: baixar é um evento contável que se repete, e
            "alguém baixou" e "baixaram doze vezes" são notícias
            diferentes. O coração, não — ou a pessoa marcou, ou não.
          */}
          {(m.baixadas ?? 0) > 0 && (
            <span
              title={`${m.baixadas} download${m.baixadas === 1 ? "" : "s"} desta foto`}
              className="rounded-full bg-void/80 px-1.5 text-[10px] font-medium text-texto-soft"
            >
              ↓ {m.baixadas}
            </span>
          )}
        </span>
        </span>
      )}

      {/* EM PÉ, e não lado a lado: deitados eles somam 86 px e o
          ladrilho tem 116, então cobriam a bolinha de marcar (medido:
          7 px por cima dela). Empilhados ocupam 48 e sobram 32 px de
          folga até a bolinha, que continua legível com o ponteiro em
          cima — e é ela que diz se a foto está marcada. */}
      <span className="absolute right-1.5 top-1.5 z-10 flex flex-col items-end gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
        {m.tipo === "foto" && !ehCapa && (
          <button
            type="button"
            onClick={() => acoes.capa(m)}
            disabled={definindo === "capa"}
            aria-label={`Usar ${m.nome} como capa`}
            className="rounded-md bg-void/80 px-1.5 py-0.5 text-[10px] text-texto disabled:opacity-50"
          >
            {definindo === "capa" ? "…" : "capa"}
          </button>
        )}
        {/* Vídeo também pode ser a frente da pasta — a pasta do filme
            tem só vídeo —, desde que tenha pôster para mostrar. */}
        {mostrarCapaDaPasta && m.secaoId && !ehCapaDaPasta && (m.tipo === "foto" || m.temCapa) && (
          <button
            type="button"
            onClick={() => acoes.capaDaPasta(m)}
            disabled={definindo === "pasta"}
            aria-label={`Usar ${m.nome} como capa da pasta`}
            title="A frente deste capítulo quando a galeria é entregue em pastas"
            className="rounded-md bg-void/80 px-1.5 py-0.5 text-[10px] text-texto disabled:opacity-50"
          >
            {definindo === "pasta" ? "…" : "capa da pasta"}
          </button>
        )}
        <button
          type="button"
          onClick={() => acoes.remover(m)}
          disabled={removendo}
          aria-label={`Remover ${m.nome}`}
          className="rounded-md bg-void/80 px-1.5 py-0.5 text-[10px] text-texto disabled:opacity-50"
        >
          {removendo ? "…" : "remover"}
        </button>
      </span>

      {/* Nome e tamanho lado a lado sobravam da grade grande: em 116 px
          o nome virava três letras e reticências. O tamanho passa para
          o `title`, junto do nome inteiro — que o `truncate` corta de
          todo jeito, e é o que faltava para saber QUAL arquivo é. */}
      <div
        title={`${m.nome} · ${formatar(m.bytes)}`}
        className="mt-1 truncate text-[10px] text-texto-faint"
      >
        {capitulo ?? m.nome}
      </div>
    </li>
  );
}, mesmoLadrilho);

/** Uma ficha do recorte da grade. */
function Ficha({
  ativa,
  alerta = false,
  onClick,
  children,
}: {
  ativa: boolean;
  alerta?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={`inline-flex min-h-8 items-center whitespace-nowrap rounded-full border px-3 text-xs transition ${
        ativa
          ? alerta
            ? "border-alerta bg-alerta/15 font-medium text-alerta"
            : "border-acento bg-acento/10 font-medium text-texto"
          : alerta
            ? "border-alerta/40 text-alerta hover:bg-alerta/10"
            : "border-linha text-texto-soft hover:border-linha-forte hover:bg-carbon-2"
      }`}
    >
      {children}
    </button>
  );
}
