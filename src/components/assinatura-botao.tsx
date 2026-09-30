"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assinarPacoteAction, criarAssinaturaAction } from "@/app/painel/actions";
import { formatarDocumento, soDigitos } from "@/lib/documento";
import { ESCOLHA_CARTAO } from "@/config/forma-assinatura";
import { MESES_PAGOS_NO_ANO, formatarReais } from "@/config/planos";
import { NOME_DA_FAIXA, type FaixaAtomatiza, type PrecoDoPacote } from "@/config/combo";
import type { SituacaoNaPonte } from "@/lib/pacote";

/** Um tamanho da grade, com o preço dele sozinho e no pacote. */
export interface Tamanho {
  planoId: string;
  gb: number;
  precoCentavos: number;
  pacote: Record<FaixaAtomatiza, PrecoDoPacote>;
}

const rotuloGb = (gb: number) => (gb >= 1000 ? `${gb / 1000} TB` : `${gb} GB`);

/** O que a tela precisa para oferecer o pacote. Ausente = sem oferta. */
export interface OfertaDoPacote {
  /** Os preços do pacote no plano ATUAL da conta (null fora da grade). */
  precos: Record<FaixaAtomatiza, PrecoDoPacote> | null;
  /** A situação deste CPF/CNPJ no Atomatiza, lida pela ponte. */
  atomatiza: SituacaoNaPonte;
  /** O e-mail desta conta — é o que a conta nova de lá vai usar. */
  email: string;
  /** Onde ficam os Termos e a Privacidade do Atomatiza. */
  urlAtomatiza: string;
}

const FAIXAS: FaixaAtomatiza[] = ["solo", "equipe", "estudio"];

/**
 * Os dois prazos. O anual cobra `MESES_PAGOS_NO_ANO` mensalidades de uma vez —
 * o desconto sai da constante, nunca de um número escrito aqui: uma segunda
 * fonte de verdade viraria mentira no dia em que a política mudasse, e a mentira
 * estaria na tela onde a pessoa decide pagar.
 */
const CICLOS = [
  { valor: "mensal", titulo: "Mensal", sufixo: "/mês", detalhe: null },
  {
    valor: "anual",
    titulo: "Anual",
    sufixo: "/ano",
    detalhe: `${12 - MESES_PAGOS_NO_ANO} meses grátis`,
  },
] as const;

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
  precoMensalCentavos,
  pacote = null,
  tamanhos = [],
  planoAtual = null,
}: {
  temAssinatura: boolean;
  cobrancaLigada: boolean;
  documentoSalvo: string | null;
  /** O mensal da faixa contratada. O anual é derivado, nunca uma segunda tabela. */
  precoMensalCentavos: number;
  pacote?: OfertaDoPacote | null;
  /** A grade para escolher o tamanho aqui mesmo. Vazia → vale o plano da conta. */
  tamanhos?: Tamanho[];
  planoAtual?: string | null;
}) {
  const [documento, setDocumento] = useState(
    documentoSalvo ? formatarDocumento(documentoSalvo) : "",
  );
  const [erro, setErro] = useState<string | null>(null);
  /* Cartão pré-marcado: é o que resolve a queixa de ir pagar na mão todo mês, e
     ninguém cai nele sem ver a outra opção do lado. */
  const [forma, setForma] = useState<string>(ESCOLHA_CARTAO);
  /* Mensal pré-marcado, ao contrário do cartão: o anual é um compromisso de doze
     meses e um valor dez vezes maior de uma vez. Empurrar isso por padrão seria
     vender prazo por descuido — quem quer o desconto escolhe. */
  const [ciclo, setCiclo] = useState<string>("mensal");
  /* "Só a Galeria" pré-marcado: o pacote é uma oferta ao lado, não um
     carrinho que já vem cheio. */
  const [faixa, setFaixa] = useState<FaixaAtomatiza | null>(null);
  /* O tamanho começa no plano da conta — o do cadastro, ou o que ela já
     escolheu em "Mudar de plano". */
  const [planoId, setPlanoId] = useState<string | null>(
    tamanhos.find((t) => t.planoId === planoAtual)?.planoId ?? tamanhos[0]?.planoId ?? null,
  );
  const tamanho = tamanhos.find((t) => t.planoId === planoId) ?? null;
  const mensal = tamanho ? tamanho.precoCentavos : precoMensalCentavos;
  const [aceitou, setAceitou] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const precoAnual = mensal * MESES_PAGOS_NO_ANO;
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

      {/*
        DUAS PERGUNTAS, NA ORDEM DA DECISÃO: primeiro de quanto em quanto tempo
        se paga (é o que muda o preço), depois em que forma. Quatro combinações
        numa grade só obrigariam a comparar prazo e forma ao mesmo tempo, que é
        o jeito mais rápido de a pessoa fechar a aba.
      */}
      {tamanhos.length > 0 && (
        /* TRÊS PLANOS, E DEPOIS O TB ADICIONAL — o mesmo desenho do montador da
           home. Felipe: "no plano é no máximo 1 TB, depois é TB adicional". O
           adicional entra na mesma fatura, no preço cheio, fora do desconto do
           pacote (`config/combo.ts`, `TETO_DO_PLANO_GB`). */
        <fieldset className="mt-5">
          <legend className="text-xs font-medium text-texto-soft">Tamanho da Galeria</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {tamanhos
              .filter((t) => t.gb <= 1000)
              .map((t) => {
                const marcada = t.gb === Math.min(tamanho?.gb ?? 0, 1000);
                return (
                  <label
                    key={t.planoId}
                    className={`cursor-pointer rounded-xl border px-3 py-2 transition ${
                      marcada ? "border-acento bg-carbon-2" : "border-linha hover:border-linha-forte"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="tamanho"
                        checked={marcada}
                        onChange={() => {
                          setPlanoId(t.planoId);
                          setErro(null);
                        }}
                        className="h-4 w-4 accent-[color:var(--acento)]"
                      />
                      <span className="text-sm font-medium">{rotuloGb(t.gb)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs tabular-nums text-texto-faint">
                      {formatarReais(t.precoCentavos)}/mês
                    </span>
                  </label>
                );
              })}
          </div>
          {(() => {
            const adicionais = tamanho ? Math.max(0, (tamanho.gb - 1000) / 1000) : 0;
            const irPara = (n: number) => {
              const alvo = tamanhos.find((t) => t.gb === 1000 + n * 1000);
              if (alvo) {
                setPlanoId(alvo.planoId);
                setErro(null);
              }
            };
            const base = tamanhos.find((t) => t.gb === 1000);
            const passo = tamanhos.find((t) => t.gb === 2000);
            const porTera = base && passo ? passo.precoCentavos - base.precoCentavos : 0;
            return (
              <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-linha bg-void/60 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Precisa de mais que 1 TB?</p>
                  <p className="mt-0.5 text-xs text-texto-faint">
                    TB adicional: {formatarReais(porTera)} por mês cada, fora do desconto do pacote.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Um TB adicional a menos"
                    disabled={adicionais === 0}
                    onClick={() => irPara(adicionais - 1)}
                    className="h-8 w-8 rounded-lg border border-linha text-sm disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="min-w-[4.5rem] text-center text-sm tabular-nums">
                    {adicionais === 0 ? "nenhum" : `+${adicionais} TB`}
                  </span>
                  <button
                    type="button"
                    aria-label="Um TB adicional a mais"
                    disabled={!tamanhos.some((t) => t.gb === 1000 + (adicionais + 1) * 1000)}
                    onClick={() => irPara(adicionais + 1)}
                    className="h-8 w-8 rounded-lg border border-linha text-sm disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })()}
        </fieldset>
      )}

      <fieldset className="mt-5">
        <legend className="text-xs font-medium text-texto-soft">De quanto em quanto tempo</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {CICLOS.map((c) => {
            const marcada = ciclo === c.valor;
            const centavos = c.valor === "anual" ? precoAnual : mensal;
            return (
              <label
                key={c.valor}
                className={`cursor-pointer rounded-xl border px-4 py-3 transition ${
                  marcada ? "border-acento bg-carbon-2" : "border-linha hover:border-linha-forte"
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="ciclo"
                    value={c.valor}
                    checked={marcada}
                    onChange={() => setCiclo(c.valor)}
                    className="h-4 w-4 accent-[color:var(--acento)]"
                  />
                  <span className="text-sm font-medium">{c.titulo}</span>
                </span>
                <span className="mt-1 block text-sm tabular-nums">
                  {formatarReais(centavos)}
                  <span className="text-xs text-texto-faint">{c.sufixo}</span>
                </span>
                {c.detalhe && (
                  <span className="mt-0.5 block text-xs text-ok">{c.detalhe}</span>
                )}
              </label>
            );
          })}
        </div>
        {/* O combo não muda estes números na tela: ele depende de uma assinatura
            que só o Asaas conhece, e é conferido na hora de criar esta. */}
        {!pacote && (
          <p className="mt-2 text-xs text-texto-faint">
            Já assina o Atomatiza com este CPF ou CNPJ? O desconto do combo entra sozinho na cobrança.
          </p>
        )}
      </fieldset>

      {pacote && (
        <MonteOPacote
          oferta={pacote}
          precos={tamanho?.pacote ?? pacote.precos}
          galeria={tamanho ? rotuloGb(tamanho.gb) : null}
          anual={ciclo === "anual"}
          faixa={faixa}
          escolher={(f) => {
            setFaixa(f);
            setErro(null);
          }}
          aceitou={aceitou}
          aceitar={setAceitou}
        />
      )}

      <fieldset className="mt-4">
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
            if (faixa) {
              const precisaAceitar = pacote && !pacote.atomatiza.conta;
              if (precisaAceitar && !aceitou) {
                setErro("Marque que leu os Termos e a Privacidade do Atomatiza para criar a conta de lá.");
                return;
              }
              const r = await assinarPacoteAction(documento, ciclo, forma, faixa, aceitou, planoId);
              if (r?.erro) setErro(r.erro);
              if (!r?.erro || r.galeriaAssinada) router.refresh();
              return;
            }
            const r = await criarAssinaturaAction(documento, ciclo, forma, planoId);
            if (r?.erro) setErro(r.erro);
            else router.refresh();
          })
        }
        className="mt-4 rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-50"
      >
        {ocupado ? "Criando…" : faixa ? "Assinar o pacote" : "Ativar assinatura"}
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

/**
 * MONTE O SEU PACOTE (30/09/2026, `docs/pacote.md`).
 *
 * Felipe: "a pessoa poder montar o pacote dela". A Galeria é a desta conta; o
 * que se escolhe aqui é a faixa do Atomatiza, com o preço dos dois lados já
 * com o desconto e o total. A situação de lá vem pela ponte, pelo CPF/CNPJ:
 * quem já assina não vê a escolha (o desconto entra sozinho), quem tem conta
 * sem assinatura vê que a assinatura entra nela, e quem não tem vê que a conta
 * será criada com este e-mail.
 */
function MonteOPacote({
  oferta,
  precos,
  galeria,
  anual,
  faixa,
  escolher,
  aceitou,
  aceitar,
}: {
  oferta: OfertaDoPacote;
  /** Os preços do pacote no tamanho escolhido; null = o tamanho não entra. */
  precos: Record<FaixaAtomatiza, PrecoDoPacote> | null;
  galeria: string | null;
  anual: boolean;
  faixa: FaixaAtomatiza | null;
  escolher: (f: FaixaAtomatiza | null) => void;
  aceitou: boolean;
  aceitar: (v: boolean) => void;
}) {
  const { atomatiza } = oferta;
  const fator = anual ? MESES_PAGOS_NO_ANO : 1;
  const sufixo = anual ? "/ano" : "/mês";

  if (atomatiza.assinatura) {
    const f = atomatiza.assinatura.plano.faixa;
    return (
      <p className="mt-4 rounded-lg border border-linha bg-void px-4 py-3 text-xs text-texto-soft">
        Você já assina o Atomatiza{f ? ` ${NOME_DA_FAIXA[f]}` : ""} com este CPF/CNPJ. O desconto do combo entra
        sozinho nas duas assinaturas.
      </p>
    );
  }

  if (!precos) return null;
  const escolhido = faixa ? precos[faixa] : null;
  return (
    <fieldset className="mt-5">
      <legend className="text-xs font-medium text-texto-soft">Monte o seu pacote</legend>
      <p className="mt-1 text-xs text-texto-faint">
        A Galeria com o Atomatiza, o sistema de gestão para o seu estúdio: as duas saem mais baratas juntas.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label
          className={`cursor-pointer rounded-xl border px-4 py-3 transition ${
            faixa === null ? "border-acento bg-carbon-2" : "border-linha hover:border-linha-forte"
          }`}
        >
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name="atomatiza"
              checked={faixa === null}
              onChange={() => escolher(null)}
              className="h-4 w-4 accent-[color:var(--acento)]"
            />
            <span className="text-sm font-medium">Só a Galeria</span>
          </span>
        </label>
        {FAIXAS.map((f) => {
          const p = precos[f];
          const marcada = faixa === f;
          return (
            <label
              key={f}
              className={`cursor-pointer rounded-xl border px-4 py-3 transition ${
                marcada ? "border-acento bg-carbon-2" : "border-linha hover:border-linha-forte"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="atomatiza"
                  checked={marcada}
                  onChange={() => escolher(f)}
                  className="h-4 w-4 accent-[color:var(--acento)]"
                />
                <span className="text-sm font-medium">+ Atomatiza {NOME_DA_FAIXA[f]}</span>
              </span>
              <span className="mt-1 block text-sm tabular-nums">
                {formatarReais((p.galeria + p.atomatiza) * fator)}
                <span className="text-xs text-texto-faint">{sufixo} os dois</span>
              </span>
              <span className="mt-0.5 block text-xs text-ok">
                {formatarReais((p.galeriaCheio + p.atomatizaCheio - p.galeria - p.atomatiza) * fator)} a menos
                {anual ? " por ano" : " por mês"}
              </span>
            </label>
          );
        })}
      </div>

      {escolhido && faixa && (
        <div className="mt-3 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3 text-xs text-texto-soft">
          <p className="tabular-nums">
            Galeria{galeria ? ` ${galeria}` : ""}: <s className="text-texto-faint">{formatarReais(escolhido.galeriaCheio * fator)}</s>{" "}
            <strong className="text-texto">{formatarReais(escolhido.galeria * fator)}</strong>
            {sufixo} · Atomatiza {NOME_DA_FAIXA[faixa]}:{" "}
            <s className="text-texto-faint">{formatarReais(escolhido.atomatizaCheio * fator)}</s>{" "}
            <strong className="text-texto">{formatarReais(escolhido.atomatiza * fator)}</strong>
            {sufixo}
          </p>
          <p className="mt-1.5">
            Uma fatura só com os dois:{" "}
            <strong className="text-texto tabular-nums">
              {formatarReais((escolhido.galeria + escolhido.atomatiza) * fator)}
              {sufixo}
            </strong>
            , no mesmo cartão ou no mesmo Pix/boleto. A parte de cada produto é separada no pagamento.
          </p>
          <p className="mt-1.5">
            {atomatiza.conta
              ? `Você já tem conta no Atomatiza (${atomatiza.emailMascarado}): a assinatura entra nela.`
              : `Vamos criar a sua conta no Atomatiza com o e-mail ${oferta.email}. Você recebe um e-mail para criar a senha.`}
          </p>
          {!atomatiza.conta && (
            <label className="mt-2 flex items-start gap-2">
              <input
                type="checkbox"
                checked={aceitou}
                onChange={(e) => aceitar(e.target.checked)}
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
        </div>
      )}
    </fieldset>
  );
}
