import type { Metadata } from "next";
import Link from "next/link";
import { exigirAdmin, metadataDeAdmin } from "@/lib/portao-admin";
import { marca } from "@/config/marca";
import { PRODUTOS_DA_BIO } from "@/config/bio";
import { resumoDaBio } from "@/lib/bio";
import { Bloco, Barra, Cartao, porcento } from "@/components/admin-pecas";

export async function generateMetadata(): Promise<Metadata> {
  return metadataDeAdmin("Link da bio");
}

export const dynamic = "force-dynamic";

const PERIODOS = [
  { dias: 7, rotulo: "7 dias" },
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
  { dias: 0, rotulo: "desde o começo" },
] as const;

/** "2026-10-07" → "07/10", sem passar por Date (que o fuso do servidor entortaria). */
const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * O LINK DA BIO, em números — a leitura da página-ponte `/bio`.
 *
 * Só leitura, como o resto do admin. Responde as quatro perguntas do pedido
 * (07/10/2026): quantos chegaram, quantos clicaram em cada produto, qual a
 * divisão entre eles, e de onde vieram as contas criadas. O desenho e os
 * limites da medição estão em `docs/bio.md`.
 */
export default async function BioAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  await exigirAdmin();
  const { dias: pedido } = await searchParams;
  const dias = PERIODOS.find((p) => String(p.dias) === pedido)?.dias ?? 30;
  const r = await resumoDaBio(dias);

  const cliquesNosProdutos = PRODUTOS_DA_BIO.reduce((soma, p) => soma + (r.cliques[p.evento] ?? 0), 0);
  const link = `https://${marca.dominio}/bio/instagram`;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/painel/admin" className="text-sm text-texto-soft hover:text-texto">
        ← Administração
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">Link da bio</h1>
      <p className="mt-1 max-w-3xl text-sm text-texto-soft">
        A página-ponte do Instagram (<span className="font-mono">/bio</span>): quantos chegaram, para
        qual produto foram e de onde vieram as contas.
      </p>

      <nav aria-label="Período" className="mt-5 flex flex-wrap gap-2">
        {PERIODOS.map((p) => (
          <Link
            key={p.dias}
            href={`/painel/admin/bio?dias=${p.dias}`}
            aria-current={p.dias === dias ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              p.dias === dias
                ? "border-acento/40 bg-acento/10 text-acento"
                : "border-linha text-texto-soft hover:border-linha-forte"
            }`}
          >
            {p.rotulo}
          </Link>
        ))}
      </nav>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cartao rotulo="Acessos" valor={r.visitas.toLocaleString("pt-BR")} nota="abriram a página" />
        <Cartao
          rotulo="Pessoas"
          valor={r.pessoas.toLocaleString("pt-BR")}
          nota="por dia, somadas — estimativa"
        />
        <Cartao
          rotulo="Cliques nos produtos"
          valor={cliquesNosProdutos.toLocaleString("pt-BR")}
          nota={r.visitas > 0 ? `${porcento(cliquesNosProdutos / r.visitas)} dos acessos` : undefined}
          tom="acento"
        />
        <Cartao rotulo="Cliques em Entrar" valor={r.entrar.toLocaleString("pt-BR")} nota="já são clientes" />
      </div>

      <Bloco
        titulo="Para onde foi o interesse"
        explicacao="Cada clique num botão de produto, e a fatia de cada um entre os cliques nos produtos."
      >
        <ul className="divide-y divide-linha rounded-xl border border-linha bg-carbon">
          {PRODUTOS_DA_BIO.map((p) => {
            const n = r.cliques[p.evento] ?? 0;
            return (
              <li key={p.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">{p.nome}</span>
                  <span className="text-sm tabular-nums">
                    {n.toLocaleString("pt-BR")} cliques
                    <span className="ml-2 text-texto-faint">
                      {cliquesNosProdutos > 0 ? porcento(n / cliquesNosProdutos) : "—"} dos cliques
                      {r.visitas > 0 ? ` · ${porcento(n / r.visitas)} dos acessos` : ""}
                    </span>
                  </span>
                </div>
                <div className="mt-2">
                  <Barra fracao={cliquesNosProdutos > 0 ? n / cliquesNosProdutos : 0} />
                </div>
              </li>
            );
          })}
        </ul>
      </Bloco>

      <Bloco
        titulo="Contas criadas vindas da bio"
        explicacao='Só a Galeria Átomo: quem clicou num produto na ponte e, até 30 dias depois, criou conta no mesmo navegador. "instagram/bio/atomatiza" é quem clicou na Atomatiza e acabou criando conta aqui.'
      >
        {r.contas.length === 0 ? (
          <p className="text-sm text-texto-faint">Nenhuma conta com origem neste período.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-linha">
            <table className="w-full text-sm">
              <thead className="bg-carbon text-left font-mono text-[10px] uppercase tracking-widest text-texto-faint">
                <tr>
                  <th className="px-4 py-2">Origem</th>
                  <th className="px-4 py-2">Campanha</th>
                  <th className="px-4 py-2 text-right">Contas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linha">
                {r.contas.map((c) => (
                  <tr key={`${c.origem}|${c.campanha}`}>
                    <td className="px-4 py-2 font-mono text-xs">{c.origem}</td>
                    <td className="px-4 py-2 font-mono text-xs">{c.campanha}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.contas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      <Bloco titulo="Dia a dia" explicacao="Em horário de Brasília, do mais recente para o mais antigo.">
        {r.dias.length === 0 ? (
          <p className="text-sm text-texto-faint">Nenhum acesso registrado neste período.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-linha">
            <table className="w-full text-sm">
              <thead className="bg-carbon text-left font-mono text-[10px] uppercase tracking-widest text-texto-faint">
                <tr>
                  <th className="px-4 py-2">Dia</th>
                  <th className="px-4 py-2 text-right">Acessos</th>
                  {PRODUTOS_DA_BIO.map((p) => (
                    <th key={p.id} className="px-4 py-2 text-right">
                      {p.nome}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right">Entrar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linha">
                {r.dias.map((d) => (
                  <tr key={d.dia}>
                    <td className="px-4 py-2 font-mono text-xs">{diaCurto(d.dia)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{d.visitas}</td>
                    {PRODUTOS_DA_BIO.map((p) => (
                      <td key={p.id} className="px-4 py-2 text-right tabular-nums">
                        {d.cliques[p.evento] ?? 0}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right tabular-nums">{d.entrar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      <Bloco
        titulo="De onde vieram"
        explicacao='A fonte e a campanha (o "utm_source" e o "utm_campaign" do link). "direto" é quando o navegador não disse de onde veio e o link não trazia UTM.'
      >
        {r.origens.length === 0 ? (
          <p className="text-sm text-texto-faint">Nada neste período.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-linha">
            <table className="w-full text-sm">
              <thead className="bg-carbon text-left font-mono text-[10px] uppercase tracking-widest text-texto-faint">
                <tr>
                  <th className="px-4 py-2">Fonte</th>
                  <th className="px-4 py-2">Campanha</th>
                  <th className="px-4 py-2 text-right">Acessos</th>
                  <th className="px-4 py-2 text-right">Cliques</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linha">
                {r.origens.map((o) => (
                  <tr key={`${o.fonte}|${o.campanha}`}>
                    <td className="px-4 py-2 font-mono text-xs">{o.fonte}</td>
                    <td className="px-4 py-2 font-mono text-xs">{o.campanha}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{o.visitas}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{o.cliques}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      <Bloco
        titulo="O link para colocar na bio"
        explicacao="Limpo, e já diz que a visita veio do Instagram — o navegador de dentro dele nem sempre informa de onde a pessoa veio."
      >
        <p className="break-all rounded-xl border border-linha bg-carbon px-4 py-3 font-mono text-xs">{link}</p>
        <p className="mt-3 max-w-3xl text-xs text-texto-faint">
          Para separar posts, anúncios ou stories, acrescente a campanha:{" "}
          <span className="font-mono">{link}?utm_campaign=lancamento-galeria</span>. Só letras minúsculas,
          números, ponto, hífen e sublinhado. Os números são estimativas honestas, e não auditoria:
          &ldquo;pessoas&rdquo; é um hash que muda todo dia (sem cookie), então a mesma pessoa em dois
          dias conta duas vezes e duas pessoas na mesma rede móvel com o mesmo modelo de celular contam
          uma só. Robôs e pré-visualizações de link não entram.
        </p>
        <p className="mt-2 max-w-3xl text-xs text-texto-faint">
          O que o Instagram já mostra em &ldquo;Atividade do perfil&rdquo; (visitas ao perfil e toques
          no link da bio) vem ANTES desta tela: ele conta quem tocou no link; aqui se vê quem abriu a
          página, em qual produto clicou e quem criou conta.
        </p>
      </Bloco>
    </main>
  );
}
