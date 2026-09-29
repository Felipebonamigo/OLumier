"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { desligarAvisosAction } from "@/app/painel/actions";

export interface CanalNaTela {
  /** O endereço para onde os avisos saem. Do SEGREDO não há campo aqui, e é
   *  de propósito — ver `estadoDoCanal` em src/lib/avisos.ts. */
  url: string;
  criadoEm: string;
  ultimoEnvioEm: string | null;
  ultimoErro: string | null;
}

const quando = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("pt-BR", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

/** Só o host, sem caminho: é o que responde "para ONDE está indo", e o caminho
 *  não acrescenta nada a quem lê. Endereço inválido cai no texto cru em vez de
 *  estourar — a coluna aceita o que o outro lado registrou. */
function paraOnde(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function BotaoDesligar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs text-texto-soft underline transition hover:text-erro disabled:opacity-50"
    >
      {pending ? "Desligando…" : "Desligar os avisos"}
    </button>
  );
}

/**
 * O canal de avisos — a resposta para "quem está sendo avisado das minhas
 * entregas?".
 *
 * ── POR QUE ESTA TELA NÃO CRIA NADA ───────────────────────────────────────
 * Não há botão de "ligar", e a ausência é a arquitetura aparecendo: o canal é
 * registrado por quem RECEBE (o Atomatiza, ao conectar), porque é ele quem
 * inventa o segredo — o desenho do webhook do Asaas. Uma tela que criasse canal
 * aqui teria de inventar um segredo e mostrá-lo para alguém copiar, e aí o
 * segredo passaria por dentro de um HTML. Não passa.
 *
 * Desligar, sim: é a conta DESTE estúdio mandando coisa para fora, e cortar não
 * pode depender de o outro sistema estar de pé.
 *
 * ── POR QUE SÓ APARECE QUANDO EXISTE ──────────────────────────────────────
 * Quem nunca conectou o Atomatiza não tem canal, e uma seção vazia explicando
 * um recurso que ele não usa é ruído numa página que já é longa. Mesmo critério
 * da etiqueta "do contrato" na lista de galerias: procedência só se anuncia
 * quando existe. Quem tem canal tem a pergunta; quem não tem, não tem.
 */
export function CanalDeAvisos({ canal }: { canal: CanalNaTela }) {
  const [confirmando, setConfirmando] = useState(false);

  return (
    <section className="mt-6 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Avisos de entrega</h2>
          <p className="mt-0.5 text-xs text-texto-faint">
            Quando você publica, despublica ou arquiva uma galeria, este estúdio avisa o
            Atomatiza — e a ficha do contrato de lá se atualiza sozinha.
          </p>
        </div>
      </div>

      <dl className="mt-4 divide-y divide-linha border-t border-linha text-sm">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
          <dt className="min-w-[9rem] text-texto-soft">Avisando</dt>
          <dd className="font-medium">{paraOnde(canal.url)}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
          <dt className="min-w-[9rem] text-texto-soft">Ligado desde</dt>
          <dd>{quando(canal.criadoEm)}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
          <dt className="min-w-[9rem] text-texto-soft">Último aviso</dt>
          <dd>
            {/* Sem envio E sem erro é o estado normal de canal recém-ligado —
              * nada mudou de estado ainda. Dizer "nunca" seco pareceria defeito. */}
            {canal.ultimoEnvioEm
              ? quando(canal.ultimoEnvioEm)
              : canal.ultimoErro
                ? "nenhum aviso chegou ao destino"
                : "nenhuma entrega mudou de estado desde que ligou"}
          </dd>
        </div>
        {canal.ultimoErro && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
            <dt className="min-w-[9rem] text-texto-soft">Última falha</dt>
            <dd className="min-w-0">
              <p className="break-words text-erro">{canal.ultimoErro}</p>
              {/* A falha é informação, não emergência: o outro lado tem o botão
                * "conferir", que nunca deixou de existir. Dizer isso evita o
                * susto de quem lê "erro" e acha que perdeu entrega. */}
              <p className="mt-1 text-xs text-texto-faint">
                Nada se perdeu: no Atomatiza, o botão <strong>Conferir</strong> da ficha
                busca o estado atual a qualquer momento.
              </p>
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4 border-t border-linha pt-4">
        {confirmando ? (
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-xs text-texto-soft">
              Desligar não apaga nada no Atomatiza: o link da galeria continua na ficha do
              contrato, e o botão <strong>Conferir</strong> de lá segue funcionando. O que
              para é a atualização sozinha. Para religar, reconecte por lá.
            </p>
            <div className="flex items-center gap-4">
              <form action={desligarAvisosAction}>
                <BotaoDesligar />
              </form>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="text-xs text-texto-faint transition hover:text-texto"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className="rounded-lg border border-linha px-3 py-1.5 text-xs text-texto-soft transition hover:border-linha-forte hover:text-texto"
          >
            Desligar os avisos
          </button>
        )}
      </div>
    </section>
  );
}
