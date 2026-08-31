"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { salvarMarcaAction, type EstadoMarca } from "@/app/painel/actions";
import { Campo, Erro, BotaoEnviar } from "@/components/form-ui";
import { LogoEstudio } from "@/components/logo-estudio";
import {
  COR_PADRAO,
  FUNDO_CLARO,
  FUNDO_ESCURO,
  normalizarCor,
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
  const some = temasEmQueSome(cor);

  return (
    <section className="mt-6 rounded-xl border border-linha bg-carbon p-5">
      <h2 className="text-sm font-semibold">Marca</h2>
      <p className="mt-1 text-xs text-texto-faint">O que seus clientes veem nas galerias.</p>

      <div className="mt-5">
        <LogoEstudio
          nomeEstudio={nomeEstudio}
          urlLogo={urlLogo}
          nota={<>Na capa, a logo <strong className="text-texto-soft">substitui</strong> o nome escrito — quase toda logo já traz o nome, e mostrar os dois deixa a capa repetida.</>}
        />
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
