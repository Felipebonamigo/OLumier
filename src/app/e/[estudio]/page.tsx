import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { marca } from "@/config/marca";
import { consultar, consultarUm } from "@/lib/db";
import { armazemDe, urlDaDerivada } from "@/lib/armazem";
import { TEMAS } from "@/config/aparencia";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ estudio: string }> };

/**
 * A raiz do subdomínio do estúdio (siriusfotografia.olumier.com.br).
 *
 * Mostra só as galerias PÚBLICAS e sem senha. Galeria protegida não aparece
 * aqui: listá-la entregaria a existência da entrega de um casal para qualquer
 * visitante, e a senha existe justamente para isso não acontecer.
 */

async function buscarEstudio(slug: string) {
  return consultarUm<{
    id: string;
    nome_estudio: string;
    cor_destaque: string;
  }>("select id, nome_estudio, cor_destaque from tenants where slug = $1", [slug]);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { estudio } = await params;
  const t = await buscarEstudio(estudio);
  if (!t) return { title: "Estúdio" };
  return {
    title: t.nome_estudio,
    description: `Galerias de ${t.nome_estudio}`,
  };
}

export default async function EstudioPage({ params }: Props) {
  const { estudio } = await params;
  const t = await buscarEstudio(estudio);
  if (!t) notFound();

  const galerias = await consultar<{
    slug: string;
    titulo: string;
    subtitulo: string | null;
    data_evento: Date | null;
    capa_thumb: string | null;
    capa_original: string | null;
    capa_armazem: string | null;
  }>(
    /*
     * A capa vem em TRÊS colunas, não num `coalesce` só.
     *
     * Antes era `coalesce(cm.chave_thumb, cm.chave, pm.chave_thumb, pm.chave)`,
     * que devolve a chave e esconde QUAL das quatro venceu. Desde que o original
     * pode morar no B2 (obra da rota B2), essa informação passou a importar: se
     * o vencedor foi uma miniatura, lê-se do R2; se foi o original, lê-se de
     * onde ele estiver. Com a chave já achatada não dá para saber, e a capa
     * abriria quebrada exatamente nas galerias sem miniatura.
     *
     * A escolha é da MÍDIA inteira, não coluna a coluna: `cm` (a capa que o
     * fotógrafo marcou) se ela existir, senão `pm` (a primeira foto). Um
     * `coalesce` por coluna pegaria a miniatura de uma foto com o original de
     * outra no caso em que a capa marcada não tem miniatura — as três colunas
     * têm de vir sempre da mesma linha.
     */
    `select g.slug, g.titulo, g.subtitulo, g.data_evento,
            case when cm.chave is not null then cm.chave_thumb else pm.chave_thumb end as capa_thumb,
            case when cm.chave is not null then cm.chave       else pm.chave       end as capa_original,
            case when cm.chave is not null then cm.armazem     else pm.armazem     end as capa_armazem
       from galerias g
       left join medias cm on cm.id = g.capa_media_id and cm.pronto
       left join lateral (
         select chave, chave_thumb, armazem from medias
          where galeria_id = g.id and pronto and tipo = 'foto'
          order by ordem limit 1
       ) pm on true
      where g.tenant_id = $1
        and g.publicada
        and g.estado = 'online'
        and g.senha_hash is null
        and (g.expira_em is null or g.expira_em > now())
      order by coalesce(g.data_evento, g.criado_em::date) desc
      limit 60`,
    [t.id],
  );

  const comCapa = await Promise.all(
    galerias.map(async (g) => ({
      ...g,
      urlCapa: g.capa_original
        ? await urlDaDerivada(g.capa_thumb, g.capa_original, armazemDe(g.capa_armazem), 6 * 3600)
        : null,
    })),
  );

  return (
    <main
      className="min-h-dvh pb-20"
      style={{ ...TEMAS.noite, background: "var(--g-fundo)", color: "var(--g-texto)" }}
    >
      <header className="px-6 py-20 text-center">
        <h1 className="font-serif text-4xl font-bold tracking-tight sm:text-5xl">
          {t.nome_estudio}
        </h1>
        <p
          className="mt-4 font-mono text-[11px] uppercase tracking-[0.28em]"
          style={{ color: t.cor_destaque }}
        >
          Galerias
        </p>
      </header>

      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        {comCapa.length === 0 ? (
          <p className="py-16 text-center text-sm" style={{ color: "var(--g-suave)" }}>
            Nenhuma galeria pública no momento.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {comCapa.map((g) => (
              <li key={g.slug}>
                <a href={`/${g.slug}`} className="group block">
                  <span
                    className="block aspect-[4/3] overflow-hidden rounded-lg"
                    style={{ background: "var(--g-superficie)" }}
                  >
                    {g.urlCapa && (
                      // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                      <img
                        src={g.urlCapa}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                      />
                    )}
                  </span>
                  <span className="mt-3 block font-serif text-xl">{g.titulo}</span>
                  <span className="mt-0.5 block text-xs" style={{ color: "var(--g-tenue)" }}>
                    {[
                      g.data_evento
                        ? new Date(g.data_evento).toLocaleDateString("pt-BR", {
                            month: "long",
                            year: "numeric",
                          })
                        : null,
                      g.subtitulo,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="mt-20 text-center">
        <span
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ border: "1px solid var(--g-linha)", color: "var(--g-tenue)" }}
        >
          entregue com {marca.nome}
        </span>
      </footer>
    </main>
  );
}
