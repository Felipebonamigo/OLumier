import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { galeriaDoPainel } from "@/lib/galeria-painel";
import { paraCampoDeData } from "@/lib/datas";
import { EditorGaleria } from "@/components/editor-galeria";
import { MenuGaleria } from "@/components/menu-galeria";
import { ProvedorDeEnvio } from "@/components/envio-em-curso";
import { AcaoDePublicar, SeloDaGaleria } from "@/components/publicar-no-cabecalho";

export const dynamic = "force-dynamic";

/**
 * O quadro da galeria: quem ela é, se está no ar, e o menu das quatro seções.
 *
 * ── O QUE MORA AQUI, E O QUE NÃO PODE MORAR ────────────────────────────────
 *
 * Só o que TODA aba precisa: título, subtítulo, data, estado. Uma consulta.
 *
 * A tentação é trazer mais um dado "que é útil em toda tela" — o total de
 * fotos, o número de acessos. Cada um desses desfaz a razão de a tela ter sido
 * partida: a página antiga fazia oito consultas e assinava uma URL por foto
 * antes de desenhar qualquer coisa, e numa galeria de 600 fotos isso era 600
 * assinaturas para quem entrou só para trocar a senha.
 * `scripts/testar-painel-abas.mjs` pergunta se alguma miniatura vazou para a
 * aba Entrega — é essa a trava.
 *
 * A autorização é conferida aqui E em cada página. Não é redundância inútil:
 * layout não é porta, é moldura. Uma rota nova montada fora dele — ou um dia
 * em que o Next resolva renderizar página e layout em paralelo — encontraria a
 * página sem tranca. Ver `lib/galeria-painel.ts`.
 */
export default async function GaleriaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // no Next 16 params é Promise
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");
  const galeria = await galeriaDoPainel(id, tenantId);
  if (!galeria) notFound();

  const dataEvento = galeria.data_evento
    ? new Date(galeria.data_evento).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  /*
   * Mesma data, no formato que o <input type="date"> espera.
   *
   * Montada com os campos LOCAIS, não com toISOString(). A coluna é `date` — dia
   * puro, sem hora — e o driver a entrega como meia-noite no fuso do processo.
   * Passar por UTC só dá certo em fuso negativo: num servidor a leste de
   * Greenwich, meia-noite local cai no dia anterior em UTC, e abrir o formulário
   * sem mexer em nada já mostraria a data errada — que então seria salva.
   */
  const dataISO = galeria.data_evento ? paraCampoDeData(new Date(galeria.data_evento)) : null;

  const noCofre = galeria.estado === "arquivada";
  const noAr = !noCofre && galeria.publicada;

  /* Existe rascunho de aparência esperando publicação? A coluna é nula quando
     não há — publicar limpa. Ver `lib/aparencia-galeria.ts`. */
  const temAparenciaPendente = galeria.aparencia_rascunho !== null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/painel" className="text-sm text-texto-soft hover:text-texto">
        ← Galerias
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <EditorGaleria
          galeriaId={galeria.id}
          titulo={galeria.titulo}
          subtitulo={galeria.subtitulo}
          dataISO={dataISO}
          dataFormatada={dataEvento}
        />
        {/*
          O selo responde UMA pergunta: o link do cliente abre agora?

          São três estados, não dois, e o terceiro é fácil de perder: no cofre,
          `publicada` continua true de propósito — é isso que faz reativar
          devolver a galeria ao ar sem o fotógrafo republicar. Ler só `publicada`
          fazia a mesma tela dizer "publicada" em cima e "No cofre" embaixo, e
          quem bate o olho lê o de cima.

          `estado` vem antes de `publicada` porque o cofre vence a publicação:
          arquivada com `publicada` true tem o link fora do ar do mesmo jeito.
          `scripts/testar-cofre.mjs` prende isto.
        */}
        <div className="flex flex-wrap items-center gap-2">
          {/*
            APARÊNCIA NÃO PUBLICADA — o aviso que faltava, em 04/09/2026.

            Duas usuárias seguidas escolheram o tema claro, viram a prévia
            clara e entregaram a galeria escura: a escolha ficou no rascunho e
            ninguém apertou "Publicar aparência". A barra do editor dizia isso,
            no rodapé, em letra miúda — e duas de duas não viram.

            Aqui ele aparece nas QUATRO abas, inclusive em Entrega, que é onde a
            pessoa está no instante em que aperta publicar. E é um link: quem vê
            o aviso está a um clique de resolver, não de procurar.

            Publicar a galeria também promove o rascunho (ver
            `promoverRascunhoSePendente`) — este aviso é a segunda trava, para
            quem publicou antes de desenhar.
          */}
          {temAparenciaPendente && (
            <Link
              href={`/painel/galerias/${galeria.id}/design`}
              /* Mesmo formato de pastilha dos outros selos — ver o `SELO` de
                 `publicar-no-cabecalho.tsx`. */
              className="inline-flex items-center gap-1.5 rounded-full border border-alerta/40 bg-alerta/10 px-3 py-1.5 text-xs leading-none text-alerta transition hover:bg-alerta/20"
            >
              <span aria-hidden="true">●</span>
              aparência não publicada
            </Link>
          )}

          <SeloDaGaleria publicada={noAr} noCofre={noCofre} />

          {/*
            VER COMO O CLIENTE VÊ — pedido do sócio em 04/09/2026, "um botão de
            visualização mais fácil de ver".

            Ele existia, e era o problema: morava dentro do editor de aparência,
            atrás de um rótulo pequeno, e só depois de publicar aparecia um
            "abrir ↗" na seção de entrega. Quem quisesse conferir o trabalho
            precisava saber onde procurar.

            Agora fica no cabeçalho, ao lado do selo, visível das QUATRO abas —
            porque a pergunta "como está ficando?" não pertence a nenhuma delas
            em particular.

            `?previa=1` é o que faz o rascunho abrir para o DONO: sem ele, uma
            galeria ainda não publicada devolveria 404 justamente para quem
            está montando. A permissão vem da sessão, não do parâmetro — ver
            `app/g/[estudio]/[galeria]/page.tsx`.
          */}
          <a
            href={`/g/${galeria.estudio_slug}/${galeria.slug}?previa=1`}
            target="_blank"
            rel="noreferrer"
            /* Retângulo, e não pastilha: é ação. Mesma altura dos selos, para a
               fileira assentar numa linha só. */
            className="inline-flex items-center gap-1.5 rounded-lg border border-linha-forte px-3 py-1.5 text-xs leading-none transition hover:bg-carbon-2"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
              <circle cx="12" cy="12" r="2.6" />
            </svg>
            Ver como o cliente vê
          </a>

          {/*
            O selo virou selo E botão em 05/09/2026, a pedido do Juan: "não
            achei onde publica a galeria… seria ótimo se tivesse lá em cima, em
            'rascunho', pra publicar independente de qual página estivesse".

            Em 16/09/2026 os dois voltaram a ser peças separadas — não para
            desfazer aquilo, mas para AGRUPAR: o selo sobe para junto do aviso
            de aparência (o que se lê) e a ação desce para junto do "ver como o
            cliente vê" (o que se clica). Antes o "rascunho" ficava encravado
            entre as duas ações e parecia um botão apagado. Ver
            `components/publicar-no-cabecalho.tsx`.
          */}
          <AcaoDePublicar galeriaId={galeria.id} publicada={noAr} noCofre={noCofre} />
        </div>
      </header>

      {/*
        Menu à esquerda no computador, fila que rola no celular — e ELE NÃO
        ACOMPANHA A ROLAGEM.

        O Felipe: "continua a edição toda por scroll na mesma tela". As abas
        existiam, mas o menu subia junto com o conteúdo: dois palmos de rolagem
        dentro de Design e ele já não estava mais na tela. Sem o menu à vista,
        não há abas — há uma página comprida que por acaso começou com links.

        `sticky` resolve porque o menu é curto e o conteúdo é longo: ele
        encosta no topo e fica. No celular a fila continua rolando com a
        página, que é o certo numa tela de 390 px.
      */}
      {/*
        O PROVEDOR DE ENVIO MORA AQUI, E O LUGAR É A CORREÇÃO.

        O Juan soltou a pasta na aba Fotos, foi para o Design e o envio morreu.
        Não era bug de lógica: a fila vivia dentro do componente da rota
        `/fotos`, e navegar para `/design` desmonta aquela árvore. No App Router
        o LAYOUT não é remontado ao trocar de aba filha — só o `children` troca —
        então a fila montada aqui atravessa as quatro abas, e a barra flutuante
        dele aparece em todas.

        Ver `components/envio-em-curso.tsx`; `scripts/testar-upload.mjs` confere
        que ela não voltou para dentro da aba.
      */}
      <ProvedorDeEnvio galeriaId={galeria.id}>
        <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
          <div className="lg:sticky lg:top-6 lg:w-56 lg:shrink-0">
            <MenuGaleria galeriaId={galeria.id} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-8">{children}</div>
        </div>
      </ProvedorDeEnvio>
    </main>
  );
}
