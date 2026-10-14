import Link from "next/link";
import { DIAS_DE_TESTE, TETO_TRIAL_GB } from "@/config/trial";
import { formatarBytes } from "@/lib/tenants";
import { faltamPorExtenso, type LembreteDoTeste } from "@/lib/lembrete-do-teste";

/**
 * Os dois limites do teste, à vista na tela das galerias (14/10/2026).
 *
 * Fica sempre enquanto a conta está no teste — não só quando aperta —, porque o
 * problema que a trouxe era a surpresa: uma usuária viu "erro" ao subir uma
 * galeria sem saber que o teste vence e que tem 10 GB. Calma quando folgado
 * (uma linha, sem cor de alarme); chama atenção quando um dos limites está
 * perto ou já estourou, e então diz O QUE parou e o que fazer.
 *
 * Componente de servidor: só desenha o que `lembreteDoTeste` já decidiu.
 */
export function AvisoDoTeste({ lembrete: l }: { lembrete: LembreteDoTeste }) {
  const vencido = l.tempo === "vencido";
  const cheio = l.espaco === "cheio";

  const titulo = vencido
    ? "Seu teste grátis terminou"
    : cheio
      ? "O espaço do seu teste acabou"
      : l.tempo === "acabando"
        ? `Seu teste grátis termina em ${l.diasRestantes === 1 ? "1 dia" : `${l.diasRestantes} dias`}`
        : l.espaco === "enchendo"
          ? "O espaço do seu teste está quase cheio"
          : "Você está no teste grátis";

  const consequencia = vencido
    ? "Novos envios estão bloqueados. Ative a assinatura para voltar a enviar — as galerias já publicadas seguem no ar por mais 15 dias."
    : cheio
      ? "Novos envios estão bloqueados até a assinatura ser ativada. O que já foi enviado continua onde está."
      : `O teste tem dois limites: ${DIAS_DE_TESTE} dias e ${TETO_TRIAL_GB} GB. O que chegar primeiro bloqueia novos envios; a assinatura libera o espaço completo do plano.`;

  const diasUsados = Math.min(DIAS_DE_TESTE, Math.max(0, DIAS_DE_TESTE - l.diasRestantes));

  return (
    <section
      aria-label="Limites do período de teste"
      role={l.pedeAtencao ? "alert" : undefined}
      className={`mt-6 rounded-xl border px-5 py-4 ${
        l.pedeAtencao ? "border-alerta/50 bg-alerta/10" : "border-linha bg-carbon"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h2 className="text-sm font-semibold">{titulo}</h2>
          <p className="mt-1 text-xs leading-relaxed text-texto-soft">{consequencia}</p>
        </div>
        <Link
          href="/painel/conta"
          className={`shrink-0 rounded-lg px-4 py-2 text-xs font-semibold transition ${
            l.pedeAtencao
              ? "bg-acento text-void hover:bg-acento-alto"
              : "border border-linha-forte hover:bg-carbon-2"
          }`}
        >
          Ativar a assinatura
        </Link>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Medidor
          rotulo="Tempo"
          valor={vencido ? "terminou" : faltamPorExtenso(l.diasRestantes)}
          fracao={diasUsados / DIAS_DE_TESTE}
          alerta={l.tempo !== "folgado"}
        />
        <Medidor
          rotulo="Espaço"
          valor={`${formatarBytes(l.usadoBytes)} de ${TETO_TRIAL_GB} GB`}
          fracao={l.fracaoDoEspaco}
          alerta={l.espaco !== "folgado"}
        />
      </dl>
    </section>
  );
}

function Medidor({
  rotulo,
  valor,
  fracao,
  alerta,
}: {
  rotulo: string;
  valor: string;
  fracao: number;
  alerta: boolean;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, fracao)) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <dt className="text-texto-faint">{rotulo}</dt>
        <dd className={`tabular-nums ${alerta ? "font-semibold text-alerta" : "text-texto-soft"}`}>{valor}</dd>
      </div>
      <div
        role="progressbar"
        aria-label={rotulo}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-carbon-2"
      >
        <div
          className={`h-full rounded-full ${alerta ? "bg-alerta" : "bg-acento"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
