"use client";

import { useState, type ReactNode } from "react";
import {
  SEGMENTOS,
  GALERIAS,
  COFRES,
  montar,
  formatarGb,
  formatarReais,
  type Montagem,
  type Plano,
  type Segmento,
} from "@/config/planos";

/**
 * O quebra-cabeça: o fotógrafo monta o plano dele em três peças.
 *
 * Substituiu a lista de seis pacotes fixos. Pacote fixo obriga a pagar por
 * espaço que não se usa (quem só faz ensaio não precisa de 1 TB) ou a estourar
 * o único tamanho que servia — e, pior, esconde o que está sendo comprado
 * atrás de um nome. Aqui cada peça tem preço visível e o total é a soma.
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
  const [galeriaGb, setGaleriaGb] = useState(inicial?.galeriaGb ?? 250);
  const [cofreGb, setCofreGb] = useState(inicial?.cofreGb ?? 0);

  const plano = montar({ segmento, galeriaGb, cofreGb });
  const precoGaleria = GALERIAS.find((g) => g.gb === galeriaGb)?.precoCentavos ?? 0;
  const precoCofre = cofreGb > 0 ? (COFRES.find((c) => c.gb === cofreGb)?.precoCentavos ?? 0) : 0;

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
        <span className={PASSO}>Tamanho da galeria</span>
      </div>
      <p className="mt-2 text-sm text-texto-soft">
        O espaço que fica <strong className="text-texto">no ar</strong>, com o link aberto para o
        cliente baixar quantas vezes quiser.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {GALERIAS.map((g) => (
          <Peca
            key={g.gb}
            ativo={galeriaGb === g.gb}
            onClick={() => setGaleriaGb(g.gb)}
            titulo={formatarGb(g.gb)}
            preco={formatarReais(g.precoCentavos)}
          />
        ))}
      </div>

      {/* ── peça 3 ─────────────────────────────────────────────────────── */}
      <div className="mt-9 flex items-center gap-3">
        <Numero n={3} />
        <span className={PASSO}>Cofre — opcional</span>
      </div>

      {/*
       * O cofre é a peça que ninguém conhece, então a explicação vive aqui e não
       * numa página de ajuda: quem não entende o que é simplesmente não compra.
       */}
      <div className="mt-3 rounded-lg border border-linha bg-void p-4 text-sm text-texto-soft">
        <p>
          Toda galeria tem um prazo no ar (você escolhe: 6 meses, 1 ano, 2 anos ou sem prazo).
          Quando o prazo acaba, ela <strong className="text-texto">desce para o cofre</strong>:
          o link sai do ar, mas <strong className="text-texto">nada é apagado</strong>.
        </p>
        <p className="mt-2">
          Cliente antigo pediu as fotos de novo? Você reativa em um clique e a galeria volta ao ar
          por mais um ano. Sem cofre, você precisa apagar as entregas antigas para abrir espaço.
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Peca
          ativo={cofreGb === 0}
          onClick={() => setCofreGb(0)}
          titulo="Sem cofre"
          preco={formatarReais(0)}
        />
        {COFRES.map((c) => (
          <Peca
            key={c.gb}
            ativo={cofreGb === c.gb}
            onClick={() => setCofreGb(c.gb)}
            titulo={formatarGb(c.gb)}
            preco={formatarReais(c.precoCentavos)}
          />
        ))}
      </div>

      {/* ── total ──────────────────────────────────────────────────────── */}
      <div className="mt-9 flex flex-col gap-4 border-t border-linha pt-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={PASSO}>Seu plano</p>
          <p className="mt-2 text-lg font-semibold">{plano.nome}</p>
          <p className="mt-1 text-xs text-texto-faint tabular-nums">
            galeria {formatarReais(precoGaleria)}
            {cofreGb > 0 && ` + cofre ${formatarReais(precoCofre)}`}
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
