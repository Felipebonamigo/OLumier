import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { marca } from "@/config/marca";
import { GaleriaCapa } from "@/components/galeria-capa";
import { GaleriaCliente, type ItemGaleria } from "@/components/galeria-cliente";
import { FONTES_TEXTO, variaveisDeForma, variaveisDoTema } from "@/config/aparencia";
import { FOTOS, identidadePorId } from "@/config/home-demonstracao";

/**
 * A GALERIA DO CLIENTE, COM FOTOS DE DEMONSTRAÇÃO — para o celular da home.
 *
 * O briefing da home pede "celular real" e "scroll real da galeria" (§9, §23).
 * O jeito honesto de cumprir é mostrar a própria galeria: esta página monta a
 * mesma capa e o mesmo `GaleriaCliente` que o casal abre — barra, grade,
 * visualizador de foto, corações —, com as fotos da demonstração no lugar do
 * banco. A home a coloca num iframe do tamanho de um celular, e o visitante
 * rola, abre foto e passa de uma para outra como o cliente faria.
 *
 * Por que iframe só aqui: um celular desenhado dentro de uma página de
 * computador teria a capa decidindo o layout pela janela GRANDE (é media
 * query). O iframe tem janela de celular de verdade.
 *
 * ── O QUE NÃO FUNCIONA, DE PROPÓSITO ──────────────────────────────────────
 *
 * Download desligado e seleção fechada: não há galeria no banco por trás, e um
 * botão que aparece e falha seria pior que botão nenhum. Os dois corações
 * marcados vêm como favoritas já escolhidas.
 */

export const metadata: Metadata = {
  title: `Demonstração — ${marca.nome}`,
  robots: { index: false, follow: false },
};

/*
 * Dinâmica, como a galeria de verdade. O `GaleriaCliente` lê a URL
 * (`useSearchParams`, para o capítulo e o recorte), e página estática com isso
 * dentro não passa no build — o `next dev` não acusa, o `next build` sim.
 */
export const dynamic = "force-dynamic";

export default async function DemonstracaoPage({
  params,
}: {
  params: Promise<{ identidade: string }>;
}) {
  const { identidade: id } = await params;
  const identidade = identidadePorId(id);
  if (!identidade) notFound();

  const ap = identidade.aparencia;
  const capa = FOTOS[identidade.capa];
  const itens: ItemGaleria[] = identidade.fotos.map((chave, i) => {
    const f = FOTOS[chave];
    return {
      id: `demo:${chave}`,
      nome: `${String(i + 1).padStart(3, "0")}.jpg`,
      tipo: "foto",
      url: f.src,
      urlGrande: f.src,
      temPoster: true,
      bytes: 0,
      largura: f.largura,
      altura: f.altura,
      secaoId: null,
    };
  });

  return (
    <main
      className="min-h-dvh pb-16"
      data-demo-pb={identidade.pretoEBranco ? "" : undefined}
      style={{
        ...variaveisDoTema(ap),
        ...variaveisDeForma(ap),
        background: "var(--g-fundo)",
        color: "var(--g-texto)",
        fontFamily: FONTES_TEXTO[ap.fonteTexto],
      }}
    >
      <GaleriaCapa
        aparencia={ap}
        dados={{
          titulo: identidade.titulo,
          subtitulo: identidade.local,
          dataFormatada: identidade.data,
          estudio: "Seu Estúdio",
          logoUrl: null,
          urlImagem: capa.src,
          focoX: 50,
          focoY: 50,
          capaEscolhida: true,
        }}
      />
      <div
        className="relative z-10 mx-auto max-w-[1500px] px-4 sm:px-6"
        style={{ background: "var(--g-fundo)" }}
      >
        <GaleriaCliente
          itens={itens}
          permiteDownload={false}
          galeriaId="demonstracao"
          aparencia={ap}
          /* Um capítulo só, o balde das fotos soltas: sem nenhum, a galeria
             não desenha grade nenhuma — ela agrupa por capítulo sempre. */
          capitulos={[
            {
              id: "sem-capitulo",
              apelido: "",
              nome: "",
              indices: itens.map((_, i) => i),
              total: itens.length,
            },
          ]}
          modoProvavel="menu"
          enderecoBase={`/demonstracao/${identidade.id}`}
          favoritasIniciais={[itens[0].id, itens[3].id]}
          selecaoInicial={{ limite: null, aberta: false, motivo: null }}
        />
      </div>
      <footer className="mt-16 text-center">
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
