import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { buscarTenantPorId } from "@/lib/tenants";
import { consultar } from "@/lib/db";
import { marca } from "@/config/marca";
import { lerSite } from "@/lib/site-estudio";
import { EditorSite } from "@/components/editor-site";

export const metadata: Metadata = { title: "Site do estúdio" };
export const dynamic = "force-dynamic";

/**
 * Onde o fotógrafo escreve a vitrine dele.
 *
 * Tela própria e não mais uma seção da Conta: Conta é assinatura, espaço e
 * senha — coisas que se olha uma vez por mês. Isto aqui é o site que ele mostra
 * para quem ainda não contratou, e vai voltar a mexer sempre que a agenda ou o
 * texto mudarem.
 */
export default async function SitePage() {
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) redirect("/entrar");

  const site = lerSite(tenant.site);

  /*
   * A mesma peneira da vitrine: publicada, no ar, sem senha e dentro do prazo.
   * Uma lista mais larga aqui ofereceria como capa do site uma galeria que a
   * página pública se recusa a mostrar — e a capa apareceria em branco sem
   * explicação nenhuma.
   */
  const galerias = await consultar<{ slug: string; titulo: string }>(
    `select slug, titulo
       from galerias
      where tenant_id = $1
        and publicada
        and estado = 'online'
        and senha_hash is null
        and (expira_em is null or expira_em > now())
      order by coalesce(data_evento, criado_em::date) desc
      limit 60`,
    [tenantId],
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Site do estúdio</h1>
      <p className="mt-2 text-sm text-texto-soft">
        A página que abre no seu endereço, antes das galerias. É o que o casal vê quando ainda está
        decidindo — quem é você, o que já entregou e como falar contigo.
      </p>

      <EditorSite
        site={site}
        galerias={galerias}
        endereco={`https://${tenant.slug}.${marca.dominio}`}
      />
    </main>
  );
}
