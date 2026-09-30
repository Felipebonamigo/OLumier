"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Erro } from "@/components/form-ui";
import { FUNDO_ESCURO, LIMITE_LOGO, TIPOS_LOGO, recusaDaLogo } from "@/lib/marca-estudio";
import { prepararLogo } from "@/lib/logo-client";

/**
 * Enviar, ver e tirar a logo do estúdio.
 *
 * SAIU DE DENTRO DO `EditorMarca` em 31/08/2026, e o motivo é a segunda tela que
 * passou a usá-la: criar galeria. A logo é do ESTÚDIO, não da galeria, mas a
 * hora em que a pessoa pensa nela é justamente quando está montando a primeira
 * entrega — e até aqui era preciso abandonar a tarefa, achar a tela de Conta e
 * voltar. Duplicar o bloco resolveria a tela e criaria duas cópias do fluxo de
 * envio (pedir URL, PUT no bucket, confirmar), que envelheceriam separadas.
 *
 * Grava sempre no mesmo lugar: `/api/marca/logo`. Não existe logo por galeria.
 */
export function LogoEstudio({
  nomeEstudio,
  urlLogo,
  /** Texto de apoio. A tela de Conta explica a regra; a de criar galeria, o atalho. */
  nota,
}: {
  nomeEstudio: string;
  /** Link assinado da logo atual, ou null. Expira — serve só para esta tela. */
  urlLogo: string | null;
  nota?: React.ReactNode;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erroLogo, setErroLogo] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function enviarLogo(escolhido: File) {
    // O tipo é conferido antes de abrir a imagem; o TAMANHO, depois de cortar
    // a margem — um PNG de 3 MB com prancheta sobrando pode caber no limite
    // sem ela. A mesma regra do servidor, aplicada aqui só para a resposta ser
    // imediata.
    if (!TIPOS_LOGO[escolhido.type]) {
      setErroLogo(recusaDaLogo(escolhido.type, escolhido.size));
      return;
    }

    setErroLogo(null);
    setEnviando(true);
    try {
      /* A margem vazia sai aqui, e a medida sai junto — ver `lib/logo-client.ts`. */
      const logo = await prepararLogo(escolhido);
      const recusa = recusaDaLogo(logo.mime, logo.arquivo.size);
      if (recusa) throw new Error(recusa);

      const pedido = await fetch("/api/marca/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime: logo.mime, bytes: logo.arquivo.size }),
      });
      const dados = await pedido.json();
      if (!pedido.ok) throw new Error(dados.erro ?? "Não foi possível enviar.");

      const put = await fetch(dados.url, {
        method: "PUT",
        headers: { "Content-Type": logo.mime },
        body: logo.arquivo,
      });
      if (!put.ok) throw new Error("O envio para o armazenamento falhou.");

      const confirma = await fetch("/api/marca/logo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave: dados.chave, largura: logo.largura, altura: logo.altura }),
      });
      const fim = await confirma.json();
      if (!confirma.ok) throw new Error(fim.erro ?? "Não foi possível confirmar.");

      router.refresh();
    } catch (e) {
      setErroLogo(e instanceof Error ? e.message : "Não foi possível enviar a logo.");
    } finally {
      setEnviando(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  async function tirarLogo() {
    if (!confirm("Tirar a logo? A capa volta a mostrar o nome do estúdio em texto.")) return;
    setEnviando(true);
    try {
      await fetch("/api/marca/logo", { method: "DELETE" });
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <span className="block text-sm font-medium">Logo</span>
      {nota && <p className="mt-0.5 text-xs text-texto-faint">{nota}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-4">
        {/* Fundo escuro fixo na miniatura: é onde a logo mais some, então é onde
            vale a pena conferi-la. */}
        <div
          className="flex h-20 w-40 shrink-0 items-center justify-center rounded-lg border border-linha p-3"
          style={{ background: FUNDO_ESCURO }}
        >
          {urlLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- link assinado e temporário: o otimizador do Next não consegue reusar
            <img
              src={urlLogo}
              alt={`Logo de ${nomeEstudio}`}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-center text-[11px] text-texto-faint">sem logo</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={arquivoRef}
            type="file"
            accept={Object.keys(TIPOS_LOGO).join(",")}
            disabled={enviando}
            onChange={(e) => {
              const a = e.target.files?.[0];
              if (a) enviarLogo(a);
            }}
            className="block max-w-full text-xs text-texto-soft file:mr-3 file:rounded-lg file:border file:border-linha-forte file:bg-carbon-2 file:px-3 file:py-2 file:text-xs file:text-texto hover:file:bg-carbon"
          />
          <span className="text-[11px] text-texto-faint">
            PNG, JPG ou WEBP, até {Math.round(LIMITE_LOGO / 1024 / 1024)} MB. Fundo transparente
            (PNG) fica melhor nos temas escuros. A margem vazia em volta é cortada sozinha, e o
            tamanho na capa se ajusta no Design da galeria.
          </span>
          {urlLogo && (
            <button
              type="button"
              onClick={tirarLogo}
              disabled={enviando}
              className="self-start text-xs text-texto-faint underline underline-offset-4 hover:text-erro disabled:opacity-50"
            >
              tirar logo
            </button>
          )}
        </div>
      </div>

      {enviando && <p className="mt-2 text-xs text-texto-faint">Enviando…</p>}
      <div className="mt-2">
        <Erro mensagem={erroLogo ?? undefined} />
      </div>
    </div>
  );
}
