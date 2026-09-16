"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { gerarDerivadas } from "@/lib/derivadas-client";
import type { RostoMedido } from "@/lib/rostos-client";
import { enviarEmPartes } from "@/lib/multipart-client";
import {
  PARALELOS,
  type ArquivoComCaminho,
  comRetentativa,
  emParalelo,
  manterAcordado,
  ordenarNaturalPorCaminho,
  arquivoAceito,
} from "@/lib/fila-upload";
import { capitulosDaPasta } from "@/lib/capitulos-pasta";
import { garantirSecoesAction } from "@/app/painel/actions";

/**
 * O ENVIO QUE SOBREVIVE À TROCA DE ABA.
 *
 * ── O EPISÓDIO ────────────────────────────────────────────────────────────
 *
 * 05/09/2026, Juan: "botei as fotos aqui e fui pro design, daí parou de subir
 * as fotos". Ele estava certo, e a causa era estrutural: a fila morava dentro
 * de `EnviarArquivos`, que é um componente da rota `/fotos`. Trocar para
 * `/design` DESMONTA a árvore daquela rota — e com ela o estado da fila, os
 * XMLHttpRequest em voo e o `manterAcordado`. Não era bug de lógica; era o
 * lugar errado.
 *
 * Ele descreveu a saída junto com a queixa: "no pixieset ele abre um tiquinho
 * ali embaixo que, independente da aba que eu tô mexendo, ele continua subindo
 * as fotos".
 *
 * ── POR QUE O LAYOUT RESOLVE ──────────────────────────────────────────────
 *
 * No App Router, o layout de `/painel/galerias/[id]` NÃO é remontado quando se
 * navega entre as quatro abas filhas — só o `children` troca. Um provedor
 * montado lá é exatamente o que continua vivo enquanto a pessoa vai para o
 * Design. A barra flutuante é filha dele, então aparece em qualquer aba.
 *
 * O componente da aba Fotos vira só a zona de arrastar: ele empurra os
 * arquivos para cá e não guarda estado de envio nenhum. É a razão de este
 * arquivo existir separado — se a fila voltar para dentro da aba, o defeito
 * volta junto, e `testar-upload.mjs` pergunta por isso.
 *
 * ── O QUE ISTO NÃO RESOLVE ────────────────────────────────────────────────
 *
 * Sair da galeria (ir para `/painel`, fechar a aba) continua matando o envio —
 * o `beforeunload` avisa, e é o que dá para prometer sem um Service Worker.
 * Enquanto a pessoa estiver DENTRO da galeria, o envio segue.
 */

type Situacao = "esperando" | "preparando" | "enviando" | "pronto" | "erro";

export interface ItemFila {
  id: string;
  nome: string;
  bytes: number;
  progresso: number;
  situacao: Situacao;
  tentativa: number;
  erro?: string;
  /** Quantos rostos a busca por rosto guardou desta foto. */
  rostos?: number;
}

export interface OpcoesDeEnvio {
  /** Capítulo escolhido na tela, para os arquivos soltos (a pasta vence este). */
  destino?: string;
  /** A busca por rosto está ligada: cada foto é medida durante o envio. */
  rostosAtivos: boolean;
}

interface Envio {
  fila: ItemFila[];
  rodando: boolean;
  pausado: boolean;
  avisoRostos: string | null;
  enfileirar: (itens: ArquivoComCaminho[], opcoes: OpcoesDeEnvio) => void;
  pausar: () => void;
  retomar: () => void;
  parar: () => void;
  limparConcluidos: () => void;
}

const Contexto = createContext<Envio | null>(null);

/** A fila desta galeria. Fora do provedor não existe envio — e isso é um erro. */
export function useEnvio(): Envio {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useEnvio fora do ProvedorDeEnvio");
  return ctx;
}

/**
 * Envia o arquivo direto para o bucket com XMLHttpRequest.
 * O `fetch` seria mais moderno, mas não reporta progresso de upload — e para
 * arquivo grande, barra de progresso não é enfeite: sem ela o usuário acha que
 * travou e recarrega a página no meio.
 */
function enviarComProgresso(url: string, arquivo: Blob, aoProgredir: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", arquivo.type);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) aoProgredir(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`falha no envio (HTTP ${xhr.status})`)),
    );
    xhr.addEventListener("error", () => reject(new Error("conexão interrompida")));
    xhr.addEventListener("abort", () => reject(new Error("envio cancelado")));
    xhr.send(arquivo);
  });
}

export const formatarBytesCurto = (b: number) => {
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

const duracao = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};

export function ProvedorDeEnvio({
  galeriaId,
  children,
}: {
  galeriaId: string;
  children: React.ReactNode;
}) {
  const [fila, setFila] = useState<ItemFila[]>([]);
  const [rodando, setRodando] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [avisoRostos, setAvisoRostos] = useState<string | null>(null);
  const [inicio, setInicio] = useState<number | null>(null);
  /* Começa em 0, não em Date.now(): ler o relógio durante a renderização é
   * impuro (o servidor e o cliente leem instantes diferentes) e o valor era
   * lixo de qualquer forma — só serve depois que a fila começa. */
  const [agora, setAgora] = useState(0);

  /*
   * Pausa e parada vivem em `ref`, não em estado, e a razão é o portão.
   *
   * O portão é uma função criada UMA vez, quando a fila começa; se ela lesse
   * `pausado` do estado, leria o valor congelado daquele instante e o botão não
   * teria efeito nenhum sobre uma fila já em andamento. A `ref` é a mesma caixa
   * do começo ao fim. O estado existe em paralelo só para a tela redesenhar.
   */
  const pausadoRef = useRef(false);
  const paradoRef = useRef(false);
  const router = useRouter();

  const atualizar = (id: string, mudanca: Partial<ItemFila>) =>
    setFila((f) => f.map((i) => (i.id === id ? { ...i, ...mudanca } : i)));

  // Relógio só enquanto a fila roda — alimenta a estimativa de tempo restante.
  useEffect(() => {
    if (!rodando) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [rodando]);

  // Fechar a aba no meio de 600 fotos perde o que faltava: avisa antes.
  useEffect(() => {
    if (!rodando) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [rodando]);

  const enfileirar = useCallback(
    async (brutos: ArquivoComCaminho[], opcoes: OpcoesDeEnvio) => {
      const itens = ordenarNaturalPorCaminho(brutos.filter((b) => arquivoAceito(b.arquivo)));
      if (itens.length === 0) return;

      paradoRef.current = false;
      pausadoRef.current = false;
      setPausado(false);

      /*
       * A pasta do fotógrafo JÁ está organizada — "01 Making Of", "02 Cerimônia".
       * Ler isso aqui é o que evita ele refazer no painel o que já fez no disco.
       *
       * Acontece antes do primeiro arquivo subir, numa chamada só: descobrir o
       * capítulo arquivo a arquivo seriam centenas de idas ao servidor.
       * Se falhar, o envio segue para o destino escolhido na tela — perder o
       * capítulo é chato, perder o casamento inteiro é inaceitável.
       */
      const porCaminho = new Map<string, string>();
      const capitulos = capitulosDaPasta(itens.map((i) => i.caminho));
      if (capitulos.length > 0) {
        try {
          const criados = await garantirSecoesAction(
            galeriaId,
            capitulos.map((c) => c.nome),
          );
          const idPorNome = new Map(criados.map((c) => [c.nome, c.id]));
          for (const c of capitulos) {
            const id = idPorNome.get(c.nome);
            if (id) for (const caminho of c.caminhos) porCaminho.set(caminho, id);
          }
        } catch {
          // segue sem capítulo; o fotógrafo move depois, e nada se perde
        }
      }

      const arquivos = itens.map((i) => i.arquivo);
      const novos: ItemFila[] = arquivos.map((a, i) => ({
        id: `${Date.now()}-${i}-${a.name}`,
        nome: a.name,
        bytes: a.size,
        progresso: 0,
        situacao: "esperando",
        tentativa: 0,
      }));
      setFila((f) => [...f, ...novos]);
      setRodando(true);
      setInicio((atual) => atual ?? Date.now());
      setAgora(Date.now()); // sem isto, o primeiro segundo mostraria tempo negativo

      const soltar = await manterAcordado();

      /*
       * A BUSCA POR ROSTO entra aqui, e só aqui: com ela ligada, cada foto é
       * medida no ORIGINAL enquanto está aberta para gerar as derivadas. É o
       * único momento em que o original está decodificado no navegador — depois
       * ele mora no B2, e cada byte lido de lá é cobrado.
       *
       * O modelo (12 MB) é baixado uma vez por sessão. Se não carregar (sem
       * WebGL, rede ruim), o envio SEGUE sem medir: a foto entra na fila de
       * "ainda não medidas" do painel.
       */
      let medidor: ((bitmap: ImageBitmap) => Promise<RostoMedido[]>) | undefined;
      if (opcoes.rostosAtivos) {
        try {
          const rostosClient = await import("@/lib/rostos-client");
          await rostosClient.carregarModelos("fotografo");
          medidor = rostosClient.medirRostos;
          setAvisoRostos(
            rostosClient.backendEmUso() === "webgl"
              ? null
              : "Este computador está sem aceleração gráfica: medir os rostos leva uns 12 segundos por foto.",
          );
        } catch {
          setAvisoRostos(
            "Não consegui carregar o reconhecimento de rosto. As fotos sobem normalmente; dá para medi-las depois, em “Busca por rosto”.",
          );
        }
      }

      // Vários ao mesmo tempo: um por vez faria 600 fotos levarem horas.
      await emParalelo(
        arquivos,
        PARALELOS,
        async (arquivo, i) => {
          const item = novos[i];

          /*
           * O preparo acontece UMA vez, mesmo com várias tentativas.
           *
           * Antes ele estava dentro do `comRetentativa`: uma queda de rede durante
           * o envio fazia a tentativa seguinte chamar /upload de novo e nascer uma
           * SEGUNDA linha em `medias`. A primeira ficava pendente para sempre,
           * segurando espaço da quota por um arquivo que nunca existiu.
           */
          type Preparo = { mediaId: string; urlThumb?: string; urlPreview?: string } & (
            | { emPartes: true; tamanhoParte: number }
            | { emPartes: false; url: string }
          );
          let preparado: Preparo | null = null;

          try {
            await comRetentativa(
              async () => {
                atualizar(item.id, { situacao: "preparando", progresso: 0 });
                const derivadas = await gerarDerivadas(arquivo, { medirRostos: medidor });

                atualizar(item.id, { situacao: "enviando" });

                if (!preparado) {
                  const preparo = await fetch(`/api/galerias/${galeriaId}/upload`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      nome: arquivo.name,
                      mime: arquivo.type,
                      bytes: arquivo.size,
                      comDerivadas: Boolean(derivadas),
                      largura: derivadas?.largura,
                      altura: derivadas?.altura,
                      /* A pasta manda: o capítulo lido do disco vence o seletor
                       * da tela, que é o palpite para arquivos soltos. */
                      secaoId: porCaminho.get(itens[i].caminho) || opcoes.destino || undefined,
                      // A ordem que o fotógrafo escolheu é a narrativa do casamento.
                      indice: i,
                    }),
                  });
                  const corpo = await preparo.json();
                  if (!preparo.ok) {
                    // Sem espaço, tipo recusado ou grande demais: insistir não resolve.
                    if (
                      preparo.status === 507 ||
                      preparo.status === 415 ||
                      preparo.status === 413
                    ) {
                      throw Object.assign(new Error(corpo.erro), { definitivo: true });
                    }
                    throw new Error(corpo.erro ?? "não foi possível preparar o envio");
                  }
                  preparado = corpo;
                }
                const dados = preparado!;

                /*
                 * As DERIVADAS sobem JUNTO com o original, não depois dele.
                 * Medido em 03/09/2026: enfileirá-las atrás do original custava
                 * 0,8 s por foto para 300 KB. Não é banda, é latência.
                 */
                const derivadasSubindo =
                  derivadas && dados.urlThumb && dados.urlPreview
                    ? Promise.allSettled([
                        enviarComProgresso(dados.urlThumb, derivadas.thumb, () => {}),
                        enviarComProgresso(dados.urlPreview, derivadas.preview, () => {}),
                      ])
                    : Promise.resolve();

                // Arquivo grande (filme 4K) vai em partes; o resto num envio só.
                if (dados.emPartes) {
                  await enviarEmPartes(dados.mediaId, arquivo, dados.tamanhoParte, (pct) =>
                    atualizar(item.id, { progresso: pct }),
                  );
                } else {
                  await enviarComProgresso(dados.url, arquivo, (pct) =>
                    atualizar(item.id, { progresso: pct }),
                  );
                }
                await derivadasSubindo;

                // O envio em partes já se confirma ao fechar; o simples precisa deste passo.
                if (!dados.emPartes) {
                  const conf = await fetch(`/api/medias/${dados.mediaId}/confirmar`, {
                    method: "POST",
                  });
                  if (!conf.ok) {
                    const c = await conf.json();
                    throw new Error(c.erro ?? "o arquivo não foi confirmado");
                  }
                }

                /*
                 * Os rostos sobem DEPOIS da confirmação e fora da retentativa: a
                 * foto já está entregue, e falhar aqui não pode desfazê-la.
                 */
                if (medidor && derivadas?.rostos) {
                  const rostos = await derivadas.rostos.catch(() => null);
                  if (rostos) {
                    const r = await fetch(`/api/medias/${dados.mediaId}/rostos`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ rostos }),
                    }).catch(() => null);
                    if (r?.ok) {
                      const { salvos } = (await r.json()) as { salvos: number };
                      atualizar(item.id, { rostos: salvos });
                    }
                  }
                }
              },
              (tentativa) => atualizar(item.id, { tentativa, situacao: "esperando", progresso: 0 }),
            );

            atualizar(item.id, { situacao: "pronto", progresso: 100 });
          } catch (e) {
            /*
             * Desistiu de vez: solta a reserva agora em vez de deixar o espaço
             * preso até a limpeza diária passar.
             */
            const p = preparado as { mediaId: string; emPartes: boolean } | null;
            if (p?.mediaId) {
              const rota = p.emPartes
                ? `/api/medias/${p.mediaId}/partes`
                : `/api/medias/${p.mediaId}/confirmar`;
              await fetch(rota, { method: "DELETE" }).catch(() => {});
            }
            atualizar(item.id, {
              situacao: "erro",
              erro: e instanceof Error ? e.message : "falhou",
            });
          }
        },
        async () => (paradoRef.current ? "parar" : pausadoRef.current ? "esperar" : "seguir"),
      );

      soltar();
      setRodando(false);
      setPausado(false);
      /* O que ficou em "esperando" quando alguém parou não vai subir: dizer isso
         é melhor que deixar a linha girando para sempre. */
      if (paradoRef.current) {
        setFila((f) =>
          f.map((i) =>
            i.situacao === "esperando" || i.situacao === "preparando" || i.situacao === "enviando"
              ? { ...i, situacao: "erro", erro: "parado por você" }
              : i,
          ),
        );
      }
      router.refresh();
    },
    [galeriaId, router],
  );

  const valor = useMemo<Envio>(
    () => ({
      fila,
      rodando,
      pausado,
      avisoRostos,
      enfileirar: (itens, opcoes) => void enfileirar(itens, opcoes),
      pausar: () => {
        pausadoRef.current = true;
        setPausado(true);
      },
      retomar: () => {
        pausadoRef.current = false;
        setPausado(false);
      },
      parar: () => {
        paradoRef.current = true;
        pausadoRef.current = false;
        setPausado(false);
      },
      limparConcluidos: () => setFila([]),
    }),
    [fila, rodando, pausado, avisoRostos, enfileirar],
  );

  const enviados = fila.filter((i) => i.situacao === "pronto").length;
  const comErro = fila.filter((i) => i.situacao === "erro").length;
  const restantes = fila.length - enviados - comErro;
  const decorrido = inicio ? agora - inicio : 0;
  const restante =
    enviados >= 2 && restantes > 0 ? duracao((decorrido / enviados) * restantes) : null;

  return (
    <Contexto.Provider value={valor}>
      {children}
      {/*
        O ESPAÇADOR QUE DEVOLVE O FIM DA PÁGINA.

        Felipe, 16/09/2026, com a foto: "a barra do rodapé tá em cima do botão".
        Ele estava no fim da aba de Entrega, e o "Apagar galeria" desaparecia
        sob a barra de envio.

        É o preço do `fixed`: a barra sai do fluxo, e o navegador termina a
        página como se ela não existisse. A resposta é reservar em BAIXO o
        espaço que ela ocupa — um bloco vazio no fluxo, irmão do conteúdo.

        A altura é a da barra RECOLHIDA, que é como ela passa a maior parte do
        tempo. Aberta ela cresce, mas aí a pessoa está olhando para a lista de
        arquivos, não para o pé da página; reservar a altura máxima deixaria um
        buraco permanente embaixo de toda tela durante o envio inteiro.

        `aria-hidden` porque não há nada para ler aqui: quem usa leitor de tela
        não tem barra por cima de botão nenhum.
      */}
      {fila.length > 0 && <div aria-hidden className="h-16" />}
      {fila.length > 0 && (
        <BarraDeEnvio
          fila={fila}
          enviados={enviados}
          comErro={comErro}
          restante={restante}
          rodando={rodando}
          pausado={pausado}
          aoPausar={valor.pausar}
          aoRetomar={valor.retomar}
          aoParar={valor.parar}
          aoLimpar={valor.limparConcluidos}
        />
      )}
    </Contexto.Provider>
  );
}

/**
 * A barra de baixo — "o tiquinho ali embaixo" do Pixieset.
 *
 * `fixed`, e não um bloco na página: ela precisa estar visível no Design e na
 * Entrega, onde a página é outra. Recolhida por padrão porque o normal é a
 * pessoa estar fazendo outra coisa — é uma barra de status, não uma tela.
 */
function BarraDeEnvio({
  fila,
  enviados,
  comErro,
  restante,
  rodando,
  pausado,
  aoPausar,
  aoRetomar,
  aoParar,
  aoLimpar,
}: {
  fila: ItemFila[];
  enviados: number;
  comErro: number;
  restante: string | null;
  rodando: boolean;
  pausado: boolean;
  aoPausar: () => void;
  aoRetomar: () => void;
  aoParar: () => void;
  aoLimpar: () => void;
}) {
  const [aberta, setAberta] = useState(false);
  const pct = fila.length ? (enviados / fila.length) * 100 : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-linha bg-carbon/95 backdrop-blur">
      <div className="mx-auto max-w-5xl px-6 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => setAberta((v) => !v)}
            aria-expanded={aberta}
            className="flex items-center gap-2 text-sm font-medium transition hover:text-acento"
          >
            <span aria-hidden className="text-texto-faint">
              {aberta ? "▾" : "▸"}
            </span>
            {rodando
              ? pausado
                ? "Envio pausado"
                : "Enviando…"
              : comErro > 0
                ? "Envio concluído com falhas"
                : "Envio concluído"}
          </button>

          <span className="text-xs tabular-nums text-texto-soft">
            {enviados} de {fila.length}
            {comErro > 0 ? ` · ${comErro} com erro` : ""}
            {restante ? ` · ~${restante} restantes` : ""}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {rodando ? (
              <>
                <button
                  type="button"
                  onClick={pausado ? aoRetomar : aoPausar}
                  className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon-2"
                >
                  {pausado ? "Continuar" : "Pausar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Parar o envio? O que ainda não subiu não vai subir.")) aoParar();
                  }}
                  className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs text-alerta transition hover:bg-carbon-2"
                >
                  Parar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={aoLimpar}
                className="rounded-lg border border-linha px-3 py-1.5 text-xs text-texto-soft transition hover:bg-carbon-2"
              >
                Fechar
              </button>
            )}
          </div>
        </div>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-carbon-2">
          <div
            className={`h-full rounded-full transition-[width] ${pausado ? "bg-alerta" : "bg-acento"}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {aberta && (
          <ul className="mt-2.5 flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
            {fila.map((item) => (
              <li key={item.id} className="text-xs">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate">{item.nome}</span>
                  <span className="shrink-0 tabular-nums text-texto-faint">
                    {item.situacao === "erro" ? (
                      <span className="text-erro">{item.erro}</span>
                    ) : item.situacao === "pronto" ? (
                      <span className="text-ok">
                        enviado
                        {item.rostos !== undefined &&
                          ` · ${item.rostos} ${item.rostos === 1 ? "rosto" : "rostos"}`}
                      </span>
                    ) : item.tentativa > 0 ? (
                      <span className="text-alerta">tentando de novo ({item.tentativa})…</span>
                    ) : item.situacao === "preparando" ? (
                      "preparando…"
                    ) : (
                      `${item.progresso}% · ${formatarBytesCurto(item.bytes)}`
                    )}
                  </span>
                </div>
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-carbon-2">
                  <div
                    className={`h-full transition-[width] ${
                      item.situacao === "erro"
                        ? "bg-erro"
                        : item.situacao === "pronto"
                          ? "bg-ok"
                          : "bg-acento"
                    }`}
                    style={{ width: `${item.situacao === "erro" ? 100 : item.progresso}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
