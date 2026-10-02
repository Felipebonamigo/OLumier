import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { consultar } from "@/lib/db";
import { buscarTenantPorId, formatarBytes } from "@/lib/tenants";
import { bytesUsados } from "@/lib/medias";
import { quotaEfetivaBytes } from "@/config/trial";
import { situacaoDoTenant } from "@/lib/assinatura";
import { asaasConfigurado } from "@/lib/asaas";
import { ProvedorDeEnvio } from "@/components/envio-em-curso";
import { ImportarGalerias } from "@/components/importar-galerias";
import { MigrarDeOutraPlataforma } from "@/components/migrar-de-outra-plataforma";
import { loginLiberado } from "@/config/plataformas-de-origem";

export const metadata: Metadata = { title: "Importar galerias" };
export const dynamic = "force-dynamic";

/**
 * Trazer o acervo de outro lugar — várias galerias de uma vez.
 *
 * A fila de envio é a MESMA da aba Fotos (`ProvedorDeEnvio`), montada aqui sem
 * galeria: cada lote diz a sua. Ver `lib/importacao.ts` para as regras de como
 * uma pasta ou um ZIP vira galeria.
 */
export default async function ImportarPage() {
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/api/sessao/expirada");
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) redirect("/api/sessao/expirada");

  /* As galerias que já existem, para a importação continuar numa delas em vez
     de criar a mesma de novo — é o que torna rodar outra vez seguro. A lixeira
     fica de fora: galeria apagada não é destino. */
  const existentes = await consultar<{ id: string; titulo: string; estado: string }>(
    `select id, titulo, estado from galerias
      where tenant_id = $1 and estado <> 'lixeira'
      order by criado_em desc`,
    [tenantId],
  );

  /* Pode dar negativo: no trial a quota efetiva é rebaixada ao teto, e quem já
     usava mais do que ele fica sem espaço livre — é zero, não um número negativo. */
  const sobra = quotaEfetivaBytes(tenant) - (await bytesUsados(tenantId));
  const livre = sobra > BigInt(0) ? sobra : BigInt(0);
  const situacao = situacaoDoTenant(tenant, asaasConfigurado());

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Link href="/painel" className="text-sm text-texto-soft hover:text-texto">
        ← Galerias
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">Importar galerias</h1>
      <p className="mt-1 max-w-[70ch] text-sm text-texto-soft">
        Para trazer várias galerias de uma vez — o acervo de outra plataforma, ou a pasta do HD
        onde você guarda os trabalhos. Cada pasta ou ZIP vira uma galeria, e as pastas de dentro
        viram capítulos.
      </p>

      <ProvedorDeEnvio escopo="/painel/importar">
        <ImportarGalerias
          existentes={existentes}
          livreBytes={Number(livre)}
          livreTexto={formatarBytes(livre)}
          bloqueio={situacao.podeEnviar ? null : (situacao.recado ?? "Sua conta não pode enviar arquivos agora.")}
        />
      </ProvedorDeEnvio>

      <MigrarDeOutraPlataforma
        liberadas={{
          pixieset: loginLiberado(tenant, "pixieset"),
          pixellu: loginLiberado(tenant, "pixellu"),
        }}
      />
    </main>
  );
}
