import { ImageResponse } from "next/og";
import { TEMAS } from "@/config/aparencia";
import { marca } from "@/config/marca";
import { comAlfa, fotoParaOCartao } from "@/lib/cartao-de-link";
import { lerSite } from "@/lib/site-estudio";
import { buscarEstudio, galeriaDoTopo, galeriasDaVitrine } from "@/lib/vitrine";

/*
 * O CARTÃO DA VITRINE — o que abre quando o fotógrafo cola o endereço do site
 * no Instagram, no WhatsApp ou no e-mail de orçamento (26/09/2026).
 *
 * Sem este arquivo o Next caía no `opengraph-image.tsx` da raiz, e o site do
 * estúdio desdobrava como "GALERIA ÁTOMO" sobre o nosso fundo escuro. É o
 * mesmo defeito que o cartão da galeria teve até 31/08/2026, aqui na página
 * cuja razão de existir é o casal ACHAR o fotógrafo.
 *
 * O quadro é o da própria vitrine: a foto do topo e o nome do estúdio, nas
 * cores do tema que ele escolheu para o site. A foto sai de `galeriaDoTopo` —
 * a MESMA escolha da página, sobre a MESMA lista, que já exclui galeria com
 * senha, fora do ar ou vencida. Um cartão é público e fica guardado nos
 * servidores do WhatsApp; ele não pode mostrar nada que a página não mostra.
 */
export const alt = "Site do estúdio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Props = { params: Promise<{ estudio: string }> };

export default async function Image({ params }: Props) {
  const { estudio } = await params;
  const t = await buscarEstudio(estudio);
  const site = lerSite(t?.site);

  let foto: string | null = null;
  if (t) {
    try {
      const topo = galeriaDoTopo(await galeriasDaVitrine(t.id), site);
      if (topo?.capa_original) {
        foto = await fotoParaOCartao({
          id: topo.slug,
          tipo: topo.capa_tipo ?? "foto",
          chave: topo.capa_original,
          chave_preview: topo.capa_preview,
          chave_thumb: topo.capa_thumb,
          armazem: topo.capa_armazem,
        });
      }
    } catch {
      /* Banco fora ou consulta que falha: quadro neutro. Robô que recebe 500
         desiste e mostra o link pelado, que é pior que o neutro. */
      foto = null;
    }
  }

  /* Estúdio que não existe (link morto, robô em endereço antigo): o cartão é
     nosso mesmo, no tema padrão. */
  const nome = t?.nome_estudio ?? marca.nome;
  const tema = TEMAS[site.tema];
  const fundo = tema["--g-fundo"];
  const corTexto = tema["--g-texto"];
  const corFrase = tema["--g-suave"];

  /* Montados fora do `style` pela mesma razão do cartão da galeria: a trava de
     `testar-seo.mjs` lê cada bloco absoluto até a primeira chave, e uma
     interpolação lá dentro esconderia o bloco dela. */
  const veu = `linear-gradient(to top, ${comAlfa(fundo, 0.96)} 0%, ${comAlfa(fundo, 0.88)} 26%, ${comAlfa(fundo, 0.5)} 52%, ${comAlfa(fundo, 0)} 100%)`;
  const halo = `0 3px 18px ${comAlfa(fundo, 0.8)}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: foto ? "flex-end" : "center",
          alignItems: "center",
          position: "relative",
          background: fundo,
          color: corTexto,
        }}
      >
        {foto && (
          <img
            src={foto}
            alt=""
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}

        {/* Absoluto COM largura e altura: no satori, `inset: 0` sem medida vira
            tamanho zero e o véu some sem erro nenhum — o defeito que o cartão
            da galeria viveu por duas publicações. */}
        {foto && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              background: veu,
            }}
          />
        )}

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            padding: foto ? "0 80px 72px" : "0 80px",
          }}
        >
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05, textShadow: halo }}>
            {nome}
          </div>
          {site.frase ? (
            <div
              style={{
                marginTop: 22,
                fontSize: 32,
                lineHeight: 1.3,
                color: corFrase,
                textShadow: halo,
                maxWidth: 960,
              }}
            >
              {site.frase}
            </div>
          ) : null}
        </div>
      </div>
    ),
    size,
  );
}
