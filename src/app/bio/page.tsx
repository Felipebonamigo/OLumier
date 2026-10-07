import type { Metadata } from "next";
import { headers } from "next/headers";
import { marca } from "@/config/marca";
import { MarcaSimbolo } from "@/components/marca-tile";
import { fonteTitulo } from "@/components/home/fontes";
import { NOME_DA_ATOMATIZA, PRODUTOS_DA_BIO, destaqueVigente } from "@/config/bio";
import { consultaDaOrigem, origemDaVisita } from "@/lib/bio-regras";
import { diaDeHoje } from "@/lib/bio";
import { metadadosDaCasa } from "@/lib/metadados";
import { MedirBio } from "./medir";

/**
 * A PÁGINA-PONTE DO INSTAGRAM — `/bio`.
 *
 * O link do perfil "Atomatiza & Galeria Átomo". Não é uma terceira home: é um
 * seletor. Quem veio de um conteúdo da Galeria não deve cair na Atomatiza, e
 * quem veio atrás da Atomatiza não deve ser empurrado para a Galeria — então a
 * pessoa escolhe, em poucos segundos, sem rolar.
 *
 * Os produtos, a ordem e o selo de lançamento vêm de `config/bio.ts`. Mais
 * decisões, e o porquê de cada uma, em `docs/bio.md`.
 *
 * ── LEVE DE PROPÓSITO ─────────────────────────────────────────────────────
 * Sem imagem, sem biblioteca, uma fonte (a dos títulos da home) e um pedaço
 * minúsculo de JavaScript para avisar que a página abriu. O resto é HTML. É
 * renderizada a cada visita porque a origem (UTM e endereço de onde veio) já
 * sai escrita nos links — assim o clique sabe de onde a pessoa veio, sem
 * JavaScript e sem adivinhar depois.
 *
 * ── NÃO ENTRA NO GOOGLE ───────────────────────────────────────────────────
 * `noindex`: é página de campanha, e brigaria na busca com a home — que é a que
 * precisa ser achada. Também fora do sitemap. O cartão do link (WhatsApp,
 * Instagram) segue funcionando.
 */
export const metadata: Metadata = {
  ...metadadosDaCasa({
    titulo: `${NOME_DA_ATOMATIZA} e ${marca.nome}`,
    descricao: `Gestão e organização para fotógrafos, e galerias de entrega personalizáveis. Escolha por onde começar.`,
    caminho: "/bio",
    tituloInteiro: true,
  }),
  robots: { index: false, follow: true },
};

/** O que o Next entrega de `searchParams`: um texto, vários, ou nada. */
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const SOBRANCELHA = "text-xs font-medium uppercase tracking-[0.14em] text-[var(--h-tinta-3)]";

export default async function BioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const origem = origemDaVisita({
    utm_source: um(q.utm_source),
    utm_medium: um(q.utm_medium),
    utm_campaign: um(q.utm_campaign),
    referrer: (await headers()).get("referer"),
  });
  const consulta = consultaDaOrigem(origem);
  const hoje = diaDeHoje();

  return (
    <main className={`home flex min-h-dvh flex-col ${fonteTitulo.variable}`}>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pb-10 pt-6 sm:pt-12">
        {/* A identidade é a do Átomo — o símbolo que as duas marcas dividem. */}
        <header className="flex items-center gap-2.5">
          <span style={{ ["--acento" as string]: "#d9a441" }}>
            <MarcaSimbolo tamanho={32} />
          </span>
          <p className="home-titulo text-[15px] font-semibold tracking-tight">
            {NOME_DA_ATOMATIZA} <span className="text-[var(--h-tinta-3)]">&amp;</span> {marca.nome}
          </p>
        </header>

        <div className="flex flex-1 flex-col justify-center py-8">
          <h1 className="home-titulo text-[clamp(2.4rem,11.5vw,3.7rem)] font-semibold leading-[1.0]">
            O que você procura?
          </h1>

          <ul className="mt-8 grid gap-4">
            {PRODUTOS_DA_BIO.map((p) => {
              const selo = destaqueVigente(p, hoje);
              return (
                <li
                  key={p.id}
                  className="rounded-3xl border border-[var(--h-linha-forte)] bg-[var(--h-branco)] p-5 sm:p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className={SOBRANCELHA}>{p.intencao}</p>
                    {selo && (
                      <span className="shrink-0 rounded-full bg-[var(--h-tinta)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.1em] text-white">
                        {selo}
                      </span>
                    )}
                  </div>
                  <h2 className="home-titulo mt-2 text-[28px] font-semibold leading-tight">{p.nome}</h2>
                  <p className="mt-1.5 text-[17px] leading-snug text-[var(--h-tinta-2)]">{p.descricao}</p>
                  {/* `<a>` e não `<Link>`: o Link pré-carregaria o redirecionador, e o navegador
                      contaria um clique que ninguém deu. */}
                  <a
                    href={`/bio/ir/${p.id}?${consulta}`}
                    className="mt-5 flex h-14 w-full items-center justify-between rounded-full bg-[var(--h-tinta)] px-6 text-[16px] font-medium text-white transition active:scale-[0.99]"
                  >
                    <span>{p.botao}</span>
                    <span aria-hidden>→</span>
                  </a>
                </li>
              );
            })}
          </ul>

          {/* Os dois produtos têm contas e logins separados — não existe "entrar" único. */}
          <nav aria-label="Já sou cliente" className="mt-8 text-[15px] text-[var(--h-tinta-2)]">
            <p className={SOBRANCELHA}>Já sou cliente</p>
            <ul className="mt-1 flex flex-wrap gap-x-6">
              {PRODUTOS_DA_BIO.map((p) => (
                <li key={p.id}>
                  <a
                    href={`/bio/ir/entrar-${p.id}?${consulta}`}
                    className="inline-flex min-h-11 items-center underline underline-offset-4 transition hover:text-[var(--h-tinta)]"
                  >
                    {p.entrar.rotulo}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
      <MedirBio fonte={origem.fonte} meio={origem.meio} campanha={origem.campanha} />
    </main>
  );
}
