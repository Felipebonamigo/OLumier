import { ImageResponse } from "next/og";
import { escolherCapa } from "@/lib/capa-publica";
import { marca } from "@/config/marca";
import { lerAparencia, variaveisDoTema } from "@/config/aparencia";
import { comAlfa, fotoParaOCartao } from "@/lib/cartao-de-link";
import { buscarGaleriaPublica, listarMediasPublicas } from "@/lib/galerias-publicas";

/*
 * Por que a capa passa por `fotoParaOCartao` e não entra direto: o satori não
 * desenha WebP (e toda derivada do produto é WebP), nem vídeo. A história, a
 * regra do pôster e o teto de memória moram em `lib/cartao-de-link.ts` — que a
 * vitrine do estúdio usa também desde 26/09/2026.
 */

/*
 * O CARTÃO QUE O WHATSAPP DESDOBRA — desta galeria, não da plataforma.
 *
 * Sem este arquivo, o Next cai no `opengraph-image.tsx` da raiz, e todo link de
 * casamento chegava no celular do casal com o mesmo quadro escuro escrito
 * "Galeria Átomo". O fotógrafo manda a entrega mais pessoal que ele faz no ano
 * e o cartão mostra a marca do fornecedor dele — foi assim que o dono viu, num
 * print do próprio WhatsApp em 31/08/2026.
 *
 * A imagem é GERADA no servidor (satori) e servida como PNG: a foto entra pela
 * URL assinada, mas quem a busca é este código, na hora de desenhar. O link
 * assinado expira em minutos e nunca sai daqui — o que o WhatsApp guarda é o
 * PNG pronto, que não vence.
 *
 * ── GALERIA COM SENHA NÃO MOSTRA A FOTO ───────────────────────────────────
 *
 * O cartão é público por definição: quem recebe o link encaminhado vê o quadro
 * antes de qualquer tranca, e o robô do WhatsApp guarda uma cópia nos servidores
 * dele. Numa galeria trancada, pôr a capa ali entregaria justamente o que a
 * senha existe para segurar.
 *
 * Então a regra segue o sinal que o próprio fotógrafo deu: sem senha, a capa
 * aparece; com senha, volta o cartão neutro com o nome do estúdio. Ele escolheu
 * trancar, e o cartão respeita a escolha.
 */
export const alt = "Galeria de fotos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Props = { params: Promise<{ estudio: string; galeria: string }> };

export default async function Image({ params }: Props) {
  const { estudio, galeria: galeriaSlug } = await params;
  const galeria = await buscarGaleriaPublica(estudio, galeriaSlug);

  /* Galeria inexistente, fora do ar ou trancada: cartão neutro. Nunca um erro —
     robô que recebe 500 desiste e mostra link pelado, que é pior que o neutro. */
  const podeMostrarFoto = Boolean(galeria) && !galeria?.senha_hash;

  let capaEmbutida: string | null = null;
  if (podeMostrarFoto && galeria) {
    try {
      const medias = await listarMediasPublicas(galeria.id);
      const capa = escolherCapa(medias, galeria.capa_media_id);

      if (capa) {
        /* Foto ou pôster do filme, com a queda para o original só na foto — a
           regra mora em `fotoParaOCartao`, que a vitrine usa também. */
        capaEmbutida = await fotoParaOCartao(capa);
      }
    } catch {
      /* Listar pode falhar; nada disso derruba o cartão. Sem foto, o quadro
         neutro ainda diz de quem é a galeria. */
      capaEmbutida = null;
    }
  }

  const titulo = galeria?.titulo ?? marca.nome;
  const estudioNome = galeria?.estudio_nome ?? marca.nome;

  /*
   * ── A COR DO CARTÃO É A COR DA GALERIA (06/09/2026) ─────────────────────
   *
   * A Carol: "coloquei cor branca lá na configuração e o link do WhatsApp tá
   * indo escuro". A paleta daqui era cravada — gradiente quase preto, texto
   * creme, assinatura dourada — e valia igual para a galeria branca dela e
   * para uma galeria noturna. O cartão é a primeira coisa que o casal vê da
   * entrega, e ele contradizia a galeria inteira.
   *
   * Vem de `variaveisDoTema`, a MESMA função que pinta a página. Não é só
   * economia de código: enquanto forem a mesma fonte, cartão e galeria não têm
   * como divergir de novo, e o contraste medido lá dentro (o `--g-suave` com
   * piso de 4,5:1) vale aqui também.
   *
   * Sem galeria — link morto, robô batendo em endereço antigo — cai no tema
   * padrão, que é o escuro da marca. Aí o cartão é NOSSO mesmo.
   */
  const aparencia = lerAparencia(galeria?.aparencia);
  const tema = variaveisDoTema(aparencia);
  const fundo = tema["--g-fundo"];
  const corTexto = tema["--g-texto"];
  const corAssinatura = tema["--g-suave"];

  /*
   * O gradiente do véu é montado AQUI, e não dentro do `style`.
   *
   * Não é gosto: `scripts/testar-seo.mjs` varre este arquivo atrás de todo
   * bloco `style={{ ... position: "absolute" ... }}` e exige `width` e `height`
   * em cada um — a trava do defeito do véu invisível. A varredura para na
   * primeira chave de fechamento, então uma interpolação `${...}` dentro do
   * bloco esconderia o elemento inteiro dela, e a trava cairia em silêncio.
   */
  const veu = `linear-gradient(to top, ${comAlfa(fundo, 0.96)} 0%, ${comAlfa(fundo, 0.9)} 24%, ${comAlfa(fundo, 0.6)} 46%, ${comAlfa(fundo, 0.16)} 74%, ${comAlfa(fundo, 0)} 100%)`;
  const haloAssinatura = `0 2px 12px ${comAlfa(fundo, 0.85)}`;
  const haloTitulo = `0 3px 18px ${comAlfa(fundo, 0.8)}`;

  /*
   * ── O MODO LIMPO (08/09/2026) ───────────────────────────────────────────
   *
   * Carol: "não gosto daquele gradiente branco ali, queria que fosse mais
   * clean". No modo `foto` saem o véu E o texto — os dois juntos, porque um
   * sem o outro não faz sentido: texto sem véu é o que o véu existia para
   * evitar, e véu sem texto é gradiente sem motivo.
   *
   * Nada se perde: o WhatsApp escreve o nome da galeria e o do estúdio ao lado
   * da imagem (ver `generateMetadata` em page.tsx). O que sai da foto é a
   * SEGUNDA cópia deles.
   *
   * A condição é `capaEmbutida`, e não só a escolha: sem foto o modo limpo
   * seria um retângulo de uma cor só. Aí o cartão volta a ter fundo e nome, que
   * é o mesmo caminho da galeria com senha.
   */
  const soAFoto = aparencia.cartao === "foto" && Boolean(capaEmbutida);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          position: "relative",
          background: fundo,
          color: corTexto,
        }}
      >
        {capaEmbutida && (
          // eslint-disable-next-line @next/next/no-img-element -- satori desenha, não é <img> de navegador
          <img
            src={capaEmbutida}
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}

        {/*
          O VÉU É CALCULADO PELA PIOR FOTO, não pela foto média.

          A primeira versão ia de 92% no rodapé a 55% na metade, e pareceu boa
          contra a capa escura do banco de desenvolvimento. Na primeira galeria
          real — vestido branco e azulejo claro atrás do texto — o nome do
          estúdio sumiu. Foto de casamento é clara com frequência, e o cartão
          não pode depender de qual foto caiu ali.

          Agora a faixa onde o texto mora nunca fica abaixo de 82% de preto, e a
          sombra segura as bordas das letras quando a foto tem detalhe fino
          (renda, folhagem) exatamente atrás delas.

          ── E POR QUE ISTO NÃO FUNCIONAVA ────────────────────────────────

          A primeira correção do véu não mudou NADA, e demorou a aparecer
          porque a capa do banco de desenvolvimento é escura: o texto lia de
          qualquer jeito. O véu simplesmente não era desenhado.

          A causa é do renderizador, não do CSS: no satori, elemento absoluto
          com "inset: 0" e sem largura e altura fica com tamanho zero. Em
          navegador o "inset" resolve o tamanho; ali não. A imagem ao lado
          sempre funcionou porque já trazia as duas medidas — foi o que
          escondeu o defeito.

          Achado com um diagnóstico grosseiro: o véu pintado de vermelho sólido,
          que saiu invisível. Medir foi o que resolveu; olhar não resolveu.

          ── E POR QUE ELE AGORA É DA COR DA GALERIA ──────────────────────

          Era preto fixo, e com ele o cartão de uma galeria branca continuava
          escuro por baixo da foto — metade da queixa da Carol. Agora o véu é o
          FUNDO do tema, com as mesmas opacidades.

          A promessa de legibilidade não se perde na troca; ela até fica mais
          firme. Antes era "preto por baixo, texto creme por cima", combinação
          que só funcionava porque as duas pontas eram fixas. Agora é o fundo do
          tema por baixo e o texto do tema por cima — e esses dois já têm
          contraste medido entre si, seja o tema claro, escuro ou uma cor que o
          fotógrafo escolheu à mão.
        */}
        {!soAFoto && (
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

        {!soAFoto && (
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "0 72px 68px" }}>
          <div
            style={{
              fontSize: 26,
              letterSpacing: 6,
              textTransform: "uppercase",
              /*
               * A assinatura NÃO usa a cor do botão, e é a mesma regra da capa
               * de verdade (ver `TextoEstudio` em galeria-capa.tsx). Juan,
               * 05/09/2026: "deixei os botões verdinhos e gostei, mas a logo
               * também ficou verde e isso ficou ruim". Aqui era dourado fixo,
               * o que dava no mesmo por outro caminho.
               */
              color: corAssinatura,
              /* O halo é da COR DO FUNDO, não preto: sobre um cartão branco uma
                 sombra preta suja a letra em vez de destacá-la. O trabalho dele
                 é o mesmo — segurar a borda onde a foto tem detalhe fino. */
              textShadow: haloAssinatura,
            }}
          >
            {estudioNome}
          </div>
          <div
            style={{
              fontSize: 78,
              fontWeight: 700,
              lineHeight: 1.05,
              marginTop: 18,
              textShadow: haloTitulo,
            }}
          >
            {titulo}
          </div>
        </div>
        )}
      </div>
    ),
    size,
  );
}
