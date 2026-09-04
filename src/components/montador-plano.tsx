"use client";

import { useState, type ReactNode } from "react";
import {
  SEGMENTOS,
  ESPACOS,
  TB_ADICIONAL_CENTAVOS,
  montar,
  formatarGb,
  formatarReais,
  precoDoCicloCentavos,
  economiaAnualCentavos,
  type Ciclo,
  type Montagem,
  type Plano,
  type Segmento,
} from "@/config/planos";

/**
 * O que vem em qualquer tamanho.
 *
 * A regra que esta lista sustenta: o tamanho muda só o ESPAÇO. Nenhum recurso
 * fica atrás de um plano maior — é o oposto do pacote em escada, onde a senha
 * na galeria ou a marca própria só aparecem no plano do meio.
 *
 * Só entra o que existe e está ligado, mesma regra da página de segurança. Cada
 * linha abaixo foi conferida contra o produto, não contra o que seria bom
 * vender: o cofre é `lib/cofre.ts`, a lixeira é `PRAZO_LIXEIRA_DIAS`, o link
 * assinado é `armazem.ts`, e vídeo sem adicional é preso em `testar-planos.mjs`.
 */
const INCLUSO = [
  "Galerias sem limite de quantidade",
  "Downloads sem limite de vezes",
  "Foto e filme no mesmo espaço, sem adicional por hora de vídeo",
  "Sua marca: logo, cor de destaque e endereço próprio",
  "Senha por galeria, quando você quiser",
  "Capítulos para dividir a entrega em momentos",
  "Favoritas: o cliente marca, você recebe a lista",
  "Quatro estilos de galeria, com ajuste fino",
  "Cofre: entrega vencida sai do ar sem ser apagada",
  "Lixeira de 30 dias contra a mão errada",
  "Links assinados que expiram sozinhos",
  "Vitrine do estúdio, no seu endereço",
];

/**
 * O montador: o fotógrafo escolhe o que entrega e quanto espaço o estúdio tem.
 *
 * Substituiu a lista de seis pacotes fixos. Pacote fixo obriga a pagar por
 * espaço que não se usa (quem só faz ensaio não precisa de 1 TB) ou a estourar
 * o único tamanho que servia — e, pior, esconde o que está sendo comprado
 * atrás de um nome.
 *
 * Foram TRÊS peças por um dia (25/08/2026), com o cofre cobrado à parte. A
 * terceira saiu quando a conta mostrou que, com tudo no B2, o GB no ar e o GB
 * arquivado custam o mesmo — o desconto do cofre virou desconto sem lastro. E a
 * pergunta que sumiu era a impossível de responder na hora da compra: ninguém
 * sabe quanto vai arquivar em 2027. Ver `docs/arquitetura-armazenamento.md`.
 *
 * Serve à home (vitrine, com "criar conta" no pé) e à tela de Conta (troca de
 * plano de verdade). Por isso o botão final vem de fora, em `acao`: o
 * componente não sabe nem precisa saber o que acontece depois da escolha.
 */

const PASSO = "font-mono text-[11px] uppercase tracking-[0.28em] text-texto-faint";

function Numero({ n }: { n: number }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full border border-linha-forte font-mono text-[11px] text-acento">
      {n}
    </span>
  );
}

function Peca({
  ativo,
  onClick,
  titulo,
  detalhe,
  preco,
}: {
  ativo: boolean;
  onClick: () => void;
  titulo: string;
  detalhe?: string;
  preco?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={`flex flex-col items-start gap-0.5 rounded-2xl border px-4 py-3 text-left transition ${
        ativo
          ? "border-acento bg-acento/10 text-texto shadow-[0_0_24px_-8px_var(--acento)]"
          : "border-linha bg-carbon text-texto-soft hover:border-linha-forte hover:text-texto"
      }`}
    >
      <span className="text-sm font-semibold">{titulo}</span>
      {detalhe && <span className="text-[11px] text-texto-faint">{detalhe}</span>}
      {preco && <span className="mt-1 text-xs tabular-nums text-acento-alto">{preco}</span>}
    </button>
  );
}

export function MontadorPlano({
  inicial,
  acao,
}: {
  inicial?: Montagem;
  /**
   * O botão do pé — quem usa o montador decide o que fazer com a escolha.
   * Recebe o ciclo junto porque é ele que define o valor da fatura: o botão que
   * assina precisa saber se está mandando cobrar um mês ou dez.
   */
  acao?: (plano: Plano, ciclo: Ciclo) => ReactNode;
}) {
  const [segmento, setSegmento] = useState<Segmento>(inicial?.segmento ?? "foto");
  const [espacoGb, setEspacoGb] = useState(inicial?.espacoGb ?? 1000);
  const [ciclo, setCiclo] = useState<Ciclo>("mensal");

  const plano = montar({ segmento, espacoGb });

  return (
    <div className="vidro rounded-3xl p-6 sm:p-8">
      {/* ── peça 1 ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Numero n={1} />
        <span className={PASSO}>O que você entrega</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {SEGMENTOS.map((s) => (
          <Peca
            key={s.id}
            ativo={segmento === s.id}
            onClick={() => setSegmento(s.id)}
            titulo={s.nome}
            detalhe={s.descricao}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-texto-soft">
        Vídeo não custa mais caro aqui — você paga espaço, não hora de filme.
      </p>

      {/* ── peça 2 ─────────────────────────────────────────────────────── */}
      <div className="mt-9 flex items-center gap-3">
        <Numero n={2} />
        <span className={PASSO}>Espaço do estúdio</span>
      </div>
      <p className="mt-2 text-sm text-texto-soft">
        Um número só: galeria no ar e arquivo guardado usam o{" "}
        <strong className="text-texto">mesmo espaço</strong>.
      </p>

      {/*
       * O arquivamento é a promessa que nenhum concorrente faz, e o cliente não
       * descobre sozinho que ela existe — por isso a explicação vive aqui, ao
       * lado do preço, e não numa página de ajuda que ninguém abre.
       */}
      <div className="mt-3 rounded-2xl border border-linha bg-void/60 p-4 text-sm text-texto-soft">
        <p>
          Toda galeria tem um prazo no ar (você escolhe: 6 meses, 1 ano, 2 anos ou sem prazo).
          Quando o prazo acaba, o link sai do ar e{" "}
          <strong className="text-texto">nada é apagado</strong> — a entrega continua guardada no
          seu espaço.
        </p>
        <p className="mt-2">
          Cliente antigo pediu as fotos de novo? Você reativa em um clique e a galeria volta ao ar.
          Guardar entrega antiga <strong className="text-texto">não custa a mais</strong>.
        </p>
      </div>

      {/* Uma coluna por faixa. Mudou ESPACOS? confira a contagem. */}
      <div className="mt-4 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {ESPACOS.map((e) => (
          <Peca
            key={e.gb}
            ativo={espacoGb === e.gb}
            onClick={() => setEspacoGb(e.gb)}
            titulo={formatarGb(e.gb)}
            preco={formatarReais(e.precoCentavos)}
          />
        ))}
      </div>

      {/*
        O TERA ADICIONAL, dito em voz alta.

        A vitrine mostra três planos (250 GB, 500 GB, 1 TB) e a grade vai até
        10 TB. Sem esta linha, quem precisa de 3 TB olha os três cartões e
        conclui que o produto não serve — quando a tabela ao lado já resolve.
        O número é DERIVADO da grade (`TB_ADICIONAL_CENTAVOS`), não escrito à
        mão: propaganda que a tabela desmente é o pior tipo de erro de preço.
      */}
      <p className="mt-3 text-xs text-texto-faint">
        Acima de 1 TB, cada tera a mais custa{" "}
        <strong className="font-medium text-texto-soft">
          {formatarReais(TB_ADICIONAL_CENTAVOS)}
        </strong>{" "}
        por mês — sem adicional por hora de vídeo, sem cobrança por galeria.
      </p>

      {/* ── peça 3: como pagar ─────────────────────────────────────────── */}
      <div className="mt-9 flex items-center gap-3">
        <Numero n={3} />
        <span className={PASSO}>Como pagar</span>
      </div>

      {/*
       * O anual mostra o preço POR MÊS, com o total do ano embaixo. É a leitura
       * honesta: quem compara plano compara mensalidade, e esconder que a
       * cobrança sai de uma vez seria a surpresa errada na hora da fatura.
       */}
      <div
        role="group"
        aria-label="Ciclo de cobrança"
        className="mt-3 inline-flex rounded-full border border-linha bg-void p-1"
      >
        {(["mensal", "anual"] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={ciclo === c}
            onClick={() => setCiclo(c)}
            className={`rounded-full px-5 py-2 text-sm transition ${
              ciclo === c ? "bg-acento font-semibold text-void" : "text-texto-soft hover:text-texto"
            }`}
          >
            {c === "mensal" ? "Mensal" : "Anual"}
            {c === "anual" && (
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                  ciclo === c ? "bg-void/20" : "bg-acento/15 text-acento-alto"
                }`}
              >
                2 meses grátis
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── tudo que entrega ───────────────────────────────────────────── */}
      <div className="mt-8 rounded-2xl border border-linha bg-void/60 p-5">
        <p className={PASSO}>Incluso em qualquer tamanho</p>
        <ul className="mt-4 grid gap-x-8 gap-y-2.5 text-sm text-texto-soft sm:grid-cols-2">
          {INCLUSO.map((item) => (
            <li key={item} className="flex gap-2.5">
              <span aria-hidden className="mt-0.5 shrink-0 text-acento-alto">
                ✓
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-linha pt-3 text-xs text-texto-faint">
          O tamanho muda só o espaço. Nenhum recurso fica atrás de um plano maior.
        </p>
      </div>

      {/* ── total ──────────────────────────────────────────────────────── */}
      <div className="mt-9 flex flex-col gap-4 border-t border-linha pt-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={PASSO}>Seu plano</p>
          <p className="mt-2 text-lg font-semibold">
            {plano.nome}
            {ciclo === "anual" && <span className="text-texto-soft"> · anual</span>}
          </p>
          <p className="mt-1 text-xs text-texto-faint tabular-nums">
            {formatarGb(espacoGb)} · no ar e arquivado juntos
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="whitespace-nowrap text-3xl font-bold text-acento-alto tabular-nums">
            {formatarReais(plano.precoCentavos)}
            <span className="text-sm font-normal text-texto-faint">/mês</span>
          </p>
          {ciclo === "anual" && (
            <p className="mt-1 text-xs text-texto-soft tabular-nums">
              cobrado uma vez: {formatarReais(precoDoCicloCentavos(plano.precoCentavos, "anual"))}
              /ano ·{" "}
              <span className="text-acento-alto">
                economiza {formatarReais(economiaAnualCentavos(plano.precoCentavos))}
              </span>
            </p>
          )}
          {acao && <div className="mt-3">{acao(plano, ciclo)}</div>}
        </div>
      </div>
    </div>
  );
}
