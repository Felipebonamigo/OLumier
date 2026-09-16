import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { buscarTenantPorId } from "@/lib/tenants";
import { consultar, consultarUm } from "@/lib/db";
import { marca } from "@/config/marca";
import { SECAO_SITE_NO_AR } from "@/config/site-do-estudio";
import { lerSite } from "@/lib/site-estudio";
import { EditorSite } from "@/components/editor-site";
import { EnderecoDoEstudio } from "@/components/endereco-do-estudio";
import { nomeDoRegistroTxt, valorDoRegistroTxt } from "@/lib/dominio-proprio";

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
  /* Fora do ar a pedido do Juan em 16/09/2026. 404 e não "acesso negado": para
     quem entra, esta tela simplesmente não existe hoje — é o mesmo tratamento
     que `/painel/admin` dá a quem não é admin. Ver `config/site-do-estudio.ts`. */
  if (!SECAO_SITE_NO_AR) notFound();

  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) redirect("/entrar");

  const site = lerSite(tenant.site);

  /*
   * As três colunas do domínio próprio, em consulta separada.
   *
   * Poderiam vir do `select *` de `buscarTenantPorId`, mas a interface `Tenant`
   * teria de crescer — e `lib/tenants.ts` é dos arquivos mais disputados do
   * repositório. Uma consulta de três colunas é mais barata que um conflito, e
   * diz na cara o que esta tela precisa.
   */
  const dom = await consultarUm<{
    dominio_proprio: string | null;
    dominio_token: string | null;
    dominio_verificado_em: Date | null;
  }>(
    `select dominio_proprio, dominio_token, dominio_verificado_em
       from tenants where id = $1`,
    [tenantId],
  );

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

      <EnderecoDoEstudio
        dominio={dom?.dominio_proprio ?? null}
        verificado={Boolean(dom?.dominio_verificado_em)}
        registroNome={dom?.dominio_proprio ? nomeDoRegistroTxt(dom.dominio_proprio) : null}
        registroValor={dom?.dominio_token ? valorDoRegistroTxt(dom.dominio_token) : null}
        /* Para onde o A record aponta. Sem isto configurado, a tela diz para
         * falar com o suporte em vez de mostrar um endereço em branco. */
        ipDoServidor={process.env.IP_PUBLICO ?? null}
        enderecoDaPlataforma={`${tenant.slug}.${marca.dominio}`}
      />
    </main>
  );
}
