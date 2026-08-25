import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { buscarTenantPorId, formatarBytes } from "@/lib/tenants";
import { ehAdmin } from "@/config/admin";
import { panoramaDosEstudios } from "@/lib/admin";
import { planoPorId, formatarReais } from "@/config/planos";
import { marca } from "@/config/marca";

/**
 * O TÍTULO TAMBÉM PRECISA DO PORTÃO.
 *
 * Com `export const metadata`, o Next resolve o título ANTES de a página rodar —
 * então o `notFound()` lá embaixo devolvia 404 com "Administração · Olumier" na
 * aba. Nenhum dado de cliente vazava, mas confirmava que a rota existe, que é o
 * que a resposta 404 deveria justamente esconder. Um teste pegou isso.
 *
 * Para quem não é admin, o título é o mesmo de qualquer endereço inexistente.
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenantId = await sessaoAtual();
  const eu = tenantId ? await buscarTenantPorId(tenantId) : null;
  const neutro = { title: `${marca.nome} — ${marca.tagline}` };
  if (!eu || !ehAdmin(eu.email)) return neutro;
  return { title: "Administração", robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

const CORES: Record<string, string> = {
  trial: "text-acento",
  ativo: "text-ok",
  inadimplente: "text-alerta",
  cancelado: "text-erro",
};

export default async function AdminPage() {
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  const eu = await buscarTenantPorId(tenantId);

  /*
   * `notFound()` e não uma tela de "acesso negado".
   *
   * Uma mensagem de negado confirma que a página existe, e isso é informação
   * para quem estiver procurando. Do lado de fora, esta rota é indistinguível de
   * um endereço que nunca existiu — inclusive quando ADMINS está vazia, que é o
   * padrão.
   */
  if (!eu || !ehAdmin(eu.email)) notFound();

  const estudios = await panoramaDosEstudios();

  const totalNoAr = estudios.reduce((s, e) => s + BigInt(e.bytes_no_ar), BigInt(0));
  const totalCofre = estudios.reduce((s, e) => s + BigInt(e.bytes_no_cofre), BigInt(0));
  const pagantes = estudios.filter((e) => e.status === "ativo").length;
  const receita = estudios
    .filter((e) => e.status === "ativo")
    .reduce((s, e) => s + (planoPorId(e.plano_id)?.precoCentavos ?? 0), 0);

  const dias = (d: Date | null) =>
    d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/painel" className="text-sm text-texto-soft hover:text-texto">
        ← Galerias
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">Administração</h1>
      <p className="mt-1 text-sm text-texto-soft">
        Todos os estúdios da plataforma. Só leitura — nada aqui altera nada.
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { rotulo: "Estúdios", valor: String(estudios.length) },
          { rotulo: "Pagantes", valor: String(pagantes) },
          { rotulo: "Receita/mês", valor: formatarReais(receita) },
          { rotulo: "Armazenado", valor: formatarBytes(totalNoAr + totalCofre) },
        ].map((c) => (
          <div key={c.rotulo} className="rounded-xl border border-linha bg-carbon px-4 py-3">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-texto-faint">
              {c.rotulo}
            </dt>
            <dd className="mt-1 text-sm font-medium">{c.valor}</dd>
          </div>
        ))}
      </dl>

      {estudios.length === 0 ? (
        <p className="mt-10 text-sm text-texto-faint">Nenhum estúdio cadastrado ainda.</p>
      ) : (
        /* A tabela rola sozinha em vez de empurrar a página: num celular, tabela
           larga sem isto arrasta o layout inteiro para o lado. */
        <div className="mt-8 overflow-x-auto rounded-xl border border-linha">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-linha bg-carbon text-left">
                {["Estúdio", "Situação", "Plano", "Espaço", "No ar / guardado", "Galerias", "Último acesso"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-texto-faint"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {estudios.map((e) => {
                const plano = planoPorId(e.plano_id);
                const restam = e.status === "trial" ? dias(e.trial_ate) : null;
                const noAr = BigInt(e.bytes_no_ar);
                const guardado = BigInt(e.bytes_no_cofre);
                /* Espaço único desde a migração 016: o que aperta é a soma. */
                const usado = noAr + guardado;
                const quota = BigInt(e.quota_bytes);
                const apertado = quota > BigInt(0) && usado * BigInt(100) > quota * BigInt(85);

                return (
                  <tr key={e.id} className="border-b border-linha last:border-0 align-top">
                    <td className="px-4 py-3">
                      <span className="block font-medium">{e.nome_estudio}</span>
                      <span className="block text-xs text-texto-faint">{e.email}</span>
                      <span className="block font-mono text-[11px] text-texto-faint">/{e.slug}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${CORES[e.status] ?? "text-texto-soft"}`}>
                        {e.status}
                      </span>
                      {restam !== null && (
                        <span
                          className={`mt-0.5 block text-[11px] ${restam <= 3 ? "text-alerta" : "text-texto-faint"}`}
                        >
                          {restam <= 0 ? "trial vencido" : `${restam} dia${restam === 1 ? "" : "s"}`}
                        </span>
                      )}
                      {/* Sem documento não há como cobrar: a assinatura nem chega
                          a ser criada. É a primeira coisa a conferir quando
                          alguém diz que não consegue assinar. */}
                      {!e.cpf_cnpj && !e.tem_assinatura && (
                        <span className="mt-0.5 block text-[11px] text-texto-faint">sem CPF/CNPJ</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs">{plano?.nome ?? e.plano_id}</span>
                      {e.tem_assinatura && (
                        <span className="mt-0.5 block text-[11px] text-ok">assinatura ativa</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      <span className={apertado ? "text-alerta" : ""}>
                        {formatarBytes(usado)}
                      </span>
                      <span className="block text-[11px] text-texto-faint">
                        de {formatarBytes(quota)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-texto-faint">
                      {formatarBytes(noAr)}
                      <span className="block text-[11px]">{formatarBytes(guardado)} guardado</span>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums">
                      {e.galerias}
                      <span className="block text-[11px] text-texto-faint">
                        {e.publicadas} no ar · {e.medias} arquivos
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {/*
                        A pergunta por trás desta coluna: "o cliente dele chegou a
                        abrir?". Estúdio que enviou tudo e nunca teve acesso quase
                        sempre é link que não foi mandado.
                      */}
                      {e.ultimo_acesso ? (
                        new Date(e.ultimo_acesso).toLocaleDateString("pt-BR")
                      ) : (
                        <span className="text-texto-faint">nunca abriram</span>
                      )}
                      <span className="block text-[11px] text-texto-faint">
                        entrou {new Date(e.criado_em).toLocaleDateString("pt-BR")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
