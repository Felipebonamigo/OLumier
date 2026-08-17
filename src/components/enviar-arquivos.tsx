"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Situacao = "esperando" | "enviando" | "pronto" | "erro";

interface ItemFila {
  id: string;
  nome: string;
  bytes: number;
  progresso: number;
  situacao: Situacao;
  erro?: string;
}

/**
 * Envia o arquivo direto para o bucket com XMLHttpRequest.
 * O `fetch` seria mais moderno, mas não reporta progresso de upload — e para
 * arquivo grande, barra de progresso não é enfeite: sem ela o usuário acha que
 * travou e recarrega a página no meio.
 */
function enviarComProgresso(url: string, arquivo: File, aoProgredir: (pct: number) => void) {
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

export function EnviarArquivos({ galeriaId }: { galeriaId: string }) {
  const [fila, setFila] = useState<ItemFila[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const atualizar = (id: string, mudanca: Partial<ItemFila>) =>
    setFila((f) => f.map((i) => (i.id === id ? { ...i, ...mudanca } : i)));

  const processar = useCallback(
    async (arquivos: File[]) => {
      if (arquivos.length === 0) return;

      const novos: ItemFila[] = arquivos.map((a, i) => ({
        id: `${Date.now()}-${i}-${a.name}`,
        nome: a.name,
        bytes: a.size,
        progresso: 0,
        situacao: "esperando",
      }));
      setFila((f) => [...f, ...novos]);

      // Um de cada vez, de propósito: envio em paralelo satura o link de subida
      // (que é bem menor que o de descida) e deixa cada arquivo mais lento.
      for (let i = 0; i < arquivos.length; i++) {
        const arquivo = arquivos[i];
        const item = novos[i];
        try {
          atualizar(item.id, { situacao: "enviando" });

          const preparo = await fetch(`/api/galerias/${galeriaId}/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome: arquivo.name, mime: arquivo.type, bytes: arquivo.size }),
          });
          const dados = await preparo.json();
          if (!preparo.ok) throw new Error(dados.erro ?? "não foi possível preparar o envio");

          await enviarComProgresso(dados.url, arquivo, (pct) =>
            atualizar(item.id, { progresso: pct }),
          );

          const confirmacao = await fetch(`/api/medias/${dados.mediaId}/confirmar`, {
            method: "POST",
          });
          if (!confirmacao.ok) {
            const c = await confirmacao.json();
            throw new Error(c.erro ?? "o arquivo não foi confirmado");
          }

          atualizar(item.id, { situacao: "pronto", progresso: 100 });
        } catch (e) {
          atualizar(item.id, {
            situacao: "erro",
            erro: e instanceof Error ? e.message : "falhou",
          });
        }
      }

      // Recarrega a grade e a barra de espaço com os dados do servidor.
      startTransition(() => router.refresh());
    },
    [galeriaId, router],
  );

  const enviados = fila.filter((i) => i.situacao === "pronto").length;
  const comErro = fila.filter((i) => i.situacao === "erro");
  const emAndamento = fila.some((i) => i.situacao === "enviando" || i.situacao === "esperando");

  return (
    <section className="mt-8">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          processar(Array.from(e.dataTransfer.files));
        }}
        className={`rounded-xl border border-dashed px-6 py-12 text-center transition ${
          arrastando ? "border-luz bg-luz/5" : "border-linha-forte bg-carbon"
        }`}
      >
        <p className="text-base font-medium">Arraste as fotos e o filme aqui</p>
        <p className="mx-auto mt-2 max-w-[44ch] text-sm text-texto-soft">
          Vão direto do seu navegador para o armazenamento — sem passar pelo nosso servidor.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-5 rounded-lg bg-luz px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-luz-alta"
        >
          Escolher arquivos
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => {
            processar(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <p className="mt-4 text-xs text-texto-faint">
          JPG, PNG, WEBP, HEIC · MP4, MOV, WEBM · até 5 GB por arquivo
        </p>
      </div>

      {fila.length > 0 && (
        <div className="mt-4 rounded-xl border border-linha bg-carbon p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">
              {emAndamento ? "Enviando…" : "Envio concluído"}
            </span>
            <span className="text-xs text-texto-soft tabular-nums">
              {enviados} de {fila.length}
              {comErro.length > 0 ? ` · ${comErro.length} com erro` : ""}
            </span>
          </div>

          <ul className="mt-3 flex flex-col gap-2">
            {fila.map((item) => (
              <li key={item.id} className="text-xs">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate">{item.nome}</span>
                  <span className="shrink-0 tabular-nums text-texto-faint">
                    {item.situacao === "erro" ? (
                      <span className="text-erro">{item.erro}</span>
                    ) : item.situacao === "pronto" ? (
                      <span className="text-ok">enviado</span>
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
        </div>
      )}
    </section>
  );
}
