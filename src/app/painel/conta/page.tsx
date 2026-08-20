import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { buscarTenantPorId, formatarBytes } from "@/lib/tenants";
import { usoPorEstado } from "@/lib/cofre";
import { planoPorId, formatarReais } from "@/config/planos";
import { asaasConfigurado, asaasEmProducao, proximaCobranca } from "@/lib/asaas";
import { conferirConfiguracao } from "@/config/socios";
import { AssinaturaBotao } from "@/components/assinatura-botao";
import { situacaoDoTenant } from "@/lib/assinatura";
import { PlanoConta } from "@/components/plano-conta";

export const metadata: Metadata = { title: "Conta" };
export const dynamic = "force-dynamic";

const SITUACOES: Record<string, { texto: string; cor: string }> = {
  trial: { texto: "Teste grátis", cor: "text-luz" },
  ativo: { texto: "Assinatura ativa", cor: "text-ok" },
  inadimplente: { texto: "Pagamento em atraso", cor: "text-alerta" },
  cancelado: { texto: "Assinatura cancelada", cor: "text-erro" },
};

export default async function ContaPage() {
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) redirect("/entrar");

  const plano = planoPorId(tenant.plano_id);
  const uso = await usoPorEstado(tenantId);

  const diasTrial =
    tenant.status === "trial" && tenant.trial_ate
      ? Math.max(
          0,
          Math.ceil((new Date(tenant.trial_ate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        )
      : null;

  // Só consulta o Asaas se houver assinatura — evita chamada externa à toa.
  const cobranca =
    asaasConfigurado() && tenant.asaas_assinatura_id
      ? await proximaCobranca(tenant.asaas_assinatura_id).catch(() => null)
      : null;

  // Estado da divisão entre sócios — carteira faltando não quebra a cobrança,
  // mas precisa ficar visível para não passar despercebido.
  const { ok: splitOk, avisos: avisosSplit } = conferirConfiguracao();

  const situacao = SITUACOES[tenant.status] ?? { texto: tenant.status, cor: "text-texto-soft" };
  const situacaoEnvio = situacaoDoTenant(tenant, asaasConfigurado());

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Conta</h1>

      {/* Assinatura */}
      <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Assinatura</h2>
          <span className={`text-xs font-medium ${situacao.cor}`}>
            {situacao.texto}
            {diasTrial !== null && ` · ${diasTrial} ${diasTrial === 1 ? "dia" : "dias"}`}
          </span>
        </div>

        <p className="mt-2 text-sm text-texto-soft">
          {plano ? (
            <>
              {plano.nome} — <strong className="text-texto">{formatarReais(plano.precoCentavos)}</strong>
              /mês
            </>
          ) : (
            tenant.plano_id
          )}
        </p>

        <PlanoConta
          planoAtual={tenant.plano_id}
          temAssinatura={Boolean(tenant.asaas_assinatura_id)}
        />

        {cobranca ? (
          <div className="mt-4 rounded-lg border border-linha bg-void px-4 py-3">
            <p className="text-xs text-texto-soft">
              Próxima cobrança em{" "}
              {new Date(cobranca.dueDate).toLocaleDateString("pt-BR")} ·{" "}
              {formatarReais(Math.round(cobranca.value * 100))}
            </p>
            <a
              href={cobranca.invoiceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-luz underline underline-offset-4"
            >
              Ver e pagar ↗
            </a>
          </div>
        ) : (
          <AssinaturaBotao
            temAssinatura={Boolean(tenant.asaas_assinatura_id)}
            cobrancaLigada={asaasConfigurado()}
            documentoSalvo={tenant.cpf_cnpj}
          />
        )}

        {/* Aviso só quando a cobrança está ligada mas o split não foi configurado:
            enquanto tudo fica na conta principal, é fácil esquecer que os sócios
            não estão recebendo. */}
        {asaasConfigurado() && !splitOk && (
          <div className="mt-3 rounded-lg border border-linha bg-void px-3 py-2 text-xs text-texto-faint">
            <p className="font-medium text-texto-soft">Divisão entre sócios ainda não configurada</p>
            <ul className="mt-1 list-disc pl-4">
              {avisosSplit.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p className="mt-1">Por enquanto, o valor inteiro fica na conta principal.</p>
          </div>
        )}

        {/* Quando o envio está travado, dizer aqui — senão a pessoa só descobre
            no meio de um upload que falha, sem entender por quê. */}
        {!situacaoEnvio.podeEnviar && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta"
          >
            {situacaoEnvio.recado}
          </p>
        )}

        {asaasConfigurado() && !asaasEmProducao() && (
          <p className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta">
            Cobrança em modo de teste — nenhum dinheiro é movimentado de verdade.
          </p>
        )}
      </section>

      {/* Espaço — dois baldes independentes, cada um com seu limite. */}
      <section className="mt-6 rounded-xl border border-linha bg-carbon p-5">
        <h2 className="text-sm font-semibold">Espaço</h2>
        <div className="mt-4 space-y-4">
          <Balde
            rotulo="Galerias no ar"
            usado={uso.noAr}
            limite={BigInt(tenant.quota_bytes)}
            nota="O que seus clientes conseguem abrir agora."
          />
          <Balde
            rotulo="Cofre"
            usado={uso.noCofre}
            limite={BigInt(tenant.quota_cofre_bytes)}
            nota="Guardado, fora do ar. Mandar para cá libera espaço nas galerias."
          />
        </div>
      </section>

      {/* Dados */}
      <section className="mt-6 rounded-xl border border-linha bg-carbon">
        <dl className="divide-y divide-linha">
          {[
            { rotulo: "Estúdio", valor: tenant.nome_estudio },
            { rotulo: "E-mail", valor: tenant.email },
            { rotulo: "Endereço das galerias", valor: `/${tenant.slug}` },
          ].map((l) => (
            <div key={l.rotulo} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4">
              <dt className="min-w-[10rem] text-sm text-texto-soft">{l.rotulo}</dt>
              <dd className="text-sm font-medium">{l.valor}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}

/**
 * Uma barra de uso. Mostra a porcentagem porque "2,1 TB de 5 TB" exige conta de
 * cabeça, e a pessoa só quer saber se está perto do fim.
 *
 * Acima do limite a barra fica cheia e muda de cor em vez de estourar o
 * contêiner — passar do cofre é possível (o arquivamento automático não recusa,
 * ver src/lib/cofre.ts) e a tela precisa mostrar isso com clareza.
 */
function Balde({
  rotulo,
  usado,
  limite,
  nota,
}: {
  rotulo: string;
  usado: bigint;
  limite: bigint;
  nota: string;
}) {
  const pct = limite > BigInt(0) ? Number((usado * BigInt(1000)) / limite) / 10 : 0;
  const estourou = usado > limite;
  const apertado = pct >= 85;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-xs font-medium text-texto-soft">{rotulo}</span>
        <span
          className={`font-mono text-[11px] tabular-nums ${
            estourou ? "text-erro" : apertado ? "text-alerta" : "text-texto-faint"
          }`}
        >
          {formatarBytes(usado)} de {formatarBytes(limite)}
          {limite > BigInt(0) && ` · ${pct.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-void">
        <div
          className={`h-full rounded-full ${
            estourou ? "bg-erro" : apertado ? "bg-alerta" : "bg-luz"
          }`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-texto-faint">
        {estourou ? "Acima do limite do plano — libere espaço ou aumente o plano." : nota}
      </p>
    </div>
  );
}
