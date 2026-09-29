import type { Metadata } from "next";
import { FUSO } from "@/config/fuso";
import Link from "next/link";
import { sessaoAtual } from "@/lib/auth";
import { listarGalerias, listarLixeira, formatarBytes, PRAZO_LIXEIRA_DIAS } from "@/lib/tenants";
import { Lixeira } from "@/components/lixeira";
import { ListaGalerias } from "@/components/lista-galerias";
import { buscarTenantPorId } from "@/lib/tenants";
import { diasAteArquivar } from "@/config/prazos";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Galerias" };
export const dynamic = "force-dynamic";

const formatarData = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "short", year: "numeric" }) : null;

export default async function PainelPage({
  searchParams,
}: {
  /* A busca e a página vivem no ENDEREÇO, e não no estado do componente: assim
     o fotógrafo pode mandar "olha na página 3" para o sócio, o voltar do
     navegador funciona, e a tela é a mesma depois de publicar uma galeria e o
     `router.refresh()` acontecer. */
  searchParams: Promise<{ q?: string; p?: string }>;
}) {
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  const { q, p } = await searchParams;
  const busca = (q ?? "").slice(0, 120);
  const tela = await listarGalerias(tenantId, { busca, pagina: Number(p) || 1 });
  const galerias = tela.itens;
  /* "Nenhuma galeria ainda" e "nada encontrado" são telas diferentes: a
     primeira é o começo do produto, a segunda é uma busca que não achou. */
  const vazioDeVerdade = tela.total === 0 && !busca;
  /* O slug do estúdio entra por causa do atalho "copiar link": o endereço do
     cliente é /g/{estudio}/{galeria}, e sem a primeira metade o botão copiaria
     um link quebrado. Uma consulta a mais nesta página, não por galeria. */
  const estudio = await buscarTenantPorId(tenantId);
  const lixeira = await listarLixeira(tenantId);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/*
          A CONTA AO LADO DO TÍTULO, e não numa linha embaixo.

          Eram duas linhas dizendo quase a mesma palavra — "Galerias" e, logo
          abaixo, "3 galerias" —, e acima delas o cabeçalho ainda escrevia
          "galerias de entrega". Felipe: "repete duas vezes o galeria". A
          contagem é um NÚMERO, não uma frase: ao lado do título ela informa o
          mesmo e devolve a linha.

          A tela vazia continua com frase, porque ali não há número a mostrar e
          "0" seria um jeito seco de dar uma notícia que merece uma.
        */}
        <div>
          <h1 className="flex items-baseline gap-2.5 text-2xl font-bold tracking-tight">
            Galerias
            {tela.total > 0 && (
              <span className="text-base font-normal tabular-nums text-texto-faint">
                {tela.total}
              </span>
            )}
          </h1>
          {vazioDeVerdade && (
            <p className="mt-1 text-sm text-texto-soft">Nenhuma galeria ainda.</p>
          )}
        </div>
        <Link
          href="/painel/galerias/nova"
          className="rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto"
        >
          Nova galeria
        </Link>
      </div>

      {vazioDeVerdade ? (
        <div className="mt-10 rounded-xl border border-dashed border-linha-forte bg-carbon px-6 py-14 text-center">
          <p className="text-base font-medium">Crie sua primeira galeria</p>
          <p className="mx-auto mt-2 max-w-[42ch] text-sm text-texto-soft">
            Uma galeria é uma entrega — um casamento, um ensaio. Você sobe as fotos e o filme, e
            manda um único link para o cliente.
          </p>
          <Link
            href="/painel/galerias/nova"
            className="mt-6 inline-block rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto"
          >
            Nova galeria
          </Link>
        </div>
      ) : (
        <ListaGalerias
          busca={busca}
          pagina={tela.pagina}
          paginas={tela.paginas}
          total={tela.total}
          galerias={galerias.map((g) => ({
            id: g.id,
            titulo: g.titulo,
            subtitulo: g.subtitulo,
            slug: g.slug,
            estudioSlug: estudio?.slug ?? "",
            publicada: g.publicada,
            estado: g.estado,
            origem: g.origem,
            diasAteCofre: diasAteArquivar(g.expira_em),
            dataFormatada: formatarData(g.data_evento),
            arquivos: g.total_medias ?? 0,
            tamanho: formatarBytes(g.bytes_total),
          }))}
        />
      )}

      {/*
       * A lixeira só aparece quando tem algo dentro. Uma seção vazia permanente
       * ensinaria o fotógrafo a ignorar aquele canto da tela — e é justamente
       * onde ele vai precisar olhar no dia em que apagar a galeria errada.
       */}
      <Lixeira
        prazoDias={PRAZO_LIXEIRA_DIAS}
        itens={lixeira.map((g) => ({
          id: g.id,
          titulo: g.titulo,
          arquivos: g.total_medias ?? 0,
          diasRestantes: g.dias_restantes,
        }))}
      />
    </main>
  );
}
