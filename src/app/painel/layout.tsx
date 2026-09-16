import Link from "next/link";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { espacoSemLimite, quotaEfetivaBytes } from "@/config/trial";
import { buscarTenantPorId, formatarBytes } from "@/lib/tenants";
import { usoDoEstudio } from "@/lib/medias";
import { MarcaLockup } from "@/components/marca-tile";
import { SeletorTema } from "@/components/seletor-tema";
import { ehAdmin } from "@/config/admin";
import { sairAction } from "../(auth)/actions";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  /*
   * Validação de verdade: o proxy só olhou se o cookie EXISTE. Aqui conferimos a
   * assinatura e se o estúdio ainda está no banco — cookie forjado morre aqui.
   *
   * A recusa passa por `/api/sessao/expirada` e não vai direto para `/entrar`,
   * e isso não é rodeio: mandar para `/entrar` com o cookie ainda no navegador
   * fecha uma armadilha — o proxy vê o cookie, devolve para `/painel`, o layout
   * recusa de novo, e a pessoa toma ERR_TOO_MANY_REDIRECTS sem conseguir chegar
   * na tela de entrar. Aconteceu em produção em 27/08/2026.
   *
   * Componente de servidor não pode mexer em cookie; a rota pode, e é só isso
   * que ela faz antes de mandar para `/entrar`.
   */
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/api/sessao/expirada");

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) redirect("/api/sessao/expirada");

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
  const semLimite = espacoSemLimite(tenant);
  const proporcao = !semLimite && quota > 0 ? Math.min(usado / quota, 1) : 0;
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
            {/* O tema era escolha da home, e a home é a página que o fotógrafo
                vê uma vez. Quem passa a tarde subindo 200 fotos vive aqui — e
                aqui não havia como trocar. Fica por último na barra porque é
                ajuste, não navegação. */}
            <SeletorTema className="ml-1" />
          </nav>
        </div>

        {/* Espaço usado: é a quota do cliente e, do nosso lado, o custo. Fica sempre visível. */}
        <div className="mx-auto max-w-5xl px-6 pb-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-texto-soft">
              {tenant.nome_estudio} · {formatarBytes(usado)}
              {semLimite ? " · sem limite" : ` de ${formatarBytes(quota)}`}
            </span>
            {!semLimite && (
              <span className={perto ? "text-alerta" : "text-texto-faint"}>
                {(proporcao * 100).toFixed(proporcao < 0.1 ? 1 : 0)}% usado
              </span>
            )}
          </div>
          {!semLimite && (
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
          )}
        </div>
      </header>

      {children}
    </div>
  );
}
