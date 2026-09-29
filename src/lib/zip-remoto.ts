import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * O CONTRATO ENTRE O APP E O SERVIDOR DE ZIP — a parte que os dois lados
 * importam.
 *
 * ── POR QUE EXISTE (23/09/2026) ───────────────────────────────────────────
 *
 * O ZIP era montado dentro da rota do VPS. Felipe: "não podemos limitar o
 * download, eles pagam pelo armazenamento, não pelo download", e "não podemos
 * deixar o VPS lento — ele tem outros sites". As duas frases juntas só fecham
 * tirando os bytes do VPS: o ZIP passa a ser montado num servidor à parte, que
 * guarda o arquivo pronto e o entrega quantas vezes pedirem. Ver
 * docs/servidor-zip.md.
 *
 * ── O QUE ATRAVESSA, E COMO ───────────────────────────────────────────────
 *
 *   1. O navegador pede `/api/g/<id>/zip` como sempre. O app aplica as travas
 *      de sempre (`prepararEntrega`), grava um PEDIDO no banco com a lista de
 *      fotos já resolvida e responde 302 para
 *      `<ZIP_SERVIDOR_URL>/z/<pedidoId>.<assinatura>`.
 *   2. O servidor de ZIP confere a assinatura ANTES de tocar em qualquer coisa
 *      (o id de pedido não é adivinhável, mas a assinatura torna o servidor
 *      surdo a lixo sem custar uma consulta ao app).
 *   3. O servidor busca o MANIFESTO no app (`/api/interno/zip/manifesto`),
 *      autenticado pelo mesmo segredo, e monta ou serve o arquivo.
 *   4. Ao terminar (ou ao cair), o servidor RELATA ao app
 *      (`/api/interno/zip/evento`): é o que alimenta a Atividade da galeria e
 *      o painel de administração.
 *
 * ── POR QUE NÃO É `server-only` E NÃO USA `@/` ────────────────────────────
 *
 * O servidor de ZIP é um processo Node puro, fora do Next, e importa este
 * arquivo por caminho relativo. `server-only` o impediria de importar, e o
 * alias `@/` não existe fora do bundler. Não há segredo aqui: o segredo chega
 * pelo ambiente de quem chama.
 */

/* ───────────────────────────── configuração ─────────────────────────────── */

/** Onde o servidor de ZIP atende, sem barra no fim. Vazio = não há servidor. */
export function urlDoServidorDeZip(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ZIP_SERVIDOR_URL ?? "").replace(/\/+$/, "");
}

/**
 * O segredo compartilhado. Curto demais é tratado como ausente: um segredo de
 * oito letras assina, mas não protege, e a decisão "há servidor de ZIP?" não
 * pode depender de um valor que qualquer um adivinha.
 */
export function segredoDoZip(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.ZIP_SEGREDO ?? "";
  return s.length >= 32 ? s : "";
}

/**
 * Há servidor de ZIP? A decisão é a PRESENÇA das duas variáveis, no molde de
 * `armazemDeNovosUploads`: sem elas, o app monta o ZIP como sempre montou e
 * nada quebra; no dia em que entrarem no ambiente, o próximo clique já vai
 * para o servidor — sem deploy e sem interruptor que possa estar ligado com o
 * servidor fora do ar.
 */
export function zipRemotoConfigurado(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(urlDoServidorDeZip(env) && segredoDoZip(env));
}

/* ─────────────────────────────── assinatura ─────────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hmac(segredo: string, texto: string): string {
  return createHmac("sha256", segredo).update(texto).digest("base64url");
}

/** `<pedidoId>.<assinatura>` — o que vai na URL do redirecionamento. */
export function assinarPedido(pedidoId: string, segredo: string): string {
  if (!UUID.test(pedidoId)) throw new Error("pedidoId precisa ser um uuid");
  if (!segredo) throw new Error("sem segredo não há o que assinar");
  return `${pedidoId.toLowerCase()}.${hmac(segredo, pedidoId.toLowerCase())}`;
}

/**
 * Devolve o id do pedido se a assinatura bate, `null` se não.
 *
 * Comparação em tempo constante, pela mesma razão de `senhaConfere` em
 * `galerias-publicas.ts`: a assinatura é a única coisa entre a internet e o
 * manifesto de uma galeria com senha.
 */
export function conferirPedidoAssinado(token: string, segredo: string): string | null {
  if (!segredo) return null;
  const ponto = token.indexOf(".");
  if (ponto <= 0) return null;
  const id = token.slice(0, ponto).toLowerCase();
  const assinatura = token.slice(ponto + 1);
  if (!UUID.test(id) || !assinatura) return null;
  const esperada = Buffer.from(hmac(segredo, id));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length) return null;
  return timingSafeEqual(esperada, recebida) ? id : null;
}

/* ─────────────────────────────── manifesto ──────────────────────────────── */

export type TipoDeZip = "tudo" | "capitulo" | "favoritas" | "recorte";

export interface ArquivoDoManifesto {
  /** Caminho dentro do zip. Barra vira pasta. Já único e sem caracteres proibidos. */
  nome: string;
  /** O tamanho que o banco conhece — o servidor confere o que chega contra ele. */
  tamanho: number;
  /**
   * URL assinada do original, quando pedida (`?comUrls=1`). Vale por
   * `VALIDADE_DAS_URLS`; um ZIP que passe disso pede o manifesto de novo.
   */
  url?: string;
}

export interface Manifesto {
  pedidoId: string;
  galeriaId: string;
  tipo: TipoDeZip;
  nomeDoZip: string;
  /**
   * Chave de cache, ou `null` quando o ZIP não pode ser guardado.
   *
   * Só a galeria inteira e o capítulo são guardáveis: a mesma pergunta dá a
   * mesma resposta para todo mundo. A chave leva a VERSÃO do conteúdo (ver
   * `versaoDoConteudo`): foto republicada pelo Lightroom ou foto nova depois
   * do lançamento mudam a chave, e o arquivo velho simplesmente deixa de ser
   * encontrado — não há invalidação a esquecer.
   */
  chaveDeCache: string | null;
  /**
   * A data que vai dentro do ZIP (ISO), a mesma para o mesmo conteúdo: a mais
   * recente entre as fotos. Com ela, remontar dá os mesmos bytes — ver
   * `OpcoesDoZip.data` em lib/zip-em-fluxo.ts.
   */
  dataDoConteudo?: string;
  arquivos: ArquivoDoManifesto[];
}

/** Validade das URLs assinadas que viajam no manifesto, em segundos. */
export const VALIDADE_DAS_URLS = 6 * 3600;

/**
 * A versão do conteúdo de um pedido guardável — muda quando qualquer foto
 * muda de tamanho, de nome ou de lugar, ou quando entra ou sai uma.
 *
 * Só depende do que está no manifesto, de propósito: o servidor de ZIP
 * consegue recalcular e conferir, e o teste consegue prever.
 */
export function versaoDoConteudo(arquivos: { nome: string; tamanho: number }[]): string {
  const texto = arquivos
    .map((a) => `${a.nome}\u0000${a.tamanho}`)
    .sort()
    .join("\n");
  return createHmac("sha256", "versao").update(texto).digest("hex").slice(0, 24);
}

export function chaveDeCache(
  galeriaId: string,
  tipo: TipoDeZip,
  secaoId: string | null,
  arquivos: { nome: string; tamanho: number }[],
): string | null {
  if (tipo !== "tudo" && tipo !== "capitulo") return null;
  return `${galeriaId}-${tipo}-${secaoId ?? "todas"}-${versaoDoConteudo(arquivos)}`;
}

/* ──────────────────────────────── eventos ───────────────────────────────── */

/**
 * `despejo`: um ZIP pronto que o servidor apagou para abrir espaço (migração
 * 042). `bytes` é o tamanho do que saiu; `pedidoId` é o pedido cuja montagem
 * precisou do espaço.
 *
 * `trecho`: um Range que terminou sem chegar ao fim do arquivo (migração 050).
 * Conta tráfego, não conta entrega — `servido` é só quando o último byte saiu.
 */
export type EventoDeZip = "montado" | "servido" | "abortado" | "despejo" | "trecho";

const EVENTOS: readonly string[] = ["montado", "servido", "abortado", "despejo", "trecho"];

/** O que o servidor relata ao app quando um ZIP termina, é montado ou cai. */
export interface RelatoDeZip {
  pedidoId: string;
  evento: EventoDeZip;
  bytes: number;
  doCache: boolean;
  duracaoMs: number;
}

export function relatoValido(x: unknown): x is RelatoDeZip {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.pedidoId === "string" &&
    UUID.test(r.pedidoId) &&
    typeof r.evento === "string" &&
    EVENTOS.includes(r.evento) &&
    typeof r.bytes === "number" &&
    Number.isFinite(r.bytes) &&
    r.bytes >= 0 &&
    typeof r.doCache === "boolean" &&
    typeof r.duracaoMs === "number" &&
    Number.isFinite(r.duracaoMs)
  );
}

/**
 * O cabeçalho que autentica o servidor de ZIP nas rotas internas do app.
 * `Bearer <segredo>`, conferido em tempo constante.
 */
export function autorizacaoConfere(cabecalho: string | null, segredo: string): boolean {
  if (!segredo || !cabecalho) return false;
  const esperado = Buffer.from(`Bearer ${segredo}`);
  const recebido = Buffer.from(cabecalho);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
