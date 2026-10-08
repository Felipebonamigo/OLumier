/**
 * AS REGRAS DO LINK DA BIO, sem banco e sem rede.
 *
 * Puro de propósito, como `lib/fotos-da-home-regras.ts`: o teste
 * (`scripts/testar-bio.mjs`) exercita estas funções direto, e a página, as
 * rotas e o cadastro usam as mesmas — a regra que o teste prende é a que roda.
 *
 * ── O VOCABULÁRIO É O DO UTM ──────────────────────────────────────────────
 *
 * `fonte`, `meio` e `campanha` são `utm_source`, `utm_medium` e `utm_campaign`
 * com outro nome. Não é capricho: é o que qualquer ferramenta de análise que
 * entrar um dia (Plausible, GA4, o pixel da Meta) já entende, e o que a
 * Atomatiza — outro sistema, em outro domínio — consegue ler da URL. Inventar
 * um parâmetro próprio obrigaria os dois lados a aprender o nosso.
 */
import { marca } from "@/config/marca";

/** O nome do evento de visita. Os de clique moram em `config/bio.ts`, um por produto. */
export const EVENTO_VISITA = "page_view";

/** Quando o link da bio não diz qual campanha é. */
export const CAMPANHA_PADRAO = "link-da-bio";

/** O cookie da origem: gravado no clique, lido no cadastro. */
export const NOME_DO_COOKIE_DA_BIO = "origem_bio";
export const VALIDADE_DA_ORIGEM_DIAS = 30;

export interface OrigemDaBio {
  fonte: string;
  meio: string;
  campanha: string | null;
}

/**
 * Um rótulo de origem: minúsculas, números, ponto, hífen e sublinhado, até 40.
 *
 * Tudo o que chega por URL é texto de qualquer um. Sem esta peneira, a tabela
 * viraria o depósito de qualquer coisa que alguém ponha depois do `?`, e cada
 * valor diferente seria uma linha nova no relatório.
 */
export function rotulo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim().toLowerCase().replace(/\s+/g, "-");
  return /^[a-z0-9._-]{1,40}$/.test(limpo) ? limpo : null;
}

/** O host de um endereço, ou null se não for um. */
export function hostDe(endereco: string | null | undefined): string | null {
  if (!endereco) return null;
  try {
    return new URL(endereco).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Os endereços que dizem de onde a pessoa veio, quando o link não traz UTM. */
const FONTES_PELO_ENDERECO: readonly (readonly [string, string])[] = [
  ["instagram.com", "instagram"],
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["whatsapp.com", "whatsapp"],
  ["wa.me", "whatsapp"],
  ["linkedin.com", "linkedin"],
  ["lnkd.in", "linkedin"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["tiktok.com", "tiktok"],
  ["t.co", "x"],
  ["x.com", "x"],
  ["twitter.com", "x"],
  ["bing.com", "bing"],
  ["duckduckgo.com", "duckduckgo"],
];

/** "l.instagram.com" → "instagram". Sufixo COM PONTO: `instagram.com.golpe.net` não é o Instagram. */
export function fonteDoEndereco(host: string | null): string | null {
  if (!host) return null;
  if (/^(.+\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)) return "google";
  for (const [dominio, fonte] of FONTES_PELO_ENDERECO) {
    if (host === dominio || host.endsWith(`.${dominio}`)) return fonte;
  }
  return null;
}

/**
 * De onde veio a visita.
 *
 * Do mais certo para o mais palpite:
 *   1. o `utm_source` do link — a escolha de quem pôs o link;
 *   2. o CANAL do endereço (`/bio/instagram`) — também escolha de quem pôs o
 *      link, e sem `?utm_…` feio na bio. É o caminho recomendado;
 *   3. o endereço de onde a pessoa veio (o Instagram abre o link por
 *      `l.instagram.com`), que o navegador de dentro do app nem sempre informa;
 *   4. "direto".
 *
 * Um endereço NOSSO como origem (a pessoa recarregou, ou voltou) não conta
 * como origem nenhuma. E o `utm_campaign` vale em qualquer caminho: o canal diz
 * ONDE está o link, a campanha diz QUAL post.
 */
export function origemDaVisita(entrada: {
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  referrer?: string | null;
  /** O canal do endereço (`CANAIS_DA_BIO`), quando a pessoa chegou por `/bio/<canal>`. */
  canal?: { fonte: string; meio: string } | null;
}): OrigemDaBio {
  const host = hostDe(entrada.referrer);
  const hostExterno = host && host !== marca.dominio && !host.endsWith(`.${marca.dominio}`) ? host : null;
  const doEndereco = fonteDoEndereco(hostExterno);

  const fonte = rotulo(entrada.utm_source) ?? entrada.canal?.fonte ?? doEndereco ?? (hostExterno ? "outro" : "direto");
  const meio =
    rotulo(entrada.utm_medium) ?? entrada.canal?.meio ?? (doEndereco || hostExterno ? "referral" : "nenhum");
  return { fonte, meio, campanha: rotulo(entrada.utm_campaign) };
}

/* ── o cookie ─────────────────────────────────────────────────────────────── */

export interface OrigemComProduto extends OrigemDaBio {
  produto: string;
}

/** `fonte~meio~campanha~produto`. O til não está no alfabeto de `rotulo`, então não se confunde. */
export function montarCookieDaBio(o: OrigemComProduto): string {
  return [o.fonte, o.meio, o.campanha ?? "", o.produto].join("~");
}

/** O inverso, e a fronteira de confiança: cookie é texto que o navegador devolve como quiser. */
export function lerCookieDaBio(valor: string | null | undefined): OrigemComProduto | null {
  if (!valor) return null;
  const partes = valor.split("~");
  if (partes.length !== 4) return null;
  const [fonte, meio, campanha, produto] = [rotulo(partes[0]), rotulo(partes[1]), rotulo(partes[2]), rotulo(partes[3])];
  if (!fonte || !meio || !produto) return null;
  if (partes[2] !== "" && !campanha) return null;
  return { fonte, meio, campanha, produto };
}

/** O que o cadastro grava em `tenants.origem` e `origem_campanha`. */
export function origemDoCadastro(c: OrigemComProduto): { origem: string; campanha: string | null } {
  return { origem: `${c.fonte}/${c.meio}/${c.produto}`, campanha: c.campanha };
}

/* ── o que NÃO é gente ────────────────────────────────────────────────────── */

const ROBOS =
  /bot|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|preview|headless|lighthouse|pagespeed|uptime|monitor|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|libwww|httpclient/i;

/**
 * O navegador é um robô? Sem agente, é.
 *
 * Existe porque o link da bio é colado em conversa e em post, e quem recebe um
 * link (WhatsApp, Instagram, Slack) manda um robô buscar o cartão de
 * pré-visualização. Cada um viraria uma "visita" e, no redirecionador, um
 * "clique". O `Instagram` do navegador de dentro do app NÃO casa aqui: é gente.
 * O `WhatsApp/2.x` casa: o app não tem navegador próprio (o link abre no
 * Chrome ou no Safari), então esse agente só aparece na pré-visualização.
 */
export function ehRobo(agente: string | null | undefined): boolean {
  return !agente || ROBOS.test(agente);
}

/**
 * O navegador está só ADIANTANDO a página (prefetch)? Não é um clique.
 *
 * O redirecionador conta ao ser visitado; um navegador que adianta o link sem
 * a pessoa tocar nele contaria um clique que não houve.
 */
export function ehAdiantamento(cabecalhos: Pick<Headers, "get" | "has">): boolean {
  const proposito = `${cabecalhos.get("sec-purpose") ?? ""} ${cabecalhos.get("purpose") ?? ""}`;
  return (
    /prefetch|prerender/i.test(proposito) ||
    cabecalhos.get("x-moz") === "prefetch" ||
    cabecalhos.has("next-router-prefetch")
  );
}

/* ── o endereço de saída ──────────────────────────────────────────────────── */

/**
 * O destino com a origem na URL — para o produto que mora em OUTRO domínio.
 *
 * O cookie do `galeriaatomo.com.br` não existe para o `atomatiza.com.br`: cada
 * domínio só lê os seus. A URL é a única coisa que atravessa. O vocabulário é
 * o do UTM, e `utm_content=ponte` marca que a pessoa passou pela página-ponte.
 */
export function urlComOrigem(destino: string, o: OrigemDaBio): string {
  const url = new URL(destino);
  url.searchParams.set("utm_source", o.fonte);
  url.searchParams.set("utm_medium", o.meio);
  url.searchParams.set("utm_campaign", o.campanha ?? CAMPANHA_PADRAO);
  url.searchParams.set("utm_content", "ponte");
  return url.toString();
}

/** A origem como a página a leva nos links de saída: `?fonte=…&meio=…&campanha=…`. */
export function consultaDaOrigem(o: OrigemDaBio): string {
  const q = new URLSearchParams({ fonte: o.fonte, meio: o.meio });
  if (o.campanha) q.set("campanha", o.campanha);
  return q.toString();
}

/** O inverso de `consultaDaOrigem`, sobre o que o redirecionador recebe. */
export function origemDaConsulta(q: URLSearchParams): OrigemDaBio {
  return {
    fonte: rotulo(q.get("fonte")) ?? "direto",
    meio: rotulo(q.get("meio")) ?? "nenhum",
    campanha: rotulo(q.get("campanha")),
  };
}
