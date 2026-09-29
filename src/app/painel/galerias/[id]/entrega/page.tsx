import type { Metadata } from "next";
import { FUSO } from "@/config/fuso";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { contarMediasProntas, galeriaDoPainel } from "@/lib/galeria-painel";
import { fotosSemRosto, resumoDeRostos } from "@/lib/rostos";
import { PublicarGaleria } from "@/components/publicar-galeria";
import { EnderecoDaGaleria } from "@/components/endereco-da-galeria";
import { apelidosDaGaleria } from "@/lib/endereco-galeria";
import { PrazoCofre } from "@/components/prazo-cofre";
import { BuscaPorRosto } from "@/components/busca-por-rosto";
import { diasAteArquivar, mesesEquivalentes } from "@/config/prazos";
import { apagarGaleriaAction } from "../../../actions";
import { decifrarSenha } from "@/lib/senha-da-galeria";

export const metadata: Metadata = { title: "Entrega da galeria" };
export const dynamic = "force-dynamic";

/**
 * A aba ENTREGA — o link, a senha, o download, o prazo e a busca por rosto.
 *
 * É a aba mais leve de propósito, e isso é a prova de que a divisão em abas
 * valeu: quem entra aqui quer trocar uma senha ou copiar um link, e antes
 * pagava a grade inteira do painel (uma URL assinada por foto) para fazer
 * isso. Aqui não se lê uma linha de mídia — só quantas existem, para avisar
 * antes de publicar galeria vazia. `testar-painel-abas.mjs` prende isso
 * perguntando se alguma miniatura vazou para esta página.
 */
export default async function EntregaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  /* A tranca é de cada rota, não do layout — ver `lib/galeria-painel.ts`. */
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");
  const galeria = await galeriaDoPainel(id, tenantId);
  if (!galeria) notFound();

  const totalMedias = await contarMediasProntas(galeria.id);
  /* O que sobrou das trocas feitas antes de 16/09/2026: desde então trocar o
     endereço apaga o anterior, mas estes ainda abrem, e a tela não pode
     escondê-los de quem precisa apagá-los. Ver `lib/endereco-galeria.ts`. */
  const apelidos = await apelidosDaGaleria(galeria.id);

  // Só pesa quando a busca está ligada; desligada, os dois números são zero.
  const rostos = galeria.rostos_ativos ? await resumoDeRostos(galeria.id) : { rostos: 0, fotos: 0 };
  const semMedir = galeria.rostos_ativos ? (await fotosSemRosto(galeria.id, tenantId)).length : 0;

  return (
    <>
      <PublicarGaleria
        galeriaId={galeria.id}
        caminho={`/g/${galeria.estudio_slug}/${galeria.slug}`}
        estudioSlug={galeria.estudio_slug}
        galeriaSlug={galeria.slug}
        publicada={galeria.publicada}
        temSenha={Boolean(galeria.senha_hash)}
        /* O que o fotógrafo digitou, para ele poder contar ao casal. `null`
           quando a senha é anterior a 24/09/2026: aquele hash não volta atrás,
           e a tela diz isso em vez de fingir. Ver `lib/senha-da-galeria.ts`. */
        senhaVisivel={decifrarSenha(galeria.senha_cifrada)}
        permiteDownload={galeria.permite_download}
        semFotos={totalMedias === 0}
      />

      {/* Logo abaixo do link, porque é a segunda metade dele — e era ali que o
          Juan clicava tentando arrumar o `-2` do endereço. */}
      <EnderecoDaGaleria
        galeriaId={galeria.id}
        slug={galeria.slug}
        publicada={galeria.publicada}
        apelidos={apelidos.map((a) => a.slug)}
      />

      {/*
        A busca por rosto vem depois de publicar, e antes do prazo: é uma
        decisão sobre o que o convidado vai poder fazer com a entrega, então
        pertence a esta aba — mas ligar depois deixa as fotos já enviadas na
        fila de "ainda não medidas", e por isso ela não fica escondida no fim.
      */}
      <BuscaPorRosto
        galeriaId={galeria.id}
        ativa={galeria.rostos_ativos}
        ligadaEm={
          galeria.rostos_ligados_em
            ? new Date(galeria.rostos_ligados_em).toLocaleDateString("pt-BR", { timeZone: FUSO,
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })
            : null
        }
        rostos={rostos.rostos}
        fotosComRosto={rostos.fotos}
        fotosSemMedir={semMedir}
      />

      <PrazoCofre
        galeriaId={galeria.id}
        arquivada={galeria.estado === "arquivada"}
        mesesAtual={mesesEquivalentes(galeria.expira_em)}
        diasRestantes={diasAteArquivar(galeria.expira_em)}
        arquivadaEm={galeria.arquivada_em ? String(galeria.arquivada_em) : null}
      />

      <section className="mt-12 border-t border-linha pt-6">
        <h2 className="text-sm font-semibold">Apagar galeria</h2>
        <p className="mt-1 max-w-[52ch] text-xs text-texto-faint">
          Remove a galeria e todos os arquivos dela. Não dá para desfazer.
        </p>
        <form action={apagarGaleriaAction} className="mt-3">
          <input type="hidden" name="galeria_id" value={galeria.id} />
          {/* Aqui o redirecionamento É necessário: a página que a pessoa está
              olhando acabou de ir para a lixeira. Na lista da Conta, não. */}
          <input type="hidden" name="voltar" value="1" />
          <button
            type="submit"
            className="rounded-lg border border-erro/40 px-4 py-2 text-sm text-erro transition hover:bg-erro/10"
          >
            Apagar “{galeria.titulo}”
          </button>
        </form>
      </section>
    </>
  );
}
