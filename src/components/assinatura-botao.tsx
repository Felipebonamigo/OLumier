"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { criarAssinaturaAction } from "@/app/painel/actions";
import { formatarDocumento, soDigitos } from "@/lib/documento";

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

      <button
        type="button"
        disabled={ocupado}
        onClick={() =>
          iniciar(async () => {
            setErro(null);
            const r = await criarAssinaturaAction(documento);
            if (r?.erro) setErro(r.erro);
            else router.refresh();
          })
        }
        className="mt-3 rounded-lg bg-luz px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-luz-alta disabled:opacity-50"
      >
        {ocupado ? "Criando…" : "Ativar assinatura"}
      </button>
      <p className="mt-2 text-xs text-texto-faint">
        Você escolhe entre Pix, boleto ou cartão na hora de pagar.
      </p>
      {erro && (
        <p role="alert" className="mt-2 text-xs text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
