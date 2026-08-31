import { ImageResponse } from "next/og";
import { marca } from "@/config/marca";
import { armazemDe, urlDaDerivada } from "@/lib/armazem";
import { buscarGaleriaPublica, listarMediasPublicas } from "@/lib/galerias-publicas";

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
        const url = await urlDaDerivada(
          capa.chave_preview,
          capa.chave,
          armazemDe(capa.armazem),
          120,
        );
        const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
        const tipo = r.headers.get("content-type") ?? "";
        if (r.ok && tipo.startsWith("image/")) {
          const bytes = Buffer.from(await r.arrayBuffer());
          capaEmbutida = `data:${tipo};base64,${bytes.toString("base64")}`;
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
          background: "linear-gradient(160deg, #16130e 0%, #0d0c0a 55%, #050505 100%)",
          color: "#f4efe6",
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
        */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to top, rgba(5,5,5,.96) 0%, rgba(5,5,5,.90) 22%, rgba(5,5,5,.62) 45%, rgba(5,5,5,.18) 72%, rgba(5,5,5,0) 100%)",
          }}
        />

        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "0 72px 68px" }}>
          <div
            style={{
              fontSize: 26,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: "#f0c987",
              textShadow: "0 2px 12px rgba(0,0,0,.85)",
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
              textShadow: "0 3px 18px rgba(0,0,0,.8)",
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
