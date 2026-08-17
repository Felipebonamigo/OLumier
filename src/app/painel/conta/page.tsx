import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { buscarTenantPorId, formatarBytes } from "@/lib/tenants";
import { planoPorId, formatarReais } from "@/config/planos";

export const metadata: Metadata = { title: "Conta" };
export const dynamic = "force-dynamic";

export default async function ContaPage() {
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) redirect("/entrar");

  const plano = planoPorId(tenant.plano_id);
  const trial =
    tenant.status === "trial" && tenant.trial_ate
      ? Math.max(
          0,
          Math.ceil((new Date(tenant.trial_ate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        )
      : null;

  const linhas = [
    { rotulo: "Estúdio", valor: tenant.nome_estudio },
    { rotulo: "E-mail", valor: tenant.email },
    { rotulo: "Endereço das galerias", valor: `/${tenant.slug}` },
    { rotulo: "Plano", valor: plano ? `${plano.nome} — ${formatarReais(plano.precoCentavos)}/mês` : tenant.plano_id },
    { rotulo: "Espaço", valor: `${formatarBytes(tenant.usado_bytes)} de ${formatarBytes(tenant.quota_bytes)}` },
    {
      rotulo: "Situação",
      valor:
        trial !== null
          ? `Teste grátis — ${trial} ${trial === 1 ? "dia restante" : "dias restantes"}`
          : tenant.status,
    },
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Conta</h1>

      <dl className="mt-8 divide-y divide-linha rounded-xl border border-linha bg-carbon">
        {linhas.map((l) => (
          <div key={l.rotulo} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4">
            <dt className="min-w-[10rem] text-sm text-texto-soft">{l.rotulo}</dt>
            <dd className="text-sm font-medium">{l.valor}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 text-xs text-texto-faint">
        Trocar de plano e forma de pagamento entram quando a cobrança for ligada.
      </p>
    </main>
  );
}
