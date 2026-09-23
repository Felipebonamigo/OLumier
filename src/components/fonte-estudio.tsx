"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Erro } from "@/components/form-ui";
import { EXTENSOES_FONTE, LIMITE_FONTE, recusaDaFonte } from "@/lib/fonte-estudio";

/**
 * A fonte própria do estúdio.
 *
 * Mesmo caminho da logo — o navegador manda o arquivo DIRETO ao bucket e o
 * servidor confirma o que chegou. A diferença está na conferência: logo se
 * valida pelo tipo declarado, fonte não. `.ttf` e `.otf` chegam quase sempre
 * como `application/octet-stream`, o mesmo tipo de um .zip enviado por engano;
 * quem decide é a assinatura nos primeiros bytes, lida no servidor.
 */
export function FonteEstudio({
  fonteNome,
}: {
  /** Nome da fonte já enviada, ou null. */
  fonteNome: string | null;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function enviar(arquivo: File) {
    /* A mesma regra do servidor, aqui só para a resposta ser imediata: quem
       escolheu um arquivo de 40 MB merece ouvir não antes de esperar o envio. */
    const recusa = recusaDaFonte(arquivo.size);
    if (recusa) {
      setErro(recusa);
      return;
    }

    setErro(null);
    setEnviando(true);
    try {
      const pedido = await fetch("/api/marca/fonte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bytes: arquivo.size }),
      });
      const dados = await pedido.json();
      if (!pedido.ok) throw new Error(dados.erro ?? "Não foi possível enviar.");

      const put = await fetch(dados.url, {
        method: "PUT",
        /* O mesmo tipo que o POST assinou. O que o navegador acha do arquivo não
           entra aqui: a URL foi assinada com um content-type, e mandar outro faz
           o bucket recusar por assinatura inválida. */
        headers: { "Content-Type": "font/woff2" },
        body: arquivo,
      });
      if (!put.ok) throw new Error("O envio para o armazenamento falhou.");

      const confirma = await fetch("/api/marca/fonte", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave: dados.chave, nome: arquivo.name }),
      });
      const fim = await confirma.json();
      if (!confirma.ok) throw new Error(fim.erro ?? "Não foi possível confirmar.");

      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar a fonte.");
    } finally {
      setEnviando(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  async function tirar() {
    if (!confirm("Tirar a fonte? As galerias que a usam voltam para a fonte serifada.")) return;
    setEnviando(true);
    try {
      await fetch("/api/marca/fonte", { method: "DELETE" });
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-6 border-t border-linha pt-5">
      <span className="block text-sm font-medium">
        Fonte própria{" "}
        {fonteNome ? <span className="text-xs font-normal text-ok">· {fonteNome}</span> : null}
      </span>
      <p className="mt-0.5 text-xs text-texto-faint">
        A tipografia da sua marca no título das galerias. Depois de enviar, ela aparece no seletor
        de fonte de cada galeria como <strong className="text-texto-soft">A minha fonte</strong>.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <input
          ref={arquivoRef}
          type="file"
          accept={EXTENSOES_FONTE}
          disabled={enviando}
          onChange={(e) => {
            const a = e.target.files?.[0];
            if (a) enviar(a);
          }}
          className="block max-w-full text-xs text-texto-soft file:mr-3 file:rounded-lg file:border file:border-linha-forte file:bg-carbon-2 file:px-3 file:py-2 file:text-xs file:text-texto hover:file:bg-carbon"
        />
        <span className="text-[11px] text-texto-faint">
          WOFF2, WOFF, OTF ou TTF, até {Math.round(LIMITE_FONTE / 1024 / 1024)} MB.{" "}
          <strong className="text-texto-soft">WOFF2 é o melhor formato</strong> — pesa uma fração
          do OTF e abre mais rápido no celular do seu cliente.
        </span>

        {/*
          O AVISO DE LICENÇA, e por que ele está aqui e não só nos termos.
          Licença de fonte comercial quase sempre cobre uso em computador
          (Photoshop, Illustrator) e NÃO cobre hospedar o arquivo para servir na
          web — são licenças vendidas separadamente. Quem envia costuma não
          saber disso, e o lugar de avisar é o segundo antes de enviar, não uma
          página de termos que ninguém abre.
        */}
        <span className="text-[11px] text-alerta">
          Confira se a licença da fonte permite uso na web. A maioria das fontes pagas cobre só o
          uso no computador, e a licença web é vendida à parte — a responsabilidade pelo direito de
          uso é de quem envia.
        </span>

        {fonteNome && (
          <button
            type="button"
            onClick={tirar}
            disabled={enviando}
            className="self-start text-xs text-texto-faint underline underline-offset-4 hover:text-erro disabled:opacity-50"
          >
            tirar fonte
          </button>
        )}
      </div>

      {enviando && <p className="mt-2 text-xs text-texto-faint">Enviando…</p>}
      <div className="mt-2">
        <Erro mensagem={erro ?? undefined} />
      </div>
    </div>
  );
}
