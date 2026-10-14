import type { Metadata } from "next";
import { FUSO } from "@/config/fuso";
import Link from "next/link";
import { sessaoAtual } from "@/lib/auth";
import { listarGalerias, listarFavoritas, listarLixeira, formatarBytes, PRAZO_LIXEIRA_DIAS } from "@/lib/tenants";
import { Lixeira } from "@/components/lixeira";
import { ListaGalerias } from "@/components/lista-galerias";
import { buscarTenantPorId } from "@/lib/tenants";
import { diasAteArquivar } from "@/config/prazos";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { capasDoPainel } from "@/lib/capas-do-painel";
import { COOKIE_VISAO, lerVisao } from "@/config/visao-galerias";
import { usoDoEstudio } from "@/lib/medias";
import { asaasConfigurado } from "@/lib/asaas";
import { lembreteDoTeste } from "@/lib/lembrete-do-teste";
import { AvisoDoTeste } from "@/components/aviso-do-teste";

export const metadata: Metadata = { title: "Galerias" };
export const dynamic = "force-dynamic";

const formatarData = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "short", year: "numeric" }) : null;

/* O mês da visão "por mês": o do evento, ou o da criação para quem não tem
   data — a mesma conta que ordena a lista (`coalesce(data_evento, criado_em)`). */
const rotuloDoMes = (d: Date) => {
  const t = new Date(d).toLocaleDateString("pt-BR", { timeZone: FUSO, month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

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
  const tela = await listarGalerias(tenantId, { busca, pagina: Number(p) || 1, semFavoritas: true });
  /* A faixa de favoritas só existe fora da busca: quem busca quer achar o nome,
     esteja ele onde estiver, e a lista de resultados já traz as favoritas. */
  const favoritas = busca ? [] : await listarFavoritas(tenantId);
  const galerias = tela.itens;
  const totalGeral = tela.total + favoritas.length;
  /* "Nenhuma galeria ainda" e "nada encontrado" são telas diferentes: a
     primeira é o começo do produto, a segunda é uma busca que não achou. */
  const vazioDeVerdade = totalGeral === 0 && !busca;
  /* O slug do estúdio entra por causa do atalho "copiar link": o endereço do
     cliente é /g/{estudio}/{galeria}, e sem a primeira metade o botão copiaria
     um link quebrado. Uma consulta a mais nesta página, não por galeria. */
  const estudio = await buscarTenantPorId(tenantId);
  const lixeira = await listarLixeira(tenantId);
  /* As capas vêm sempre, qualquer que seja a forma de ver: trocar de forma é
     na tela, sem voltar aqui. Ver `lib/capas-do-painel.ts`. */
  const capas = await capasDoPainel(
    tenantId,
    [...favoritas, ...galerias].map((g) => g.id),
  );
  const paraALista = (g: (typeof galerias)[number]) => ({
    id: g.id,
    titulo: g.titulo,
    subtitulo: g.subtitulo,
    slug: g.slug,
    estudioSlug: estudio?.slug ?? "",
    publicada: g.publicada,
    estado: g.estado,
    origem: g.origem,
    favorita: g.favorita_em !== null,
    diasAteCofre: diasAteArquivar(g.expira_em),
    dataFormatada: formatarData(g.data_evento),
    mes: rotuloDoMes(g.data_evento ?? g.criado_em),
    capa: capas.get(g.id) ?? null,
    arquivos: g.total_medias ?? 0,
    tamanho: formatarBytes(g.bytes_total),
  });
  const visao = lerVisao((await cookies()).get(COOKIE_VISAO)?.value);
  /* Os dois limites do teste (tempo e espaço), à vista. Só para quem está no
     teste; para os demais `lembreteDoTeste` devolve null. */
  const lembrete = estudio
    ? lembreteDoTeste(estudio, (await usoDoEstudio(tenantId)).noAr, asaasConfigurado())
    : null;

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
            {totalGeral > 0 && (
              <span className="text-base font-normal tabular-nums text-texto-faint">
                {totalGeral}
              </span>
            )}
          </h1>
          {vazioDeVerdade && (
            <p className="mt-1 text-sm text-texto-soft">Nenhuma galeria ainda.</p>
          )}
        </div>
        {/* Importar fica AO LADO e menor: é o caminho de quem chega com o
            acervo de outro lugar — várias galerias de uma vez —, não o do dia a
            dia. Ver `lib/importacao.ts`. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/painel/importar"
            className="rounded-lg border border-linha-forte px-4 py-2.5 text-sm transition hover:bg-carbon-2"
          >
            Importar várias
          </Link>
          <Link
            href="/painel/galerias/nova"
            className="rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto"
          >
            Nova galeria
          </Link>
        </div>
      </div>

      {lembrete && <AvisoDoTeste lembrete={lembrete} />}

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
          <p className="mt-4 text-sm text-texto-soft">
            Já tem galerias em outro lugar?{" "}
            <Link href="/painel/importar" className="underline underline-offset-4 hover:text-texto">
              Importe várias de uma vez
            </Link>
            .
          </p>
        </div>
      ) : (
        <ListaGalerias
          visaoInicial={visao}
          busca={busca}
          pagina={tela.pagina}
          paginas={tela.paginas}
          total={tela.total}
          totalGeral={totalGeral}
          galerias={galerias.map(paraALista)}
          favoritas={favoritas.map(paraALista)}
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
