"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gerarDerivadas } from "@/lib/derivadas-client";
import { enviarEmPartes } from "@/lib/multipart-client";
import {
  PARALELOS,
  arquivosDeArrasto,
  arquivoAceito,
  comRetentativa,
  emParalelo,
  manterAcordado,
  ordenarNatural,
} from "@/lib/fila-upload";

type Situacao = "esperando" | "preparando" | "enviando" | "pronto" | "erro";

interface ItemFila {
  id: string;
  nome: string;
  bytes: number;
  progresso: number;
  situacao: Situacao;
  tentativa: number;
  erro?: string;
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
}: {
  galeriaId: string;
  secoes: SecaoDestino[];
}) {
  const [fila, setFila] = useState<ItemFila[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [destino, setDestino] = useState("");
  const [inicio, setInicio] = useState<number | null>(null);
  const [agora, setAgora] = useState(Date.now());
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
    async (brutos: File[]) => {
      const arquivos = ordenarNatural(brutos.filter(arquivoAceito));
      if (arquivos.length === 0) return;

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

      const soltar = await manterAcordado();

      // Vários ao mesmo tempo: um por vez faria 600 fotos levarem horas.
      await emParalelo(arquivos, PARALELOS, async (arquivo, i) => {
        const item = novos[i];
        try {
          await comRetentativa(
            async () => {
              atualizar(item.id, { situacao: "preparando", progresso: 0 });
              const derivadas = await gerarDerivadas(arquivo);

              atualizar(item.id, { situacao: "enviando" });
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
                  secaoId: destino || undefined,
                }),
              });
              const dados = await preparo.json();
              if (!preparo.ok) {
                // Sem espaço, tipo recusado ou arquivo grande demais: insistir não resolve.
                if (preparo.status === 507 || preparo.status === 415 || preparo.status === 413) {
                  throw Object.assign(new Error(dados.erro), { definitivo: true });
                }
                throw new Error(dados.erro ?? "não foi possível preparar o envio");
              }

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

              // Derivadas juntas: somam ~5% do original e não travam a fila se falharem.
              if (derivadas && dados.urlThumb && dados.urlPreview) {
                await Promise.allSettled([
                  enviarComProgresso(dados.urlThumb, derivadas.thumb, () => {}),
                  enviarComProgresso(dados.urlPreview, derivadas.preview, () => {}),
                ]);
              }

              // O envio em partes já se confirma ao fechar; o simples precisa deste passo.
              if (!dados.emPartes) {
                const conf = await fetch(`/api/medias/${dados.mediaId}/confirmar`, { method: "POST" });
                if (!conf.ok) {
                  const c = await conf.json();
                  throw new Error(c.erro ?? "o arquivo não foi confirmado");
                }
              }
            },
            (tentativa) => atualizar(item.id, { tentativa, situacao: "esperando", progresso: 0 }),
          );

          atualizar(item.id, { situacao: "pronto", progresso: 100 });
        } catch (e) {
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
    [galeriaId, destino, router],
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
            className="rounded-lg border border-linha bg-void px-3 py-1.5 text-sm focus:border-luz focus:outline-none disabled:opacity-50"
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
          arrastando ? "border-luz bg-luz/5" : "border-linha-forte bg-carbon"
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
            className="rounded-lg bg-luz px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-luz-alta"
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
            processar([...(e.target.files ?? [])]);
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
            processar([...(e.target.files ?? [])]);
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
              className="h-full rounded-full bg-luz transition-[width]"
              style={{ width: `${fila.length ? (enviados / fila.length) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-texto-faint">
            {formatar(bytesEnviados)} enviados
            {rodando && " · mantenha esta aba aberta"}
          </p>

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
                      <span className="text-ok">enviado</span>
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
                          : "bg-luz"
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
