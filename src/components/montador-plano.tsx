"use client";

import { useState, type ReactNode } from "react";
import {
  SEGMENTOS,
  ESPACOS,
  montar,
  formatarGb,
  formatarReais,
  type Montagem,
  type Plano,
  type Segmento,
} from "@/config/planos";

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
    <span className="grid size-6 shrink-0 place-items-center rounded-md border border-linha-forte font-mono text-[11px] text-acento">
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
      className={`flex flex-col items-start gap-0.5 rounded-lg border px-4 py-3 text-left transition ${
        ativo
          ? "border-acento bg-acento/10 text-texto"
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
  /** O botão do pé — quem usa o montador decide o que fazer com a escolha. */
  acao?: (plano: Plano) => ReactNode;
}) {
  const [segmento, setSegmento] = useState<Segmento>(inicial?.segmento ?? "foto");
  const [espacoGb, setEspacoGb] = useState(inicial?.espacoGb ?? 1000);

  const plano = montar({ segmento, espacoGb });

  return (
    <div className="rounded-2xl border border-linha bg-carbon/60 p-6 sm:p-8">
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
      <div className="mt-3 rounded-lg border border-linha bg-void p-4 text-sm text-texto-soft">
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

      {/* Oito colunas para oito faixas. Mudou ESPACOS? confira a contagem. */}
      <div className="mt-4 grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
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

      {/* ── total ──────────────────────────────────────────────────────── */}
      <div className="mt-9 flex flex-col gap-4 border-t border-linha pt-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={PASSO}>Seu plano</p>
          <p className="mt-2 text-lg font-semibold">{plano.nome}</p>
          <p className="mt-1 text-xs text-texto-faint tabular-nums">
            {formatarGb(espacoGb)} · no ar e arquivado juntos
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="whitespace-nowrap text-3xl font-bold text-acento-alto tabular-nums">
            {formatarReais(plano.precoCentavos)}
            <span className="text-sm font-normal text-texto-faint">/mês</span>
          </p>
          {acao && <div className="mt-3">{acao(plano)}</div>}
        </div>
      </div>
    </div>
  );
}
