import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { buscarTenantPorId } from "@/lib/tenants";
import { urlDeLeitura } from "@/lib/r2";
import { CAPITULOS_SUGERIDOS } from "@/lib/secoes";
import { LogoEstudio } from "@/components/logo-estudio";
import { AssistenteNovaGaleria } from "./assistente";

export const metadata: Metadata = { title: "Nova galeria" };

export default async function NovaGaleriaPage() {
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/api/sessao/expirada");
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) redirect("/api/sessao/expirada");

  // O bucket não tem endereço público: a logo é guardada como chave e ganha um
  // link assinado de uma hora, só para esta tela. Mesmo caminho da tela de Conta.
  const urlLogo = tenant.logo_chave ? await urlDeLeitura(tenant.logo_chave, 3600) : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/painel" className="text-sm text-texto-soft hover:text-texto">
        ← Galerias
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">Nova galeria</h1>
      <p className="mt-1 text-sm text-texto-soft">
        Três etapas, e só a primeira é obrigatória. Estilo e capítulos dá para deixar para depois.
      </p>

      {/*
        A LOGO É DO ESTÚDIO, E APARECE NA ETAPA DO ESTILO.

        Ela não pertence a esta galeria — vale para todas, e é gravada no mesmo
        lugar de sempre. Mas a hora em que o fotógrafo pensa na própria marca é
        justamente quando está escolhendo a cara da entrega, e até aqui isso
        exigia abandonar a tarefa, achar a tela de Conta e voltar. O aviso de
        que vale para todas evita a leitura errada de que se está escolhendo uma
        logo "desta galeria".

        Vai como `slot` porque monta no SERVIDOR: a URL da logo é assinada aqui,
        e o assistente é componente de cliente.
      */}
      <AssistenteNovaGaleria
        capitulosSugeridos={CAPITULOS_SUGERIDOS}
        slotLogo={
          <section className="rounded-xl border border-linha bg-carbon p-5">
            <LogoEstudio
              nomeEstudio={tenant.nome_estudio}
              urlLogo={urlLogo}
              nota={
                <>
                  Aparece na capa no lugar do nome escrito. Vale para{" "}
                  <strong className="text-texto-soft">todas as suas galerias</strong>, não só esta —
                  e dá para trocar depois em Conta.
                </>
              }
            />
          </section>
        }
      />
    </main>
  );
}
