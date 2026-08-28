"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { trocarEnderecoAction, type EstadoEndereco } from "@/app/painel/actions";
import { Erro, BotaoEnviar } from "@/components/form-ui";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Trocar endereço</BotaoEnviar>;
}

/**
 * O endereço do estúdio — a parte da conta que mais dá medo de mexer.
 *
 * Ele aparece em três lugares que vão para fora: o link da galeria, a vitrine e
 * o subdomínio próprio. Por isso o campo era travado, com a tela dizendo "links
 * já entregues não podem quebrar" — o que resolvia o risco e não resolvia a
 * necessidade de quem digitou errado no cadastro.
 *
 * Agora troca, e o endereço anterior continua abrindo (migração 025).
 *
 * Fica FECHADO por padrão, como a troca de senha: é raro, e um campo sempre
 * aberto sobre o endereço público convida a mexer sem motivo.
 *
 * O aviso do que vai acontecer aparece ANTES do botão, não depois de apertar.
 * Confirmação que chega depois da ação já não é escolha.
 */
export function EditorEndereco({
  slug,
  dominio,
  antigos,
  restam,
}: {
  slug: string;
  dominio: string;
  antigos: string[];
  restam: number;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, action] = useActionState<EstadoEndereco, FormData>(trocarEnderecoAction, {});

  // Fecha quando trocou. Ajuste durante a render — num efeito, o formulário
  // apareceria aberto por um quadro depois do sucesso.
  const [visto, setVisto] = useState(estado);
  if (estado !== visto) {
    setVisto(estado);
    if (estado.ok) setAberto(false);
  }

  return (
    <section className="mt-6 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Endereço das galerias</h2>
        {!aberto && restam > 0 && (
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="text-xs text-texto-faint underline underline-offset-4 hover:text-texto"
          >
            trocar
          </button>
        )}
      </div>

      <p className="mt-1 font-mono text-sm text-texto">/{slug}</p>
      <p className="mt-1 text-xs text-texto-faint">
        {slug}.{dominio}
      </p>

      {estado.ok && !aberto && (
        <p role="status" className="mt-3 text-sm text-ok">
          {estado.ok}
        </p>
      )}

      {antigos.length > 0 && (
        <div className="mt-4 border-t border-linha pt-3">
          <p className="text-xs text-texto-faint">
            Endereços anteriores, que continuam abrindo e trazem para cá:
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {antigos.map((a) => (
              <li key={a} className="font-mono text-xs text-texto-soft">
                /{a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!aberto ? (
        <p className="mt-3 text-xs text-texto-faint">
          {restam > 0
            ? "Trocar não quebra link nenhum: o endereço anterior continua abrindo e leva para o novo."
            : "Você já usou as trocas disponíveis. Fale com a gente se precisar de outra."}
        </p>
      ) : (
        <form action={action} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Endereço novo</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm text-texto-faint">/</span>
              <input
                name="endereco"
                defaultValue={slug}
                required
                minLength={3}
                maxLength={40}
                pattern="[a-zA-Z0-9\-]+"
                className="w-full rounded-lg border border-linha bg-carbon px-3 py-2.5 font-mono text-sm text-texto placeholder:text-texto-faint focus:border-acento focus:outline-none"
              />
            </div>
            <span className="text-xs text-texto-faint">
              Letras, números e hífen. É o que aparece no link do seu cliente e no seu subdomínio.
            </span>
          </label>

          {/*
            O aviso vem ANTES do botão, e diz o que muda E o que não muda. Só o
            que não muda é que tira o medo — e o medo aqui é justificado: até
            27/08/2026 trocar era impossível justamente porque quebrava tudo.
          */}
          <div className="rounded-lg border border-linha bg-void px-3 py-2.5 text-xs leading-relaxed text-texto-soft">
            <p>
              <strong className="text-texto">O que não muda:</strong> os links que você já entregou
              continuam abrindo. O endereço anterior passa a levar para o novo, para sempre.
            </p>
            <p className="mt-1.5">
              <strong className="text-texto">O que muda:</strong> daqui em diante o link do cliente
              e o seu subdomínio usam o endereço novo.
            </p>
            <p className="mt-1.5 text-texto-faint">
              Restam {restam} {restam === 1 ? "troca" : "trocas"}.
            </p>
          </div>

          <Erro mensagem={estado.erro} />

          <div className="flex flex-wrap items-center gap-3">
            <Botao />
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-xs text-texto-faint underline underline-offset-4 hover:text-texto"
            >
              cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
