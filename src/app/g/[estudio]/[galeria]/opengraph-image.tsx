import { ImageResponse } from "next/og";
import { marca } from "@/config/marca";
import { lerAparencia, variaveisDoTema } from "@/config/aparencia";
import { armazemDe, urlDaDerivada, urlDoOriginal } from "@/lib/armazem";
import { buscarGaleriaPublica, listarMediasPublicas } from "@/lib/galerias-publicas";

/**
 * ── O SATORI NÃO DESENHA WEBP (06/09/2026) ────────────────────────────────
 *
 * Alimentado com uma WebP, o renderizador do `ImageResponse` estoura com
 * "u2 is not iterable" — a rota fecha a conexão e o robô do WhatsApp, que
 * diante de erro desiste, mostra o LINK PELADO. Não é hipótese: rodei o
 * `ImageResponse` à mão com a derivada de uma galeria real e ele estourou;
 * com uma JPEG, desenhou.
 *
 * E TODA derivada de foto do produto é `.webp` — 1009 de 1009 no banco. Ou
 * seja: este cartão só funcionava por acidente, nas poucas mídias antigas sem
 * derivada, que caíam no original. O defeito ficou escondido porque a página
 * da galeria nem chegava a pedir esta imagem: sem bloco `openGraph` próprio,
 * o Next servia o cartão da RAIZ. Consertar o texto do cartão ligou esta rota
 * pela primeira vez, e o primeiro efeito teria sido trocar "cartão da
 * plataforma" por "cartão nenhum".
 */
const DESENHAVEIS = ["image/jpeg", "image/png"];

/**
 * Teto do que entra na memória para desenhar um quadro de 1200×630.
 *
 * A derivada tem centenas de KB; o ORIGINAL é o arquivo que saiu da câmera e
 * pode passar de 30 MB — e o cartão roda no mesmo VPS que serve as galerias.
 * Acima do teto, o cartão sai sem foto: quadro neutro com a cor e o nome da
 * galeria é uma entrega digna; VPS sem memória não é.
 */
const TETO_DA_FOTO = 12 * 1024 * 1024;

/** A imagem como `data:`, ou `null` quando não serve para desenhar. */
async function embutirSeDesenhavel(url: string): Promise<string | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) return null;
  const tipo = (r.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!DESENHAVEIS.includes(tipo)) return null;
  const anunciado = Number(r.headers.get("content-length") ?? 0);
  if (anunciado > TETO_DA_FOTO) return null;
  const bytes = Buffer.from(await r.arrayBuffer());
  /* Confere o tamanho REAL também: `content-length` é o que o bucket diz. */
  if (bytes.length > TETO_DA_FOTO) return null;
  return `data:${tipo};base64,${bytes.toString("base64")}`;
}

/**
 * `#rrggbb` com transparência, para o véu.
 *
 * As cores do tema são sempre hex de seis dígitos — as três dos temas prontos
 * estão escritas assim em `TEMAS`, e as escolhidas à mão passam pelo filtro de
 * `lerCores`, que não aceita outra forma. Então não há caso a tratar aqui: se
 * um dia entrar `rgb()` ou `#fff` naquele arquivo, este parse devolve preto e o
 * teste do cartão acusa antes de chegar em galeria de alguém.
 */
function comAlfa(hex: string, alfa: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alfa})`;
}

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

  /*
   * A FOTO É BAIXADA AQUI, e não entregue ao renderizador como endereço.
   *
   * Passar a URL assinada e deixar o satori buscá-la parecia mais simples e
   * tinha um modo de falhar que derruba tudo: derivada que não existe mais no
   * balde devolve 404, o renderizador estoura, e a rota inteira responde com
   * conexão fechada. O robô do WhatsApp, diante disso, desiste e mostra o link
   * pelado — pior que o cartão neutro.
   *
   * Buscando aqui, o 404 vira `null` e o quadro neutro entra no lugar. O
   * `AbortSignal` fecha o outro buraco: bucket lento não pode segurar a rota
   * até o robô cansar de esperar.
   */
  let capaEmbutida: string | null = null;
  if (podeMostrarFoto && galeria) {
    try {
      const medias = await listarMediasPublicas(galeria.id);
      const capa =
        medias.find((m) => m.id === galeria.capa_media_id && m.tipo === "foto") ??
        medias.find((m) => m.tipo === "foto");

      if (capa) {
        /* Validade curta de propósito: o link só precisa viver o tempo desta
           requisição, aqui dentro, e nunca sai deste processo. */
        const armazem = armazemDe(capa.armazem);
        const daDerivada = await urlDaDerivada(capa.chave_preview, capa.chave, armazem, 120);
        capaEmbutida = await embutirSeDesenhavel(daDerivada);

        /*
         * A derivada é WebP, e o satori não a desenha (ver `DESENHAVEIS`).
         * Então a segunda tentativa é o ORIGINAL, que é o arquivo que o
         * fotógrafo enviou — JPEG, na prática. Custa uma segunda busca, e só
         * na primeira vez que alguém desdobra o link: o que o WhatsApp guarda
         * é o PNG pronto.
         *
         * `chave_preview` nulo já cai no original pela própria `urlDaDerivada`;
         * o `if` evita repetir a mesma busca nesse caso.
         */
        if (!capaEmbutida && capa.chave_preview) {
          capaEmbutida = await embutirSeDesenhavel(
            await urlDoOriginal(capa.chave, armazem, 120),
          );
        }
      }
    } catch {
      /* Listar, assinar ou baixar pode falhar; nada disso derruba o cartão. Sem
         foto, o quadro neutro ainda diz de quem é a galeria. */
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
  const tema = variaveisDoTema(lerAparencia(galeria?.aparencia));
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
      </div>
    ),
    size,
  );
}
