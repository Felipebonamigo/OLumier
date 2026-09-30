"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acrescentarAtomatizaAction } from "@/app/painel/actions";
import { ESCOLHA_CARTAO } from "@/config/forma-assinatura";
import { MESES_PAGOS_NO_ANO, formatarReais } from "@/config/planos";
import { NOME_DA_FAIXA, type FaixaAtomatiza } from "@/config/combo";
import type { OfertaDoPacote } from "@/components/assinatura-botao";

const FAIXAS: FaixaAtomatiza[] = ["solo", "equipe", "estudio"];

/**
 * ACRESCENTAR O ATOMATIZA a quem já assina a Galeria (`docs/pacote.md`).
 *
 * Não é o pacote: a regra do desconto é a de sempre. O Atomatiza entra com o
 * combo se a Galeria daqui já foi paga; a daqui baixa quando a de lá for paga.
 * Por isso os preços aparecem como "com o combo", e não "desde já".
 */
export function AcrescentarAtomatiza({ oferta, anual }: { oferta: OfertaDoPacote; anual: boolean }) {
  const [faixa, setFaixa] = useState<FaixaAtomatiza>("solo");
  const [forma, setForma] = useState<string>(ESCOLHA_CARTAO);
  const [aceitou, setAceitou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();
  const fator = anual ? MESES_PAGOS_NO_ANO : 1;
  const sufixo = anual ? "/ano" : "/mês";
  const precisaAceitar = !oferta.atomatiza.conta;
  /* Plano fora da grade não entra no combo: não há preço de pacote a mostrar. */
  const precos = oferta.precos;
  if (!precos) return null;

  if (feito) {
    return (
      <p role="status" className="mt-4 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3 text-xs text-texto-soft">
        Pronto: a assinatura do Atomatiza foi criada.{" "}
        {oferta.atomatiza.conta
          ? "Ela está na sua conta de lá."
          : `Mandamos para ${oferta.email} o e-mail para criar a senha de lá.`}
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-linha bg-void px-4 py-3">
      <p className="text-sm font-medium">Acrescentar o Atomatiza</p>
      <p className="mt-1 text-xs text-texto-faint">
        O sistema de gestão para o seu estúdio. Com a Galeria, as duas saem mais baratas.{" "}
        {oferta.atomatiza.conta
          ? `A assinatura entra na sua conta de lá (${oferta.atomatiza.emailMascarado}).`
          : `A conta de lá é criada com o e-mail ${oferta.email}, e você recebe o link para criar a senha.`}
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {FAIXAS.map((f) => {
          const p = precos[f];
          const marcada = faixa === f;
          return (
            <label
              key={f}
              className={`cursor-pointer rounded-xl border px-3 py-2.5 transition ${
                marcada ? "border-acento bg-carbon-2" : "border-linha hover:border-linha-forte"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="faixa-atomatiza"
                  checked={marcada}
                  onChange={() => setFaixa(f)}
                  className="h-4 w-4 accent-[color:var(--acento)]"
                />
                <span className="text-sm font-medium">{NOME_DA_FAIXA[f]}</span>
              </span>
              <span className="mt-1 block text-sm tabular-nums">
                <s className="text-xs text-texto-faint">{formatarReais(p.atomatizaCheio * fator)}</s>{" "}
                {formatarReais(p.atomatiza * fator)}
                <span className="text-xs text-texto-faint">{sufixo}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-texto-faint">
        Preço com o combo, que entra quando a Galeria já foi paga. A Galeria também baixa, para{" "}
        {formatarReais(precos[faixa].galeria * fator)}
        {sufixo}, quando o Atomatiza for pago.
      </p>

      <fieldset className="mt-3">
        <legend className="text-xs font-medium text-texto-soft">Como pagar o Atomatiza</legend>
        <div className="mt-1.5 flex flex-wrap gap-4 text-sm">
          {[
            { valor: ESCOLHA_CARTAO, titulo: "Cartão de crédito" },
            { valor: "escolher", titulo: "Pix ou boleto" },
          ].map((o) => (
            <label key={o.valor} className="flex items-center gap-2">
              <input
                type="radio"
                name="forma-atomatiza"
                checked={forma === o.valor}
                onChange={() => setForma(o.valor)}
                className="h-4 w-4 accent-[color:var(--acento)]"
              />
              {o.titulo}
            </label>
          ))}
        </div>
      </fieldset>

      {precisaAceitar && (
        <label className="mt-3 flex items-start gap-2 text-xs text-texto-soft">
          <input
            type="checkbox"
            checked={aceitou}
            onChange={(e) => setAceitou(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[color:var(--acento)]"
          />
          <span>
            Li e aceito os{" "}
            <a href={`${oferta.urlAtomatiza}/termos`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Termos
            </a>{" "}
            e a{" "}
            <a href={`${oferta.urlAtomatiza}/privacidade`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Privacidade
            </a>{" "}
            do Atomatiza.
          </span>
        </label>
      )}

      <button
        type="button"
        disabled={ocupado}
        onClick={() =>
          iniciar(async () => {
            setErro(null);
            if (precisaAceitar && !aceitou) {
              setErro("Marque que leu os Termos e a Privacidade do Atomatiza para criar a conta de lá.");
              return;
            }
            const r = await acrescentarAtomatizaAction(anual ? "anual" : "mensal", forma, faixa, aceitou);
            if (r.erro) setErro(r.erro);
            else {
              setFeito(true);
              router.refresh();
            }
          })
        }
        className="mt-3 rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-50"
      >
        {ocupado ? "Criando…" : `Assinar o Atomatiza ${NOME_DA_FAIXA[faixa]}`}
      </button>
      {erro && (
        <p role="alert" className="mt-2 text-xs text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
