import "server-only";
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { consultar, consultarUm } from "./db";
import { DOMINIOS_ATENDIDOS } from "@/config/dominios";

/**
 * DOMÍNIO PRÓPRIO DO ESTÚDIO — `carolinetedesco.com.br` no lugar do subdomínio.
 *
 * Desenho completo em `docs/dominio-proprio.md`. O que este arquivo carrega:
 *
 *   1. normalizar o que a pessoa digita (ela cola a URL da barra do navegador);
 *   2. recusar o que ela não pode reclamar — em especial os NOSSOS domínios;
 *   3. o registro TXT que prova a posse;
 *   4. resolver host → estúdio, com cache, porque o proxy roda em quase toda
 *      requisição do site.
 *
 * ── POR QUE A PROVA DE POSSE VEM ANTES DE TUDO ────────────────────────────
 * Aceitar um domínio é autorizar o Caddy a pedir certificado para ele. A cota
 * da Let's Encrypt é por SERVIDOR, e neste servidor moram Padelizou, Atomatiza,
 * Poke Panda e Bonamigo Systems. Um fotógrafo digitando o domínio errado não
 * pode derrubar a emissão dos outros quatro — por isso `dominio_verificado_em`
 * é o que o porteiro lê, nunca `dominio_proprio`.
 */

/**
 * O nome do registro TXT. **CONGELADO — não acompanha a marca.**
 *
 * Ele mora na zona DNS do CLIENTE. Depois que um estúdio adiciona
 * `_verificacao-galeria.dominio-dele.com.br`, nós não temos como editar a zona
 * dele: trocar este prefixo quebraria a reverificação de todo mundo que já
 * apontou, de uma vez e em silêncio.
 *
 * Por isso ele é neutro de propósito. A marca já mudou duas vezes em dois meses
 * (Fotônio → Olumier → Galeria Átomo) e vai mudar de novo antes deste prefixo.
 * `scripts/testar-dominio-proprio.mjs` falha se ele passar a conter o nome da
 * marca — e a correção, se isso acontecer, é devolver a constante, não atualizar
 * o teste.
 */
const PREFIXO_TXT = "_verificacao-galeria";
const CHAVE_TXT = "galeria-verificacao";

/** Um por estúdio. Ver o comentário da migração 023. */
export const LIMITE_DOMINIOS_POR_ESTUDIO = 1;

/*
 * Rótulo DNS: letras, números e hífen, sem começar nem terminar em hífen, até
 * 63 caracteres. É a regra do próprio DNS, não invenção nossa.
 */
const ROTULO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * O que a pessoa digita vira um domínio, ou `null`.
 *
 * Ela cola o que está na barra do navegador: com `https://`, com `www.`, com
 * barra no fim, às vezes com o caminho junto. Recusar isso seria correto e
 * inútil — o trabalho de tirar essas quatro coisas é nosso, não dela.
 */
export function normalizarDominio(bruto: string | null | undefined): string | null {
  if (!bruto) return null;

  let nome = String(bruto).trim().toLowerCase();
  if (!nome) return null;

  /* Só `http(s)` some. `javascript:` NÃO é esquema a ser removido — é entrada
   * hostil, e o que sobra depois de tirá-lo pareceria um domínio. */
  nome = nome.replace(/^https?:\/\//, "");
  if (nome.includes(":") && !/^[^:]+:\d+$/.test(nome)) return null;

  nome = nome.split("/")[0].split("?")[0].split("#")[0];
  nome = nome.split(":")[0];
  nome = nome.replace(/^www\./, "").replace(/\.$/, "");
  if (!nome) return null;

  if (nome.length > 253) return null;
  /* Endereço IP não é domínio: não se emite certificado assim, e aceitar aqui
   * só adiaria a confusão para a hora em que o Caddy recusar. */
  if (/^\d+(\.\d+)*$/.test(nome)) return null;

  const rotulos = nome.split(".");
  /* Um rótulo só é `localhost` ou erro de digitação — nunca um domínio que o
   * fotógrafo comprou. */
  if (rotulos.length < 2) return null;
  if (!rotulos.every((r) => ROTULO.test(r))) return null;

  return nome;
}

/**
 * O domínio pode pertencer a um estúdio?
 *
 * Recebe o valor JÁ normalizado (ou bruto — normaliza de novo, é barato).
 *
 * A recusa que importa é a dos NOSSOS domínios. Um estúdio com
 * `dominio_proprio = olumier.com.br` passaria a responder pelo endereço da
 * plataforma; com `sirius.olumier.com.br`, pelo endereço de OUTRO estúdio — com
 * certificado legítimo e sem nenhum aviso ao dono.
 *
 * A comparação é por sufixo COM PONTO, igual à de `config/dominios.ts` e pelo
 * mesmo motivo: `olumier.com.br.golpe.net` contém o nosso nome e não é nosso.
 * Esse é domínio de fora legítimo — pode ser reclamado por quem o possua, e a
 * prova de posse decide.
 */
export function podeSerDominioDeEstudio(bruto: string | null | undefined): boolean {
  const nome = normalizarDominio(bruto);
  if (!nome) return false;

  return !DOMINIOS_ATENDIDOS.some((base) => nome === base || nome.endsWith(`.${base}`));
}

/** Onde o estúdio cria o registro: `_verificacao-galeria.dominio-dele.com.br`. */
export function nomeDoRegistroTxt(dominio: string): string {
  return `${PREFIXO_TXT}.${normalizarDominio(dominio) ?? dominio}`;
}

/** O valor que o registro precisa ter. */
export function valorDoRegistroTxt(token: string): string {
  return `${CHAVE_TXT}=${token}`;
}

/**
 * Confere UM registro TXT.
 *
 * `dns.resolveTxt` devolve `string[][]`: um array de PEDAÇOS por registro.
 * Provedor que parte o valor em dois entrega `["galeria-veri", "ficacao=abc"]`,
 * e comparar pedaço a pedaço nunca casaria — daí o `join("")`.
 */
export function confereValorTxt(pedacos: string[], token: string): boolean {
  return pedacos.join("").trim() === valorDoRegistroTxt(token);
}

/**
 * Confere a zona inteira.
 *
 * Achar o nosso no meio de SPF, verificação do Google e do Facebook é o caso
 * NORMAL — toda zona de quem já tem site tem meia dúzia de TXT.
 */
export function confereValorTxtNaZona(zona: string[][], token: string): boolean {
  return zona.some((pedacos) => confereValorTxt(pedacos, token));
}

/** Token do registro TXT. 32 caracteres hex — não se adivinha. */
export function novoToken(): string {
  return randomBytes(16).toString("hex");
}

// --- banco ------------------------------------------------------------------

export interface ResultadoReclamar {
  ok: boolean;
  erro?: string;
  dominio?: string;
  token?: string;
}

/**
 * O estúdio pede um domínio. NÃO o verifica — só guarda o pedido e o token.
 *
 * O token é preservado quando o estúdio repete o mesmo domínio: ele pode estar
 * reconferindo meses depois, e gerar um token novo invalidaria o registro TXT
 * que ele já colocou na zona.
 */
export async function reclamarDominio(
  tenantId: string,
  bruto: string,
): Promise<ResultadoReclamar> {
  const dominio = normalizarDominio(bruto);
  if (!dominio) {
    return { ok: false, erro: "Isso não parece um domínio. Exemplo: seuestudio.com.br" };
  }
  if (!podeSerDominioDeEstudio(dominio)) {
    return { ok: false, erro: "Este endereço é da plataforma e não pode ser usado." };
  }

  const jaEhDele = await consultarUm<{ dominio_token: string | null }>(
    "select dominio_token from tenants where id = $1 and lower(dominio_proprio) = $2",
    [tenantId, dominio],
  );

  const dono = await consultarUm<{ id: string }>(
    "select id from tenants where lower(dominio_proprio) = $1 and id <> $2",
    [dominio, tenantId],
  );
  if (dono) {
    /* Não dizemos QUEM: saber que um domínio já está em uso aqui não ajuda
     * ninguém a resolver, e ajuda quem estiver sondando. */
    return { ok: false, erro: "Este domínio já está em uso por outra conta." };
  }

  const token = jaEhDele?.dominio_token ?? novoToken();

  await consultar(
    `update tenants
        set dominio_proprio = $2,
            dominio_token = $3,
            dominio_verificado_em = case
              when lower(dominio_proprio) = $2 then dominio_verificado_em
              else null
            end
      where id = $1`,
    [tenantId, dominio, token],
  );

  limparCacheDominios();
  return { ok: true, dominio, token };
}

/** O estúdio desiste do domínio e volta para o subdomínio. */
export async function soltarDominio(tenantId: string): Promise<void> {
  await consultar(
    `update tenants set dominio_proprio = null, dominio_token = null,
            dominio_verificado_em = null where id = $1`,
    [tenantId],
  );
  limparCacheDominios();
}

export interface ResultadoVerificar {
  ok: boolean;
  erro?: string;
}

/**
 * Procura o registro TXT e, se achar, marca a posse como provada.
 *
 * Falha de DNS é resposta normal aqui, não excepcional: o estúdio clica em
 * "conferir" antes de o registro propagar, e isso acontece na maioria das
 * primeiras tentativas. Por isso o erro vira mensagem, e não exceção.
 */
export async function verificarPosse(tenantId: string): Promise<ResultadoVerificar> {
  const t = await consultarUm<{ dominio_proprio: string | null; dominio_token: string | null }>(
    "select dominio_proprio, dominio_token from tenants where id = $1",
    [tenantId],
  );
  if (!t?.dominio_proprio || !t.dominio_token) {
    return { ok: false, erro: "Cadastre um domínio antes de conferir." };
  }

  let zona: string[][];
  try {
    zona = await resolveTxt(nomeDoRegistroTxt(t.dominio_proprio));
  } catch {
    /* ENOTFOUND e ENODATA são o caso comum: o registro ainda não propagou, ou
     * foi digitado com o nome errado. Nos dois, o texto útil é o mesmo. */
    return {
      ok: false,
      erro: "Ainda não encontrei o registro. Pode levar alguns minutos para propagar.",
    };
  }

  if (!confereValorTxtNaZona(zona, t.dominio_token)) {
    return { ok: false, erro: "Encontrei o registro, mas com outro valor. Confira se copiou inteiro." };
  }

  await consultar("update tenants set dominio_verificado_em = now() where id = $1", [tenantId]);
  limparCacheDominios();
  return { ok: true };
}

// --- resolução, com cache ---------------------------------------------------

/*
 * O proxy roda em quase toda requisição do site, e domínio próprio não se
 * resolve por sufixo — exige consulta. Sem cache seria uma ida ao banco por
 * requisição.
 *
 * O cache NEGATIVO é o que mais importa: sem ele, um robô varrendo com Host
 * aleatório vira uma consulta por requisição, e o proxy passa a ser o
 * amplificador. Guardar "não existe" custa o mesmo que guardar "existe".
 *
 * Por processo, com validade curta. Endereço próprio muda uma vez na vida do
 * estúdio; um minuto de divergência não é problema, e é o preço de não
 * inventar invalidação distribuída para um caso que não existe.
 */
/*
 * DUAS VALIDADES, e a diferença entre elas não é detalhe de desempenho.
 *
 * ACERTO (60s) — "este host é do estúdio X". Guardar por um minuto poupa uma
 * consulta por requisição no tráfego real, e o dado quase nunca muda: endereço
 * próprio se configura uma vez na vida do estúdio.
 *
 * ERRO (5s) — "este host não é de ninguém". Existe para que um robô varrendo
 * com Host aleatório não vire uma consulta por requisição; para isso, cinco
 * segundos já colapsam a enxurrada inteira em uma consulta.
 *
 * Guardar o ERRO por um minuto seria pagar caro por nada. O caso ruim é o
 * inverso do acerto: o estúdio acaba de provar a posse e alguém já perguntou
 * por aquele host antes — um monitor, um robô, ele mesmo tentando cedo. A
 * escrita limpa o cache DESTE processo, mas nada garante que a pergunta veio
 * daqui. Com um minuto, o dono digita o endereço, vê "não encontrado", e não
 * tem o que fazer além de esperar sem saber quanto.
 *
 * Errar barato para o lado de perguntar de novo.
 */
const VALIDADE_ACERTO_MS = 60_000;
const VALIDADE_ERRO_MS = 5_000;
const cache = new Map<string, { slug: string | null; ate: number }>();
let consultas = 0;

/** Quantas vezes o cache precisou do banco. Só para o teste. */
export function consultasAoBanco(): number {
  return consultas;
}

/** Esvazia o cache. Chamado por toda escrita daqui, e pelo teste. */
export function limparCacheDominios(): void {
  cache.clear();
}

/**
 * Slug do estúdio dono deste host, ou `null`.
 *
 * Só devolve estúdio com a posse PROVADA. Domínio pedido e não verificado não
 * resolve — é a mesma régua do porteiro do certificado.
 */
export async function estudioDoDominioProprio(
  host: string | null | undefined,
): Promise<string | null> {
  const dominio = normalizarDominio(host);
  if (!dominio) return null;

  const agora = Date.now();
  const guardado = cache.get(dominio);
  if (guardado && guardado.ate > agora) return guardado.slug;

  consultas++;
  const linha = await consultarUm<{ slug: string }>(
    `select slug from tenants
      where lower(dominio_proprio) = $1 and dominio_verificado_em is not null`,
    [dominio],
  );

  const slug = linha?.slug ?? null;
  cache.set(dominio, { slug, ate: agora + (slug ? VALIDADE_ACERTO_MS : VALIDADE_ERRO_MS) });
  return slug;
}

/**
 * O porteiro do certificado pergunta isto.
 *
 * Mesma régua da resolução, de propósito: se o app não serve o domínio, o Caddy
 * não deve pedir certificado para ele.
 */
export async function dominioLiberaCertificado(host: string | null | undefined): Promise<boolean> {
  return (await estudioDoDominioProprio(host)) !== null;
}
