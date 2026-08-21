"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { salvarMarcaAction, type EstadoMarca } from "@/app/painel/actions";
import { Campo, Erro, BotaoEnviar } from "@/components/form-ui";
import {
  COR_PADRAO,
  FUNDO_CLARO,
  FUNDO_ESCURO,
  LIMITE_LOGO,
  TIPOS_LOGO,
  normalizarCor,
  recusaDaLogo,
  temasEmQueSome,
} from "@/lib/marca-estudio";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Salvar marca</BotaoEnviar>;
}

/**
 * A marca do estúdio: o que o cliente final vê.
 *
 * Existia só do lado da leitura — a capa da galeria já sabia desenhar a logo,
 * mas não havia por onde enviá-la, e a única forma de um estúdio ter a própria
 * marca era alguém editar o banco na mão.
 */
export function EditorMarca({
  nomeEstudio,
  corDestaque,
  urlLogo,
  slug,
}: {
  nomeEstudio: string;
  corDestaque: string;
  /** Link assinado da logo atual, ou null. Expira — serve só para esta tela. */
  urlLogo: string | null;
  slug: string;
}) {
  const [estado, action] = useActionState<EstadoMarca, FormData>(salvarMarcaAction, {});
  const [cor, setCor] = useState(normalizarCor(corDestaque) ?? COR_PADRAO);
  const [enviando, setEnviando] = useState(false);
  const [erroLogo, setErroLogo] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const some = temasEmQueSome(cor);

  async function enviarLogo(arquivo: File) {
    // A mesma regra do servidor, aplicada aqui só para a resposta ser imediata:
    // quem manda um arquivo de 8 MB merece saber antes de esperar o envio.
    const recusa = recusaDaLogo(arquivo.type, arquivo.size);
    if (recusa) {
      setErroLogo(recusa);
      return;
    }

    setErroLogo(null);
    setEnviando(true);
    try {
      const pedido = await fetch("/api/marca/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime: arquivo.type, bytes: arquivo.size }),
      });
      const dados = await pedido.json();
      if (!pedido.ok) throw new Error(dados.erro ?? "Não foi possível enviar.");

      const put = await fetch(dados.url, {
        method: "PUT",
        headers: { "Content-Type": arquivo.type },
        body: arquivo,
      });
      if (!put.ok) throw new Error("O envio para o armazenamento falhou.");

      const confirma = await fetch("/api/marca/logo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave: dados.chave }),
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
    <section className="mt-6 rounded-xl border border-linha bg-carbon p-5">
      <h2 className="text-sm font-semibold">Marca</h2>
      <p className="mt-1 text-xs text-texto-faint">O que seus clientes veem nas galerias.</p>

      {/* Logo */}
      <div className="mt-5">
        <span className="block text-sm font-medium">Logo</span>
        <p className="mt-0.5 text-xs text-texto-faint">
          Na capa, a logo <strong className="text-texto-soft">substitui</strong> o nome escrito —
          quase toda logo já traz o nome, e mostrar os dois deixa a capa repetida.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div
            className="flex h-20 w-40 shrink-0 items-center justify-center rounded-lg border border-linha bg-void p-3"
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
              (PNG) fica melhor nos temas escuros.
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

      {/* Nome e cor */}
      <form action={action} className="mt-6 flex flex-col gap-4 border-t border-linha pt-5">
        <Campo
          label="Nome do estúdio"
          name="nome_estudio"
          defaultValue={nomeEstudio}
          required
          maxLength={80}
          dica={`Muda o que aparece escrito. O endereço continua /${slug} — links já entregues não podem quebrar.`}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Cor de destaque</span>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="color"
              value={cor}
              onChange={(e) => setCor(e.target.value)}
              aria-label="Escolher cor de destaque"
              className="h-10 w-14 cursor-pointer rounded-lg border border-linha bg-carbon p-1"
            />
            <input
              type="text"
              name="cor_destaque"
              value={cor}
              onChange={(e) => setCor(e.target.value)}
              spellCheck={false}
              className="w-32 rounded-lg border border-linha bg-carbon px-3 py-2.5 font-mono text-sm"
            />

            {/* Mostrar o problema em vez de descrevê-lo: a cor aparece nos dois
                fundos, e quem escolheu vê na hora onde ela some. */}
            <div className="flex gap-2">
              {[
                { fundo: FUNDO_ESCURO, nome: "escuro" },
                { fundo: FUNDO_CLARO, nome: "claro" },
              ].map((f) => (
                <div
                  key={f.nome}
                  className="flex h-10 w-20 items-center justify-center rounded-lg border border-linha"
                  style={{ background: f.fundo }}
                  title={`Fundo ${f.nome}`}
                >
                  <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: cor }}>
                    Galerias
                  </span>
                </div>
              ))}
            </div>
          </div>

          <span className="text-xs text-texto-faint">
            Aparece na sua vitrine{" "}
            <code className="text-texto-soft">/{slug}</code> — a galeria em si usa a paleta do tema
            escolhido em cada uma.
          </span>

          {some.length > 0 && (
            <p className="text-xs text-alerta">
              Essa cor quase some no fundo {some.join(" e ")}. Ainda dá para salvar — só não vai ser
              legível ali.
            </p>
          )}
        </div>

        <Erro mensagem={estado.erro} />
        {estado.ok && <p className="text-sm text-ok">{estado.ok}</p>}
        <Botao />
      </form>
    </section>
  );
}
