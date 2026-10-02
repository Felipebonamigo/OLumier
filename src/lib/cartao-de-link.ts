import "server-only";
import { armazemDe, urlDoOriginal } from "./armazem";
import { urlDaCapa, type MediaParaCapa } from "./capa-publica";

/**
 * O QUE OS CARTÕES DE LINK DO ESTÚDIO TÊM EM COMUM — a foto e o véu.
 *
 * Nasceu dentro de `g/[estudio]/[galeria]/opengraph-image.tsx` e saiu de lá em
 * 26/09/2026, quando a vitrine do estúdio ganhou cartão próprio. As duas
 * armadilhas abaixo custaram um cartão pelado cada uma para serem achadas, e
 * uma segunda cópia é a que esqueceria uma delas.
 */

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
 * seja: o cartão da galeria só funcionava por acidente, nas poucas mídias
 * antigas sem derivada, que caíam no original. O defeito ficou escondido porque
 * a página da galeria nem chegava a pedir a imagem: sem bloco `openGraph`
 * próprio, o Next servia o cartão da RAIZ. Consertar o texto do cartão ligou a
 * rota pela primeira vez, e o primeiro efeito teria sido trocar "cartão da
 * plataforma" por "cartão nenhum".
 */
const DESENHAVEIS = ["image/jpeg", "image/png"];

/**
 * Teto do que entra na memória para desenhar um quadro de 1200×630.
 *
 * A derivada tem centenas de KB; o ORIGINAL é o arquivo que saiu da câmera e
 * pode passar de 30 MB — e o cartão roda no mesmo VPS que serve as galerias.
 * Acima do teto, o cartão sai sem foto: quadro neutro com a cor e o nome é uma
 * entrega digna; VPS sem memória não é.
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
 * A capa pronta para o satori, ou `null` — nunca um erro.
 *
 * A IMAGEM É BAIXADA AQUI, e não entregue ao renderizador como endereço.
 * Passar a URL assinada e deixar o satori buscá-la parecia mais simples e tinha
 * um modo de falhar que derruba tudo: derivada que não existe mais no balde
 * devolve 404, o renderizador estoura, e a rota inteira responde com conexão
 * fechada. Buscando aqui, o 404 vira `null` e o quadro neutro entra no lugar. O
 * `AbortSignal` fecha o outro buraco: bucket lento não pode segurar a rota até
 * o robô cansar de esperar.
 *
 * A primeira tentativa é a imagem que `urlDaCapa` escolhe: a derivada da foto,
 * ou o PÔSTER do filme (02/10/2026, o filme como capa). A derivada é WebP, e o
 * satori não a desenha (ver `DESENHAVEIS`); então a segunda tentativa é o
 * ORIGINAL — o arquivo que o fotógrafo enviou, JPEG na prática. Custa uma
 * segunda busca, e só na primeira vez que alguém desdobra o link: o que o
 * WhatsApp guarda é o PNG pronto.
 *
 * SÓ FOTO cai no original: o "original" de um vídeo é o .mp4, que o satori não
 * desenha e que custaria a saída do arquivo inteiro para descobrir isso. Vídeo
 * tem o pôster ou não tem capa. E sem `chave_preview` a primeira tentativa já
 * foi o original — o `if` evita repetir a mesma busca.
 *
 * Validade curta de propósito: o link só precisa viver o tempo desta
 * requisição, aqui dentro, e nunca sai deste processo.
 */
export async function fotoParaOCartao(capa: MediaParaCapa): Promise<string | null> {
  try {
    const primeira = await urlDaCapa(capa, 120);
    const embutida = primeira ? await embutirSeDesenhavel(primeira) : null;
    if (embutida || capa.tipo !== "foto" || !capa.chave_preview) return embutida;
    return await embutirSeDesenhavel(await urlDoOriginal(capa.chave, armazemDe(capa.armazem), 120));
  } catch {
    /* Assinar ou baixar pode falhar; nada disso derruba o cartão. Sem foto, o
       quadro neutro ainda diz de quem é. */
    return null;
  }
}

/**
 * `#rrggbb` com transparência, para o véu.
 *
 * As cores do tema são sempre hex de seis dígitos — as dos temas prontos estão
 * escritas assim em `TEMAS`, e as escolhidas à mão passam pelo filtro de
 * `lerCores`, que não aceita outra forma. Então não há caso a tratar aqui: se um
 * dia entrar `rgb()` ou `#fff` naquele arquivo, este parse devolve preto e o
 * teste do cartão acusa antes de chegar em galeria de alguém.
 */
export function comAlfa(hex: string, alfa: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alfa})`;
}
