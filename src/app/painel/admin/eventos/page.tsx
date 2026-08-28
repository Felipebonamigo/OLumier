import type { Metadata } from "next";
import Link from "next/link";
import { exigirAdmin, metadataDeAdmin } from "@/lib/portao-admin";
import {
  procurarEventos,
  acoesRegistradas,
  estudiosComEventos,
  POR_PAGINA_PADRAO,
} from "@/lib/admin";
import { dataHora } from "@/components/admin-pecas";

export async function generateMetadata(): Promise<Metadata> {
  return metadataDeAdmin("Histórico");
}

export const dynamic = "force-dynamic";

/**
 * A PESQUISA DO LOG DE AUDITORIA.
 *
 * O painel mostra os últimos oito eventos; esta tela alcança o resto. A
 * divisão existe porque uma limpeza de galeria despeja trinta `media.apagada`
 * no mesmo minuto: numa lista corrida, o barulho empurra para fora da tela
 * exatamente o evento que se estava procurando.
 *
 * ── SEM UMA LINHA DE JAVASCRIPT ───────────────────────────────────────────
 * Os filtros são um `<form method="get">` e o estado inteiro mora na URL. Sai
 * de graça o que um filtro em estado de cliente custaria a escrever: o botão
 * voltar funciona, a busca é um link que dá para colar num e-mail, e recarregar
 * a página não perde o filtro. Também é o degrau mais barato da escada — o
 * navegador já faz isto sozinho desde sempre.
 */
export default async function EventosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirAdmin();
  const sp = await searchParams;
  const texto = (c: string) => (typeof sp[c] === "string" ? (sp[c] as string) : "");

  const filtro = {
    acao: texto("acao"),
    tenantId: texto("estudio"),
    busca: texto("busca"),
    desde: texto("desde"),
    ate: texto("ate"),
    pagina: Number(texto("pagina")) || 1,
    porPagina: POR_PAGINA_PADRAO,
  };

  const [pagina, acoes, estudios] = await Promise.all([
    procurarEventos(filtro),
    acoesRegistradas(),
    estudiosComEventos(),
  ]);

  const temFiltro = Boolean(filtro.acao || filtro.tenantId || filtro.busca || filtro.desde || filtro.ate);

  /** Mantém os filtros ao trocar de página — só o número muda. */
  const linkDaPagina = (n: number) => {
    const p = new URLSearchParams();
    if (filtro.acao) p.set("acao", filtro.acao);
    if (filtro.tenantId) p.set("estudio", filtro.tenantId);
    if (filtro.busca) p.set("busca", filtro.busca);
    if (filtro.desde) p.set("desde", filtro.desde);
    if (filtro.ate) p.set("ate", filtro.ate);
    if (n > 1) p.set("pagina", String(n));
    const q = p.toString();
    return `/painel/admin/eventos${q ? `?${q}` : ""}`;
  };

  const campo =
    "w-full rounded-lg border border-linha bg-void px-3 py-2 text-sm placeholder:text-exemplo focus:border-acento focus:outline-none";
  const rotulo = "block font-mono text-[10px] uppercase tracking-widest text-texto-faint";

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/painel/admin" className="text-sm text-texto-soft hover:text-texto">
        ← Administração
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">Histórico</h1>
      <p className="mt-1 text-sm text-texto-soft">
        Tudo que aconteceu na plataforma. O log não se apaga nem se reescreve — o banco recusa.
      </p>

      {/* Os filtros. `method="get"` de propósito: o estado mora na URL. */}
      <form className="mt-6 rounded-xl border border-linha bg-carbon p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="lg:col-span-2">
            <span className={rotulo}>Buscar</span>
            <input
              type="search"
              name="busca"
              defaultValue={filtro.busca}
              placeholder="estúdio, ação ou id do alvo"
              className={`mt-1 ${campo}`}
            />
          </label>

          <label>
            <span className={rotulo}>Ação</span>
            <select name="acao" defaultValue={filtro.acao} className={`mt-1 ${campo}`}>
              <option value="">todas</option>
              {acoes.map((a) => (
                <option key={a.acao} value={a.acao}>
                  {a.acao} ({a.n})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className={rotulo}>Estúdio</span>
            <select name="estudio" defaultValue={filtro.tenantId} className={`mt-1 ${campo}`}>
              <option value="">todos</option>
              {estudios.map((e) => (
                <option key={e.tenant_id} value={e.tenant_id}>
                  {e.estudio}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className={rotulo}>De</span>
              <input type="date" name="desde" defaultValue={filtro.desde} className={`mt-1 ${campo}`} />
            </label>
            <label>
              <span className={rotulo}>Até</span>
              <input type="date" name="ate" defaultValue={filtro.ate} className={`mt-1 ${campo}`} />
            </label>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto"
          >
            Pesquisar
          </button>
          {temFiltro && (
            <Link href="/painel/admin/eventos" className="text-xs text-texto-faint underline underline-offset-4 hover:text-texto">
              limpar filtros
            </Link>
          )}
          <span className="ml-auto text-xs text-texto-faint tabular-nums">
            {pagina.total.toLocaleString("pt-BR")} evento{pagina.total === 1 ? "" : "s"}
            {pagina.paginas > 1 && ` · página ${pagina.pagina} de ${pagina.paginas}`}
          </span>
        </div>
      </form>

      {pagina.eventos.length === 0 ? (
        <p className="mt-8 text-sm text-texto-faint">
          {pagina.total === 0 ? (
            "Nenhum evento com esse filtro."
          ) : (
            <>
              Esta página está além do fim — são {pagina.paginas} páginas.{" "}
              {/* Saída de volta em vez de beco: a página fora de faixa quase
                  sempre vem de um link antigo, e sem isto o único caminho é
                  editar a URL na mão. */}
              <Link href={linkDaPagina(pagina.paginas)} className="text-acento underline underline-offset-4">
                ir para a última
              </Link>
            </>
          )}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-linha">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-linha bg-carbon text-left">
                {["Quando", "Ação", "Estúdio", "Por", "Alvo"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-texto-faint"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagina.eventos.map((ev) => (
                <tr key={String(ev.id)} className="border-b border-linha last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums text-texto-faint">
                    {dataHora(ev.criado_em)}
                  </td>
                  <td className="px-4 py-2 text-xs font-medium">{ev.acao}</td>
                  <td className="px-4 py-2 text-xs">
                    {ev.tenant_id ? (
                      <Link
                        href={`/painel/admin/estudios/${ev.tenant_id}`}
                        className="hover:text-acento"
                      >
                        {ev.estudio ?? "—"}
                      </Link>
                    ) : (
                      (ev.estudio ?? "—")
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-texto-faint">{ev.ator}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-texto-faint">
                    {ev.alvo_tipo ? `${ev.alvo_tipo} ` : ""}
                    {ev.alvo_id ?? ""}
                    {Object.keys(ev.detalhe ?? {}).length > 0 && (
                      <span className="block max-w-[42ch] truncate">{JSON.stringify(ev.detalhe)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Fora de faixa a navegação some: "9999 / 66" com um "anterior" que leva
          a 9998 é pior que nada — o caminho de volta é o link do aviso acima. */}
      {pagina.paginas > 1 && pagina.pagina <= pagina.paginas && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          {pagina.pagina > 1 ? (
            <Link href={linkDaPagina(pagina.pagina - 1)} className="text-texto-soft hover:text-texto">
              ← anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-texto-faint tabular-nums">
            {pagina.pagina} / {pagina.paginas}
          </span>
          {pagina.pagina < pagina.paginas ? (
            <Link href={linkDaPagina(pagina.pagina + 1)} className="text-texto-soft hover:text-texto">
              próxima →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
