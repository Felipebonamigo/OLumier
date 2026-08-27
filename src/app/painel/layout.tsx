import Link from "next/link";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { quotaEfetivaBytes } from "@/config/trial";
import { buscarTenantPorId, formatarBytes } from "@/lib/tenants";
import { usoDoEstudio } from "@/lib/medias";
import { MarcaLockup } from "@/components/marca-tile";
import { ehAdmin } from "@/config/admin";
import { sairAction } from "../(auth)/actions";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  // Validação de verdade: o proxy só olhou se o cookie existe. Aqui conferimos a
  // assinatura e se o tenant ainda existe no banco — cookie forjado morre neste ponto.
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) redirect("/entrar");

  /*
   * A barra do topo mostra só o espaço NO AR, que é o que a quota do plano
   * limita. Usar `tenant.usado_bytes` (mantido pelo trigger) somaria o cofre
   * junto: um estúdio com 250 GB guardados apareceria como "250 GB de 200 GB"
   * aqui e "0 GB de 200 GB" na tela de Conta — a mesma pessoa vendo dois
   * números diferentes para a mesma coisa.
   */
  const { noAr } = await usoDoEstudio(tenantId);
  const usado = Number(noAr);
  const quota = Number(quotaEfetivaBytes(tenant));
  const proporcao = quota > 0 ? Math.min(usado / quota, 1) : 0;
  const perto = proporcao >= 0.8;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-linha">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-4">
          <Link href="/painel">
            <MarcaLockup tamanho={40} />
          </Link>

          <nav className="ml-auto flex items-center gap-1 text-sm">
            <Link
              href="/painel"
              className="rounded-lg px-3 py-2 text-texto-soft transition hover:bg-carbon hover:text-texto"
            >
              Galerias
            </Link>
            <Link
              href="/painel/site"
              className="rounded-lg px-3 py-2 text-texto-soft transition hover:bg-carbon hover:text-texto"
            >
              Site
            </Link>
            <Link
              href="/painel/conta"
              className="rounded-lg px-3 py-2 text-texto-soft transition hover:bg-carbon hover:text-texto"
            >
              Conta
            </Link>
            {/* Só para quem está na lista ADMINS. Para todo o resto o link não
                existe — e a rota devolve 404, não "acesso negado". */}
            {ehAdmin(tenant.email) && (
              <Link
                href="/painel/admin"
                className="rounded-lg px-3 py-2 text-acento transition hover:bg-carbon"
              >
                Admin
              </Link>
            )}
            <form action={sairAction}>
              <button
                type="submit"
                className="rounded-lg px-3 py-2 text-texto-soft transition hover:bg-carbon hover:text-texto"
              >
                Sair
              </button>
            </form>
          </nav>
        </div>

        {/* Espaço usado: é a quota do cliente e, do nosso lado, o custo. Fica sempre visível. */}
        <div className="mx-auto max-w-5xl px-6 pb-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-texto-soft">
              {tenant.nome_estudio} · {formatarBytes(usado)} de {formatarBytes(quota)}
            </span>
            <span className={perto ? "text-alerta" : "text-texto-faint"}>
              {(proporcao * 100).toFixed(proporcao < 0.1 ? 1 : 0)}% usado
            </span>
          </div>
          <div
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-carbon-2"
            role="progressbar"
            aria-valuenow={Math.round(proporcao * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Espaço usado"
          >
            <div
              className={`h-full rounded-full ${perto ? "bg-alerta" : "bg-acento"}`}
              style={{ width: `${Math.max(proporcao * 100, 0.5)}%` }}
            />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
