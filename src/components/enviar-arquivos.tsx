"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gerarDerivadas } from "@/lib/derivadas-client";
import type { RostoMedido } from "@/lib/rostos-client";
import { enviarEmPartes } from "@/lib/multipart-client";
import {
  PARALELOS,
  type ArquivoComCaminho,
  arquivosDeArrasto,
  arquivoAceito,
  comCaminhoDoInput,
  comRetentativa,
  emParalelo,
  manterAcordado,
  ordenarNaturalPorCaminho,
} from "@/lib/fila-upload";
import { capitulosDaPasta } from "@/lib/capitulos-pasta";
import { garantirSecoesAction } from "@/app/painel/actions";

type Situacao = "esperando" | "preparando" | "enviando" | "pronto" | "erro";

interface ItemFila {
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

export interface SecaoDestino {
  id: string;
  nome: string;
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

const duracao = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};

export function EnviarArquivos({
  galeriaId,
  secoes,
  rostosAtivos,
}: {
  galeriaId: string;
  secoes: SecaoDestino[];
  /** A busca por rosto está ligada: cada foto é medida durante o envio. */
  rostosAtivos: boolean;
}) {
  const [fila, setFila] = useState<ItemFila[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [destino, setDestino] = useState("");
  const [avisoRostos, setAvisoRostos] = useState<string | null>(null);
  const [inicio, setInicio] = useState<number | null>(null);
  /* Começa em 0, não em Date.now(): ler o relógio durante a renderização é
   * impuro (o servidor e o cliente leem instantes diferentes) e o valor era
   * lixo de qualquer forma — só serve depois que a fila começa, e é lá que ele
   * é acertado, junto com `inicio`. */
  const [agora, setAgora] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pastaRef = useRef<HTMLInputElement>(null);
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

  const processar = useCallback(
    async (brutos: ArquivoComCaminho[]) => {
      const itens = ordenarNaturalPorCaminho(brutos.filter((b) => arquivoAceito(b.arquivo)));
      if (itens.length === 0) return;

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
       * "ainda não medidas" do painel. Perder a busca é chato; perder o
       * casamento inteiro por causa dela seria inaceitável.
       */
      let medidor: ((bitmap: ImageBitmap) => Promise<RostoMedido[]>) | undefined;
      if (rostosAtivos) {
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
      await emParalelo(arquivos, PARALELOS, async (arquivo, i) => {
        const item = novos[i];

        /*
         * O preparo acontece UMA vez, mesmo com várias tentativas.
         *
         * Antes ele estava dentro do `comRetentativa`: uma queda de rede durante
         * o envio fazia a tentativa seguinte chamar /upload de novo e nascer uma
         * SEGUNDA linha em `medias`. A primeira ficava pendente para sempre,
         * segurando espaço da quota por um arquivo que nunca existiu — e o dono
         * não tinha como ver nem soltar isso pelo painel.
         */
        // União discriminada em vez de campos opcionais: `url` só existe no
        // envio simples e `tamanhoParte` só no envio em partes. Assim o
        // compilador cobra a checagem do `emPartes` antes de usar cada um.
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
                    /* A pasta manda: o capítulo lido do disco vence o seletor da
                     * tela, que é o palpite para quem soltou arquivos soltos. */
                    secaoId: porCaminho.get(itens[i].caminho) || destino || undefined,
                    // A ordem que o fotógrafo escolheu é a narrativa do casamento.
                    indice: i,
                  }),
                });
                const corpo = await preparo.json();
                if (!preparo.ok) {
                  // Sem espaço, tipo recusado ou grande demais: insistir não resolve.
                  if (preparo.status === 507 || preparo.status === 415 || preparo.status === 413) {
                    throw Object.assign(new Error(corpo.erro), { definitivo: true });
                  }
                  throw new Error(corpo.erro ?? "não foi possível preparar o envio");
                }
                preparado = corpo;
              }
              const dados = preparado!;

              /*
               * As DERIVADAS sobem JUNTO com o original, não depois dele.
               *
               * Medido em 03/09/2026, seis fotos de 6 MB: o PUT do original
               * levava 1,2 s e o par de derivadas, enfileirado atrás dele,
               * mais 0,8 s — para 300 KB. Não é banda, é latência: cada PUT
               * paga a ida e volta até o bucket, e esperar o original acabar
               * para pagá-la é pagar em série o que cabe em paralelo. Agora a
               * ida e volta das derivadas some debaixo da transferência do
               * original.
               *
               * Continuam não travando a fila se falharem: o confirmar anula a
               * derivada que não chegou e a grade cai no original.
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
                const conf = await fetch(`/api/medias/${dados.mediaId}/confirmar`, { method: "POST" });
                if (!conf.ok) {
                  const c = await conf.json();
                  throw new Error(c.erro ?? "o arquivo não foi confirmado");
                }
              }

              /*
               * Os rostos sobem DEPOIS da confirmação e fora da retentativa: a
               * foto já está entregue, e falhar aqui não pode desfazê-la. Vai
               * mesmo com lista vazia — é o que tira a foto da fila de
               * "ainda não medidas".
               *
               * A medição começou lá atrás, junto com as derivadas, e correu
               * na placa de vídeo ENQUANTO o arquivo subia. Aqui só se espera
               * o resultado — que quase sempre já está pronto.
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
           * preso até a limpeza diária passar. Quem acabou de ver um envio
           * falhar costuma tentar de novo no minuto seguinte — e encontrar
           * "sem espaço" por causa da tentativa anterior seria absurdo.
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
      });

      soltar();
      setRodando(false);
      router.refresh();
    },
    [galeriaId, destino, router, rostosAtivos],
  );

  const enviados = fila.filter((i) => i.situacao === "pronto").length;
  const comErro = fila.filter((i) => i.situacao === "erro");
  const restantes = fila.length - enviados - comErro.length;
  const bytesEnviados = fila
    .filter((i) => i.situacao === "pronto")
    .reduce((s, i) => s + i.bytes, 0);

  // Estimativa pela média já observada — mais honesta que fingir precisão.
  const decorrido = inicio ? agora - inicio : 0;
  const restante =
    enviados >= 2 && restantes > 0 ? duracao((decorrido / enviados) * restantes) : null;

  return (
    <section className="mt-8">
      {secoes.length > 0 && (
        <label className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-texto-soft">Enviar para o capítulo:</span>
          <select
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            disabled={rodando}
            className="rounded-lg border border-linha bg-void px-3 py-1.5 text-sm focus:border-acento focus:outline-none disabled:opacity-50"
          >
            <option value="">— sem capítulo —</option>
            {secoes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
          <span className="text-xs text-texto-faint">dá para mover depois</span>
        </label>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setArrastando(false);
          processar(await arquivosDeArrasto(e.dataTransfer));
        }}
        className={`rounded-xl border border-dashed px-6 py-12 text-center transition ${
          arrastando ? "border-acento bg-acento/5" : "border-linha-forte bg-carbon"
        }`}
      >
        <p className="text-base font-medium">Arraste a pasta do casamento aqui</p>
        <p className="mx-auto mt-2 max-w-[46ch] text-sm text-texto-soft">
          Pode ser a pasta inteira, com subpastas. Os arquivos vão direto do seu navegador para o
          armazenamento — sem passar pelo nosso servidor.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => pastaRef.current?.click()}
            className="rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto"
          >
            Escolher pasta
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-linha-forte px-4 py-2.5 text-sm transition hover:bg-carbon-2"
          >
            Escolher arquivos
          </button>
        </div>

        <input
          ref={pastaRef}
          type="file"
          multiple
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          className="hidden"
          onChange={(e) => {
            processar([...(e.target.files ?? [])].map(comCaminhoDoInput));
            e.target.value = "";
          }}
        />
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => {
            processar([...(e.target.files ?? [])].map(comCaminhoDoInput));
            e.target.value = "";
          }}
        />

        <p className="mt-4 text-xs text-texto-faint">
          JPG, PNG, WEBP, HEIC · MP4, MOV, WEBM · filmes de até 100 GB · {PARALELOS} de cada vez
        </p>
      </div>

      {fila.length > 0 && (
        <div className="mt-4 rounded-xl border border-linha bg-carbon p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {rodando
                ? "Enviando…"
                : comErro.length > 0
                  ? "Envio concluído com falhas"
                  : "Envio concluído"}
            </span>
            <span className="text-xs tabular-nums text-texto-soft">
              {enviados} de {fila.length}
              {comErro.length > 0 ? ` · ${comErro.length} com erro` : ""}
              {restante ? ` · ~${restante} restantes` : ""}
            </span>
          </div>

          {/* Progresso do conjunto: numa fila de 600, o total importa mais que cada linha. */}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-carbon-2">
            <div
              className="h-full rounded-full bg-acento transition-[width]"
              style={{ width: `${fila.length ? (enviados / fila.length) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-texto-faint">
            {formatar(bytesEnviados)} enviados
            {rodando && " · mantenha esta aba aberta"}
          </p>
          {avisoRostos && <p className="mt-1.5 text-[11px] text-alerta">{avisoRostos}</p>}

          {/* Lista com altura limitada: sem isso, 600 itens esticariam a página sem fim. */}
          <ul className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
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
                      `${item.progresso}% · ${formatar(item.bytes)}`
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

          {!rodando && comErro.length > 0 && (
            <button
              type="button"
              onClick={() => setFila((f) => f.filter((i) => i.situacao !== "erro"))}
              className="mt-3 rounded-lg border border-linha px-3 py-1.5 text-xs text-texto-soft transition hover:bg-carbon-2"
            >
              Limpar os que falharam
            </button>
          )}
        </div>
      )}
    </section>
  );
}
