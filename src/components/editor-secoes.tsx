"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  criarSecaoAction,
  apagarTodosOsCapitulosAction,
  renomearSecaoAction,
  renomearGrupoSoltoAction,
  apagarSecaoAction,
  moverSecaoAction,
  reordenarSecoesAction,
  moverSoltasAction,
  esvaziarSecaoAction,
  ordenarFotosDaSecaoAction,
} from "@/app/painel/actions";
import { ORDENS_DAS_FOTOS } from "@/config/ordens-das-fotos";
import { nomeDoGrupoSolto } from "@/lib/nome-de-arquivo";
import { verNaGrade } from "@/lib/filtro-da-grade";

export interface SecaoResumo {
  id: string;
  nome: string;
  total: number;
}

/**
 * O id de mentira do grupo das fotos soltas, dentro desta tela.
 *
 * Ele não é uma seção e não tem linha no banco, mas divide a lista — e o campo
 * de renomear — com os capítulos. Usa a mesma palavra que a galeria já usa na
 * URL (`?cap=sem-capitulo`), para não existirem dois nomes para a mesma coisa;
 * e como todo id de capítulo é UUID, não há como colidir.
 */
const SOLTAS = "sem-capitulo";

/**
 * Capítulos da galeria (Making Of, Cerimônia, Festa…).
 *
 * Apagar um capítulo NÃO apaga as fotos dele — elas voltam para "sem capítulo".
 * Isso é dito na tela, porque a dúvida aparece na hora de clicar.
 */
/** O que a tela já mostra enquanto o servidor confirma. Ver `executar`. */
type Previa = { tipo: "criar"; nome: string } | { tipo: "apagar"; id: string } | { tipo: "apagarTodos" };

function aplicarPrevia(atual: SecaoResumo[], p: Previa): SecaoResumo[] {
  if (p.tipo === "apagarTodos") return [];
  if (p.tipo === "apagar") return atual.filter((s) => s.id !== p.id);
  const nome = p.nome.trim();
  /* Nome repetido o servidor recusa — e a tela não promete o que não vai ter. */
  if (!nome || atual.some((s) => s.nome.toLowerCase() === nome.toLowerCase())) return atual;
  return [...atual, { id: `novo:${nome}`, nome, total: 0 }];
}

export function EditorSecoes({
  galeriaId,
  secoes: secoesDoServidor,
  semCapitulo,
  grupoSolto,
  sugestoes,
}: {
  galeriaId: string;
  secoes: SecaoResumo[];
  semCapitulo: number;
  /** Como o fotógrafo chamou o grupo das soltas. Nulo = "Outras fotos". */
  grupoSolto: string | null;
  /**
   * Os momentos típicos de um casamento, para clicar um a um.
   *
   * Vem por propriedade e não por `import`: a lista mora em `lib/secoes.ts`,
   * que é `server-only`. É o mesmo caminho que o assistente de galeria nova já
   * usa (`galerias/nova/page.tsx` passa `capitulosSugeridos`).
   */
  sugestoes: readonly string[];
}) {
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [nomeEditado, setNomeEditado] = useState("");
  const [ocupado, iniciar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);
  /* O segundo tempo do "apagar todos": ver o comentário lá embaixo. */
  const [confirmandoTudo, setConfirmandoTudo] = useState(false);
  /*
   * ── O CAPÍTULO APARECE NA HORA (01/10/2026) ─────────────────────────────
   *
   * Juan: "cada exclusão / criação de um capítulo novo tá…" — lento. Numa
   * galeria de 3.000 fotos a volta do servidor levava 3 s com a rede dele
   * (Portland, VPN), e a lista ficava parada esse tempo todo: parecia que o
   * clique não tinha pegado, e a vontade é clicar de novo.
   *
   * Criar e apagar já mudam a lista no clique. Se o servidor recusar, a lista
   * volta sozinha ao que ele disser — `useOptimistic` só vale enquanto a ação
   * está em curso. Os botões das linhas ficam travados nesse meio-tempo
   * (`ocupado`), então ninguém renomeia um capítulo que ainda não existe.
   */
  const [secoes, mostrarAntes] = useOptimistic(secoesDoServidor, aplicarPrevia);

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
   * sozinha ao certo quando a resposta da ação chega.
   *
   * As SETAS FICAM. `draggable` do HTML não existe no toque, e elas também são
   * o caminho de quem usa teclado; trocá-las por arrastar tiraria de uns para
   * dar a outros.
   */
  const [ordem, setOrdem] = useState<string[] | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);

  /* Há capítulo de verdade nesta galeria? Muda o nome, o recado e quais
     controles a linha das soltas oferece — ver a linha logo abaixo da lista. */
  const temCapitulos = secoes.length > 0;
  /* Em minúsculas porque é assim que `criarSecao` compara — "Festa" e "festa"
     são o mesmo capítulo para ela, e sugerir o que vai ser recusado é pior do
     que não sugerir. */
  const nomesCriados = new Set(secoes.map((s) => s.nome.toLowerCase()));
  /* Quantas fotos mudariam de lugar se todos os capítulos fossem apagados. */
  const fotosEmCapitulos = secoes.reduce((soma, s) => soma + s.total, 0);

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
    /* Roda DEPOIS da resposta, que já traz a página nova (a ação revalida).
       Existe por causa do arrasto: a lista desenhada à mão precisa ser
       descartada quando a do servidor chega, e só aqui dá para saber que ela
       já chegou. */
    aoTerminar?: () => void,
    previa?: Previa,
  ) =>
    iniciar(async () => {
      if (previa) mostrarAntes(previa);
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      for (const [k, v] of Object.entries(campos)) f.set(k, v);
      const r = await acao(f);
      setErro(r?.erro ?? null);
      /* `aviso` não é erro: a ordenação FUNCIONOU, e o recado é sobre o que ela
         não pôde saber (foto sem data da câmera). Ver `ordenarFotosDaSecaoAction`. */
      setAviso(r?.aviso ?? null);
      /*
       * Sem `router.refresh()` aqui desde 01/10/2026: toda ação desta lista
       * chama `revalidatePath`, e a resposta da ação JÁ traz a página
       * redesenhada. O `refresh` pedia a mesma página uma segunda vez — numa
       * galeria de 3.000 fotos, mais 2 MB e mais meio segundo de servidor a
       * cada clique.
       */
      aoTerminar?.();
    });


  /* Os dois blocos são constantes para poderem TROCAR DE LUGAR lá embaixo
     sem virarem duas cópias do mesmo JSX. Ver o comentário do título. */
  const caixaDeVazio =
    secoes.length === 0 ? (
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
        {/*
          ── AQUI HAVIA UM BOTÃO QUE CRIAVA SEIS DE UMA VEZ (saiu 29/09/2026) ──

          Juan: "menor o botão de 'criar os capítulos de um casamento', porque
          vi que clicaram errado e criaram vários capítulos sem querer".

          Diminuir o botão só deixaria o acidente mais raro — e ele continuaria
          custando seis exclusões à mão, porque não havia desfazer. Felipe
          fechou pelo outro lado: "não crie todos os capítulos de uma vez,
          deixe o usuário criar, se não ele precisará apagar".

          Os seis nomes não sumiram: viraram sugestões clicáveis ao lado do
          campo de criar, lá embaixo — um clique, um capítulo. Elas ficam LÁ e
          não aqui de propósito, porque esta caixa some assim que existe o
          primeiro capítulo, e quem acabou de criar "Making Of" ainda quer os
          outros cinco à mão.
        */}
      </div>
  ) : null;

  /*
      ── A LISTA NÃO DEPENDE MAIS DE HAVER CAPÍTULO (18/09/2026) ───────────

      Juan: "não tem botão pra reorganizar a ordem das fotos. Essa opção só
      aparece quando tem capítulos, quando não tem capítulo não aparece."

      Era literal: a lista inteira vivia no `else` do "Nenhum capítulo ainda",
      e com ela sumia a linha das fotos sem capítulo — que é onde mora o
      "ordenar". Numa galeria de fluxo único, que o próprio cartão acima diz
      que "também funciona bem", o fotógrafo ficava sem jeito nenhum de mexer
      na ordem das 286 fotos que acabara de subir.

      O cartão de vazio continua, porque ensina o que é capítulo. A lista
      aparece ao lado dele quando há foto solta, que é quando ela tem o que
      mostrar.
  */
  const listaDeGrupos =
    lista.length > 0 || semCapitulo > 0 ? (
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
            /* `novo:` é o capítulo que a tela já mostra e o servidor ainda não
               criou (ver `mostrarAntes`): aparece, mas sem nada clicável. */
            inert={s.id.startsWith("novo:")}
            className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${
              arrastando === s.id || s.id.startsWith("novo:") ? "opacity-40" : ""
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
                  {/* VER AS FOTOS DESTE CAPÍTULO (01/10/2026). Juan: "ainda não
                      tem como visualizar as fotos que tem em cada capítulo". A
                      contagem vira o caminho: a grade lá embaixo mostra só
                      este capítulo, e a tela desce até ela. */}
                  {s.total > 0 ? (
                    <button
                      type="button"
                      onClick={() => verNaGrade(galeriaId, `cap:${s.id}`)}
                      className="text-[11px] text-texto-faint underline decoration-dotted underline-offset-2 transition hover:text-acento"
                    >
                      ver as {s.total} {s.total === 1 ? "foto" : "fotos"}
                    </button>
                  ) : (
                    <span className="text-[11px] text-texto-faint">0 fotos</span>
                  )}
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

                    ── DESABILITADO, E NÃO ESCONDIDO (17/09/2026) ──────

                    Ele SUMIA com menos de duas fotos, com o argumento de que
                    ordenar zero fotos é um menu que não faz nada. Verdade
                    sobre a ação, e errado sobre a tela, por dois motivos que
                    o Felipe viu de uma vez: "a opção ordenar ficou só em um
                    capítulo".

                    1. Capítulo NASCE vazio. O caminho normal é criar Making
                       Of, Cerimônia, Festa e só depois mandar as fotos — ou
                       seja, na hora de conhecer a tela o recurso não está lá,
                       e quem não o viu no começo não vai procurá-lo depois.

                    2. A linha some, mas o espaço não: sem o select, os botões
                       daquela linha escorregam para a esquerda e nenhuma
                       coluna bate com a de cima. A lista inteira fica torta
                       por causa de um controle a menos.

                    Desabilitado resolve os dois: a coluna se mantém, o
                    recurso se anuncia, e continua sem fazer nada quando não
                    há o que ordenar — que era o ponto legítimo do argumento
                    antigo. O `title` diz por que está apagado, senão vira
                    botão morto sem explicação.
                  */}
                  {(() => {
                    const poucasFotos = s.total < 2;
                    return (
                    <select
                      aria-label={`Ordenar as fotos de ${s.nome}`}
                      title={
                        poucasFotos
                          ? "Mande fotos para este capítulo — com menos de duas não há o que ordenar"
                          : undefined
                      }
                      disabled={ocupado || poucasFotos}
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
                    );
                  })()}
                  {/*
                    O CAMINHO DE VOLTA (28/09/2026).

                    O grupo das soltas tem "mover todas para…" desde 04/09; o
                    capítulo não tinha como devolver. Quem mandou a pasta errada
                    no envio desfazia foto a foto — ou APAGAVA o capítulo, que é
                    um botão vermelho com aviso de que não dá para desfazer,
                    para uma intenção que era só reorganizar.

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
                              `Elas voltam para o grupo das fotos sem capítulo. ` +
                              `O capítulo continua, vazio.`,
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
                      if (confirm(aviso))
                        executar(apagarSecaoAction, { secao_id: s.id }, undefined, { tipo: "apagar", id: s.id });
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
            {/*
              ── O GRUPO DAS SOLTAS TEM NOME, E O NOME É DO FOTÓGRAFO ───────

              Juan, 18/09/2026: "aqui fica aparecendo 'outras fotos', pelo que
              eu vi é todas as fotos juntas, não tem como trocar pra esse
              nome. Tipo galeria completa ou algo assim. Ou eu não sei se foi
              eu que fiz algo de errado kkkk, mas não criei nenhuma pasta com
              esse nome."

              Ele não criou nada: o texto era NOSSO, escrito na página da
              galeria desde 04/09/2026, e esta linha só o anunciava em negrito
              — "suas fotos aparecem como Outras fotos" — sem oferecer como
              trocar. Numa tela em que todo capítulo ao lado tem um botão
              "renomear", ler isso é concluir que aquela pasta veio de algum
              lugar que você não controla.

              Então o mesmo botão e o mesmo campo. A diferença entre este
              grupo e um capítulo é o que ele É — o que sobrou, calculado a
              cada carregamento —, e não o direito de se chamar do que o dono
              da galeria quiser.
            */}
            {editando === SOLTAS ? (
              <>
                <input
                  value={nomeEditado}
                  onChange={(e) => setNomeEditado(e.target.value)}
                  /* A marca-d'água é o nome de fábrica: apagar o campo volta
                     para ele, e o campo vazio mostra qual é. */
                  placeholder={nomeDoGrupoSolto(null)}
                  aria-label="Nome do grupo das fotos sem capítulo"
                  autoFocus
                  className="min-w-0 flex-1 rounded-md border border-linha bg-void px-2 py-1 text-sm focus:border-acento focus:outline-none"
                />
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => {
                    executar(renomearGrupoSoltoAction, { nome: nomeEditado });
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
                {/* `min-w` para o nome NÃO ser espremido: sem ele, o `flex-1`
                    encolhe este bloco até caber ao lado dos dois controles, e
                    num celular de 390 px o nome virava "Galer…" com a frase
                    quebrando uma palavra por linha. Com piso, o `flex-wrap`
                    manda os controles para a linha de baixo, que é o que as
                    linhas dos capítulos já fazem. */}
                <span className="min-w-[11rem] flex-1">
                  {/* Sem capítulo nenhum, estas fotos NÃO são "as outras" —
                      são a galeria inteira, e a pastilha com nome nem existe
                      (ver `nome: temCapitulo ? … : ""` na página do cliente).
                      Chamá-las de "Outras fotos" aqui seria a tela inventar
                      uma divisão que a galeria não tem. */}
                  <span className="block truncate text-sm text-texto-soft">
                    {temCapitulos ? nomeDoGrupoSolto(grupoSolto) : "Todas as fotos"}
                  </span>
                  <span className="text-[11px] text-texto-faint">
                    {temCapitulos && semCapitulo > 0 ? (
                      <button
                        type="button"
                        onClick={() => verNaGrade(galeriaId, "sem-capitulo")}
                        className="underline decoration-dotted underline-offset-2 transition hover:text-acento"
                      >
                        ver as {semCapitulo} {semCapitulo === 1 ? "foto" : "fotos"}
                      </button>
                    ) : (
                      <>
                        {semCapitulo} {semCapitulo === 1 ? "foto" : "fotos"}
                      </>
                    )}
                    {temCapitulos
                      ? ` — ${semCapitulo === 1 ? "aparece" : "aparecem"} com esse nome, antes dos capítulos`
                      : " — numa sequência só, na ordem abaixo"}
                  </span>
                </span>

                <span className="flex items-center gap-1">
                  {/*
                    ── ORDENAR TAMBÉM AQUI (18/09/2026) ────────────────────

                    `ordenarFotosDaSecaoAction` aceita `secao_id` vazio desde
                    que nasceu — "o grupo das soltas aparece na mesma lista da
                    tela e tem o mesmo direito de ser ordenado", diz o
                    comentário dela. Só que a tela nunca ofereceu o seletor, e
                    a ação ficou sem porta: numa galeria sem capítulos não
                    havia NENHUM jeito de mexer na ordem.

                    Mesmo `disabled` dos capítulos, pelo mesmo motivo: com
                    menos de duas fotos não há o que ordenar, e um controle que
                    some deixa a coluna torta e some com o recurso.
                  */}
                  {(() => {
                    const poucasFotos = semCapitulo < 2;
                    /* `secao_id` vazio é o grupo das soltas — a ação entende,
                       e é o que a torna útil aqui. */
                    const ordenar = (criterio: string) =>
                      executar(ordenarFotosDaSecaoAction, { secao_id: "", criterio });

                    /*
                      ── SEM CAPÍTULO, OS CRITÉRIOS FICAM À MOSTRA (25/09/2026)

                      Juan, dois dias depois de o cartão passar a se chamar
                      "Ordem das fotos": "cade a opção de reorganizar as fotos
                      por nome A-Z. Quando não tem capítulo."

                      O controle ESTAVA na tela — e continuava impossível de
                      achar, porque era um `select` cinza de 11 px encostado na
                      borda direita, escrito "ordenar…". A palavra que ele
                      procurava ("A-Z") não aparecia em lugar nenhum: estava
                      dentro do menu, e menu fechado não se lê. Ao lado, a
                      caixa azul "Nenhum capítulo ainda" ocupa metade do cartão
                      — o olho vai nela, conclui que o assunto é capítulo, e sai.

                      Duas vezes consertamos ONDE o controle mora. O que
                      faltava é ele DIZER o que faz. Sem capítulo o cartão
                      inteiro é sobre ordem, então os cinco critérios são a
                      cara dele, escritos por extenso, um clique cada.

                      Nos CAPÍTULOS continua o `select`, e pelo motivo de
                      16/09: cinco botões repetidos em cada linha de uma lista
                      de seis capítulos são trinta botões: uma parede. Lá o
                      nome do capítulo já é o assunto da linha, e o menu cabe.
                    */
                    if (!temCapitulos) {
                      return (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-texto-faint">ordenar por</span>
                          {ORDENS_DAS_FOTOS.map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              disabled={ocupado || poucasFotos}
                              title={
                                poucasFotos
                                  ? "Com menos de duas fotos não há o que ordenar"
                                  : undefined
                              }
                              onClick={() => ordenar(o.id)}
                              className="rounded-md border border-linha bg-void px-2 py-1 text-xs text-texto-soft transition hover:border-linha-forte hover:bg-carbon-2 disabled:opacity-40"
                            >
                              {o.nome}
                            </button>
                          ))}
                        </span>
                      );
                    }

                    return (
                      <select
                        aria-label="Ordenar as fotos sem capítulo"
                        title={
                          poucasFotos
                            ? "Com menos de duas fotos não há o que ordenar"
                            : undefined
                        }
                        disabled={ocupado || poucasFotos}
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          ordenar(e.target.value);
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
                    );
                  })()}
                  {temCapitulos && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => {
                      setEditando(SOLTAS);
                      /* Começa VAZIO enquanto o nome ainda é o nosso: o campo
                         mostra "Outras fotos" como marca-d'água e ele digita o
                         dele por cima, em vez de apagar um texto que não
                         escreveu. */
                      setNomeEditado(grupoSolto ?? "");
                    }}
                    className="rounded-md border border-linha px-2 py-1 text-xs text-texto-soft transition hover:bg-carbon-2"
                  >
                    renomear
                  </button>
                  )}
                  {/*
                    MOVER TODAS DE UMA VEZ — pedido do sócio em 04/09/2026:
                    "as fotos sem capítulo devem ir obrigatoriamente para um
                    capítulo".

                    Obrigar no ENVIO seria atrito no pior momento: quem está
                    subindo 600 fotos não quer responder pergunta. Um botão
                    que arruma depois entrega o mesmo resultado e não cobra
                    nada de quem não se importa — e quem não clicar não fica
                    com pastilha sem nome na galeria, porque o grupo tem um
                    (o nosso, ou o que ele escreveu no botão ao lado).
                  */}
                  {temCapitulos && (
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
                  )}
                </span>
              </>
            )}
          </li>
        )}
      </ul>
  ) : null;

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      {/*
        ── O CARTÃO DIZ O QUE ELE FAZ, E NÃO SÓ O QUE ELE OFERECE ───────────

        Juan, 23/09/2026: "quando tá sem capítulo não tem onde reorganizar as
        fotos por nome A-Z". O controle existia desde 18/09 — ele estava DENTRO
        de um cartão chamado "Capítulos", abaixo de uma caixa que anuncia
        "Nenhum capítulo ainda". Quem não tem capítulo não tem motivo nenhum
        para ler esse cartão, e o vazio ainda confirma que ele não se aplica.

        Sem capítulo, o assunto deste cartão é a ORDEM das fotos, e criar
        capítulos é a oferta. Então o título muda e, lá embaixo, a linha das
        fotos sobe para cima do vazio.
      */}
      <h2 className="text-sm font-semibold">{temCapitulos ? "Capítulos" : "Ordem das fotos"}</h2>
      <p className="mt-0.5 text-xs text-texto-faint">
        {temCapitulos
          ? "Dividem a galeria em momentos. O cliente ganha um menu para pular direto ao que quer ver."
          : "A sequência em que o casal vai ver. Dá para ordenar por nome, por data da foto ou pela ordem de envio."}
      </p>

      {/* Sem capítulo, a LISTA vem primeiro: ela é o assunto, e a caixa de
          criar capítulos é a oferta. Com capítulos o vazio nem aparece. */}
      {temCapitulos ? (
        <>
          {caixaDeVazio}
          {listaDeGrupos}
        </>
      ) : (
        <>
          {listaDeGrupos}
          {caixaDeVazio}
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && novo.trim()) {
              executar(criarSecaoAction, { nome: novo }, undefined, { tipo: "criar", nome: novo });
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
            executar(criarSecaoAction, { nome: novo }, undefined, { tipo: "criar", nome: novo });
            setNovo("");
          }}
          className="rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-40"
        >
          Adicionar
        </button>
      </div>

      {/*
        ── AS SUGESTÕES, UMA A UMA (29/09/2026) ──────────────────────────────

        Os seis momentos de um casamento continuam à mão, mas cada um é um
        clique próprio. O pior que um clique errado faz agora é criar UM
        capítulo vazio, que se apaga na linha dele.

        Ficam coladas no campo de criar porque é a mesma decisão — "quero um
        capítulo chamado assim" — e não um segundo lugar que faz a mesma coisa.
        O campo é para o nome que só o fotógrafo sabe ("Saída da noiva"); as
        fichas são para os nomes que se repetem em todo casamento.

        A ficha some depois de criada: `criarSecao` recusa nome repetido, então
        oferecer de novo seria oferecer um erro.
      */}
      {sugestoes.some((n) => !nomesCriados.has(n.toLowerCase())) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-texto-faint">Sugestões:</span>
          {sugestoes
            .filter((n) => !nomesCriados.has(n.toLowerCase()))
            .map((nome) => (
              <button
                key={nome}
                type="button"
                disabled={ocupado}
                /* `aria-label` e não `title`: `title` não existe no toque, e é
                   no celular que o Juan mexe nisso. */
                aria-label={`Criar o capítulo ${nome}`}
                onClick={() => executar(criarSecaoAction, { nome }, undefined, { tipo: "criar", nome })}
                /* `min-h-9` (36 px), e não os ~26 px que o texto pediria: no
                   celular as fichas ficam lado a lado e errar a vizinha CRIA
                   CAPÍTULO — é a reclamação do Juan de novo, em escala menor. */
                className="inline-flex min-h-9 items-center rounded-full border border-linha px-3 text-xs text-texto-soft transition hover:border-linha-forte hover:bg-carbon-2 disabled:opacity-40"
              >
                + {nome}
              </button>
            ))}
        </div>
      )}

      {/*
        ── A SAÍDA DE QUEM JÁ CLICOU ERRADO ─────────────────────────────────

        Felipe: "ou tenha a opção de apagar todos os capítulos". Fechar a porta
        de entrada do acidente não conserta quem já está com seis capítulos
        dentro — apagar um por um são seis confirmações e seis recarregamentos.

        DOIS TEMPOS, e não um. Um clique só aqui seria trocar o acidente de
        criar seis pelo acidente de apagar seis, que é pior: os capítulos
        criados sem querer estão vazios, e os apagados sem querer podem estar
        cheios. O segundo tempo diz o número e diz para onde as fotos vão —
        nenhuma some, `secao_id` é `on delete set null` desde a migração 003.
      */}
      {temCapitulos &&
        (confirmandoTudo ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2">
            {/*
              O NÚMERO DE FOTOS É O QUE SEPARA OS DOIS CASOS.

              Capítulos vazios são o acidente que esta porta existe para
              desfazer; capítulos cheios são trabalho de organização feito à
              mão. A frase muda de tom entre um e outro porque quem lê precisa
              saber em qual dos dois está antes de clicar.
            */}
            <span className="text-xs text-texto-soft">
              Apagar {secoes.length} {secoes.length === 1 ? "capítulo" : "capítulos"}?{" "}
              {fotosEmCapitulos === 0
                ? secoes.length === 1
                  ? "Ele está vazio, nenhuma foto é tocada."
                  : "Estão todos vazios, nenhuma foto é tocada."
                : fotosEmCapitulos === 1
                  ? `A foto ${secoes.length === 1 ? "dele" : "deles"} não some — volta para “${nomeDoGrupoSolto(grupoSolto)}”.`
                  : `As ${fotosEmCapitulos} fotos ${secoes.length === 1 ? "dele" : "deles"} não somem — voltam para “${nomeDoGrupoSolto(grupoSolto)}”.`}
            </span>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => {
                executar(apagarTodosOsCapitulosAction, {}, undefined, { tipo: "apagarTodos" });
                setConfirmandoTudo(false);
              }}
              className="rounded-lg border border-alerta/60 px-3 py-1 text-xs text-alerta transition hover:bg-alerta/15 disabled:opacity-40"
            >
              Apagar todos
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoTudo(false)}
              className="text-xs text-texto-soft underline underline-offset-4 transition hover:text-texto"
            >
              cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => setConfirmandoTudo(true)}
            className="mt-3 text-xs text-texto-faint underline underline-offset-4 transition hover:text-texto disabled:opacity-40"
          >
            apagar todos os capítulos
          </button>
        ))}

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
