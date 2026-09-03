"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { criarAssinaturaAction } from "@/app/painel/actions";
import { formatarDocumento, soDigitos } from "@/lib/documento";
import { ESCOLHA_CARTAO } from "@/config/forma-assinatura";

/** As duas formas, com a promessa de cada uma escrita do lado. */
const OPCOES = [
  {
    valor: ESCOLHA_CARTAO,
    titulo: "Cartão de crédito",
    detalhe: "Digita uma vez. As próximas são automáticas.",
  },
  {
    valor: "escolher",
    titulo: "Pix ou boleto",
    detalhe: "Você paga cada cobrança quando ela chegar.",
  },
];

/**
 * Ativa a assinatura. Fora do componente da página porque precisa de estado.
 *
 * O CPF/CNPJ é pedido AQUI e não no cadastro de propósito: o teste é grátis e
 * não precisa de documento nenhum, e pedir CPF antes da pessoa experimentar o
 * produto só derruba a conversão. Na hora de pagar, é esperado.
 */
export function AssinaturaBotao({
  temAssinatura,
  cobrancaLigada,
  documentoSalvo,
}: {
  temAssinatura: boolean;
  cobrancaLigada: boolean;
  documentoSalvo: string | null;
}) {
  const [documento, setDocumento] = useState(
    documentoSalvo ? formatarDocumento(documentoSalvo) : "",
  );
  const [erro, setErro] = useState<string | null>(null);
  /* Cartão pré-marcado: é o que resolve a queixa de ir pagar na mão todo mês, e
     ninguém cai nele sem ver a outra opção do lado. */
  const [forma, setForma] = useState<string>(ESCOLHA_CARTAO);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  if (!cobrancaLigada) {
    return (
      <p className="mt-4 rounded-lg border border-linha bg-void px-4 py-3 text-xs text-texto-faint">
        A cobrança ainda não foi ligada nesta instalação. Enquanto isso, o uso segue liberado.
      </p>
    );
  }

  if (temAssinatura) {
    return (
      <p className="mt-4 text-xs text-texto-faint">
        Assinatura criada. A próxima cobrança aparece aqui assim que for gerada.
      </p>
    );
  }

  /*
   * DUAS OPÇÕES LADO A LADO, com o cartão já marcado.
   *
   * Marcar o cartão é o que resolve a queixa que trouxe este trabalho ("todo mês
   * o usuário tem que ir lá") — mas ninguém entra em cobrança automática sem ver
   * a outra opção do lado. No Brasil, muita gente paga por Pix por escolha, não
   * por falta de cartão, e esconder o Pix aqui seria empurrar débito automático.
   *
   * O que a tela promete é o que vai acontecer: com cartão, digita uma vez e não
   * volta mais; sem cartão, a fatura abre com as três formas todo ciclo.
   */

  return (
    <div className="mt-4">
      <label htmlFor="documento" className="block text-xs font-medium text-texto-soft">
        CPF ou CNPJ do titular
      </label>
      <input
        id="documento"
        name="documento"
        inputMode="numeric"
        autoComplete="off"
        value={documento}
        // Formata enquanto digita, mas só quando o número está completo — mascarar
        // no meio da digitação atrapalha quem está corrigindo um dígito.
        onChange={(e) => {
          const d = soDigitos(e.target.value).slice(0, 14);
          setDocumento(d.length === 11 || d.length === 14 ? formatarDocumento(d) : d);
          setErro(null);
        }}
        placeholder="000.000.000-00"
        className="mt-1.5 w-full max-w-xs rounded-lg border border-linha bg-void px-3 py-2 text-sm tabular-nums outline-none focus:border-linha-forte"
      />
      <p className="mt-1.5 text-xs text-texto-faint">
        Exigido pelo Asaas para emitir a cobrança em seu nome.
      </p>

      <fieldset className="mt-5">
        <legend className="text-xs font-medium text-texto-soft">Como você quer pagar</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {OPCOES.map((o) => {
            const marcada = forma === o.valor;
            return (
              <label
                key={o.valor}
                className={`cursor-pointer rounded-xl border px-4 py-3 transition ${
                  marcada ? "border-acento bg-carbon-2" : "border-linha hover:border-linha-forte"
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="forma"
                    value={o.valor}
                    checked={marcada}
                    onChange={() => setForma(o.valor)}
                    className="h-4 w-4 accent-[color:var(--acento)]"
                  />
                  <span className="text-sm font-medium">{o.titulo}</span>
                </span>
                <span className="mt-1 block text-xs text-texto-faint">{o.detalhe}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <button
        type="button"
        disabled={ocupado}
        onClick={() =>
          iniciar(async () => {
            setErro(null);
            const r = await criarAssinaturaAction(documento, "mensal", forma);
            if (r?.erro) setErro(r.erro);
            else router.refresh();
          })
        }
        className="mt-4 rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-50"
      >
        {ocupado ? "Criando…" : "Ativar assinatura"}
      </button>
      <p className="mt-2 text-xs text-texto-faint">
        {forma === ESCOLHA_CARTAO
          ? "O cartão é digitado na página do Asaas, e nunca passa por aqui."
          : "A fatura abre com Pix, boleto e cartão lado a lado, a cada ciclo."}
      </p>
      {erro && (
        <p role="alert" className="mt-2 text-xs text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
