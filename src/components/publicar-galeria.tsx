"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarPublicacaoAction } from "@/app/painel/actions";

/**
 * Controles de publicação. É aqui que o fotógrafo decide se a galeria está no ar,
 * se pede senha e se permite baixar — e pega o link para mandar no WhatsApp.
 */
export function PublicarGaleria({
  galeriaId,
  caminho,
  publicada,
  temSenha,
  permiteDownload,
}: {
  galeriaId: string;
  caminho: string;
  publicada: boolean;
  temSenha: boolean;
  permiteDownload: boolean;
}) {
  const [copiado, setCopiado] = useState(false);
  const [senha, setSenha] = useState("");
  const [mexeuNaSenha, setMexeuNaSenha] = useState(false);
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  /**
   * O domínio só é conhecido no navegador, mas ler `window` durante a render
   * quebraria a hidratação: o servidor mandaria "/g/..." e o cliente
   * "https://.../g/...", e o React reclamaria da diferença. Então a primeira
   * render (nos dois lados) mostra o caminho, e o domínio entra depois de montar.
   */
  const [origem, setOrigem] = useState("");
  useEffect(() => setOrigem(window.location.origin), []);
  const linkCompleto = origem + caminho;

  function salvar(mudancas: FormData) {
    iniciar(async () => {
      await salvarPublicacaoAction(mudancas);
      setMexeuNaSenha(false);
      setSenha("");
      router.refresh();
    });
  }

  function alternar(campo: "publicada" | "permite_download", valor: boolean) {
    const f = new FormData();
    f.set("galeria_id", galeriaId);
    f.set(campo, valor ? "1" : "0");
    salvar(f);
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(linkCompleto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard bloqueado — o link continua visível na tela */
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <h2 className="text-sm font-semibold">Entrega ao cliente</h2>

      <label className="mt-4 flex items-start gap-3">
        <input
          type="checkbox"
          checked={publicada}
          disabled={salvando}
          onChange={(e) => alternar("publicada", e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[color:var(--luz)]"
        />
        <span>
          <span className="block text-sm font-medium">Galeria no ar</span>
          <span className="block text-xs text-texto-faint">
            Enquanto estiver desligada, o link não abre para ninguém.
          </span>
        </span>
      </label>

      <label className="mt-4 flex items-start gap-3">
        <input
          type="checkbox"
          checked={permiteDownload}
          disabled={salvando}
          onChange={(e) => alternar("permite_download", e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[color:var(--luz)]"
        />
        <span>
          <span className="block text-sm font-medium">Permitir download</span>
          <span className="block text-xs text-texto-faint">
            Sem limite de vezes — não custa nada a mais.
          </span>
        </span>
      </label>

      <div className="mt-5 border-t border-linha pt-5">
        <span className="block text-sm font-medium">
          Senha {temSenha ? <span className="text-xs font-normal text-ok">· definida</span> : null}
        </span>
        <p className="mt-0.5 text-xs text-texto-faint">
          {temSenha
            ? "Para trocar, digite outra. Para tirar, salve com o campo vazio."
            : "Opcional. O link já é secreto; a senha é uma tranca a mais."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="text"
            value={senha}
            onChange={(e) => {
              setSenha(e.target.value);
              setMexeuNaSenha(true);
            }}
            placeholder={temSenha ? "nova senha" : "ex.: anaepedro"}
            className="min-w-0 flex-1 rounded-lg border border-linha bg-void px-3 py-2 text-sm placeholder:text-texto-faint focus:border-luz focus:outline-none"
          />
          <button
            type="button"
            disabled={salvando || !mexeuNaSenha}
            onClick={() => {
              const f = new FormData();
              f.set("galeria_id", galeriaId);
              f.set("senha", senha);
              f.set("mexeu_senha", "1");
              salvar(f);
            }}
            className="rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-40"
          >
            Salvar
          </button>
        </div>
      </div>

      {publicada && (
        <div className="mt-5 border-t border-linha pt-5">
          <span className="block text-sm font-medium">Link do cliente</span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-linha bg-void px-3 py-2 text-xs text-texto-soft">
              {linkCompleto}
            </code>
            <button
              type="button"
              onClick={copiar}
              className="rounded-lg bg-luz px-4 py-2 text-sm font-semibold text-void transition hover:bg-luz-alta"
            >
              {copiado ? "copiado ✓" : "copiar"}
            </button>
            <a
              href={caminho}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2"
            >
              abrir ↗
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
