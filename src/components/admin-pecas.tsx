import type { ReactNode } from "react";

/**
 * As peças repetidas do painel de administração.
 *
 * Componentes de SERVIDOR — nenhum tem estado, e marcar `"use client"` aqui
 * mandaria a tabela inteira de estúdios para o navegador em JSON, dentro do
 * HTML, para desenhar exatamente o mesmo pixel. Os dados de todos os clientes
 * não precisam viajar duas vezes.
 */

/** Um número com o nome em cima. A unidade de leitura do painel. */
export function Cartao({
  rotulo,
  valor,
  nota,
  tom = "neutro",
}: {
  rotulo: string;
  valor: ReactNode;
  nota?: ReactNode;
  tom?: "neutro" | "ok" | "alerta" | "erro" | "acento";
}) {
  const cor = {
    neutro: "",
    ok: "text-ok",
    alerta: "text-alerta",
    erro: "text-erro",
    acento: "text-acento",
  }[tom];

  return (
    <div className="rounded-xl border border-linha bg-carbon px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-texto-faint">
        {rotulo}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${cor}`}>{valor}</div>
      {nota && <div className="mt-0.5 text-[11px] text-texto-faint">{nota}</div>}
    </div>
  );
}

/** Título de bloco, com uma linha de explicação — o painel é lido por uma pessoa só. */
export function Bloco({
  id,
  titulo,
  explicacao,
  children,
}: {
  /**
   * A âncora do bloco, para o índice do topo da página.
   *
   * `scroll-mt-4` junto: sem ele o título encosta na borda de cima da janela
   * depois do salto, e a pessoa chega no bloco sem o respiro que diz onde ele
   * começa.
   */
  id?: string;
  titulo: string;
  explicacao?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-4">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      {explicacao && <p className="mt-0.5 text-xs text-texto-faint">{explicacao}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Par nome/valor da ficha. Valor ausente vira travessão, nunca espaço em branco. */
export function Dado({ nome, children }: { nome: string; children: ReactNode }) {
  const vazio = children === null || children === undefined || children === "";
  return (
    <div className="border-b border-linha py-2 last:border-0">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-texto-faint">{nome}</dt>
      <dd className={`mt-0.5 text-sm ${vazio ? "text-texto-faint" : ""}`}>
        {vazio ? "—" : children}
      </dd>
    </div>
  );
}

/** A situação da assinatura, sempre com a mesma cor em toda a área. */
export function Situacao({ status }: { status: string }) {
  const cor =
    {
      trial: "border-acento/40 bg-acento/10 text-acento",
      ativo: "border-ok/40 bg-ok/10 text-ok",
      /* Cortesia tem cor PRÓPRIA, e não a do ativo, de propósito: as duas se
         parecem no acesso e são opostas no dinheiro. O painel existe para o
         dono responder "quanto entra", e duas linhas verdes iguais em que uma
         paga e a outra não é a leitura errada que ele mais paga caro. */
      cortesia: "border-acento-alto/40 bg-acento-alto/10 text-acento-alto",
      inadimplente: "border-alerta/40 bg-alerta/10 text-alerta",
      cancelado: "border-erro/40 bg-erro/10 text-erro",
    }[status] ?? "border-linha text-texto-soft";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${cor}`}>
      {status}
    </span>
  );
}

/**
 * Barra de proporção, desenhada com div.
 *
 * Sem biblioteca de gráfico: uma barra é uma div com largura em porcentagem, e
 * trazer um pacote inteiro para isso custaria mais bytes no navegador do que o
 * painel inteiro pesa.
 */
export function Barra({ fracao, tom = "acento" }: { fracao: number; tom?: "acento" | "ok" | "alerta" }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(fracao) ? fracao : 0)) * 100;
  const cor = { acento: "bg-acento", ok: "bg-ok", alerta: "bg-alerta" }[tom];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-carbon-2">
      <div className={`h-full rounded-full ${cor}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const DATA = { day: "2-digit", month: "short", year: "numeric" } as const;

/** Data curta, ou travessão. Uma função só, para o painel inteiro falar igual. */
export function data(d: Date | string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString("pt-BR", DATA) : "—";
}

/** Data com hora — para o log de auditoria, onde a hora é o que se procura. */
export function dataHora(d: Date | string | null | undefined): string {
  return d
    ? new Date(d).toLocaleString("pt-BR", { ...DATA, hour: "2-digit", minute: "2-digit" })
    : "—";
}

export const porcento = (f: number) =>
  `${(Number.isFinite(f) ? f * 100 : 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
