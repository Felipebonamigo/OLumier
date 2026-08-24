import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { consultar, consultarUm } from "./db";

/**
 * Favoritas do cliente final — a lista das fotos escolhidas.
 *
 * Ninguém faz login aqui. A identidade é um id anônimo por galeria, guardado
 * num cookie assinado, criado só quando a pessoa marca a primeira foto. Antes
 * disso não existe cookie nenhum: quem só olha a galeria não deixa rastro novo.
 */

const DURACAO_DIAS = 180;

function segredo(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET ausente ou curto demais");
  return s;
}

/**
 * Um cookie por galeria, e não um global.
 *
 * Um id único para o visitante inteiro ligaria a mesma pessoa entre galerias de
 * estúdios diferentes — informação que não precisamos ter e que ninguém nos
 * autorizou a juntar.
 */
const nomeCookie = (galeriaId: string) => `fav_${galeriaId.slice(0, 8)}`;

function assinar(galeriaId: string, visitante: string): string {
  return createHmac("sha256", segredo()).update(`${galeriaId}.${visitante}`).digest("hex");
}

/**
 * Id do visitante já existente, ou null. Não cria nada.
 *
 * Assinado porque o cookie é editável pelo dono do navegador: sem assinatura,
 * bastaria trocar o valor à mão para ler (e apagar) a lista de outra pessoa.
 */
export async function visitanteAtual(galeriaId: string): Promise<string | null> {
  const jar = await cookies();
  const valor = jar.get(nomeCookie(galeriaId))?.value;
  if (!valor) return null;

  const corte = valor.lastIndexOf(".");
  if (corte < 1) return null;
  const visitante = valor.slice(0, corte);
  const assinatura = valor.slice(corte + 1);

  const esperada = assinar(galeriaId, visitante);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return visitante;
}

/** Id do visitante, criando na hora se ainda não existir. */
export async function garantirVisitante(galeriaId: string): Promise<string> {
  const existente = await visitanteAtual(galeriaId);
  if (existente) return existente;

  const novo = randomUUID();
  const jar = await cookies();
  jar.set(nomeCookie(galeriaId), `${novo}.${assinar(galeriaId, novo)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACAO_DIAS * 24 * 60 * 60,
  });
  return novo;
}

/**
 * Marca ou desmarca, e devolve como ficou.
 *
 * A media precisa ser DESTA galeria: sem essa conferência, um id chutado
 * marcaria foto de outra galeria — e ela apareceria na lista do fotógrafo
 * errado.
 */
export async function alternar(
  galeriaId: string,
  mediaId: string,
  visitante: string,
): Promise<{ favorita: boolean } | null> {
  const media = await consultarUm<{ id: string }>(
    "select id from medias where id = $1 and galeria_id = $2 and pronto",
    [mediaId, galeriaId],
  );
  if (!media) return null;

  const removidas = await consultar<{ id: string }>(
    "delete from favoritas where media_id = $1 and visitante = $2 returning id",
    [mediaId, visitante],
  );
  if (removidas.length > 0) return { favorita: false };

  /*
   * `on conflict do nothing` fecha a corrida: dois cliques quase juntos (ou uma
   * rede que reenvia) chegariam aqui duas vezes, e sem isto o segundo estouraria
   * no índice único e viraria erro 500 numa ação que, para a pessoa, deu certo.
   */
  await consultar(
    `insert into favoritas (galeria_id, media_id, visitante)
     values ($1, $2, $3) on conflict (media_id, visitante) do nothing`,
    [galeriaId, mediaId, visitante],
  );
  return { favorita: true };
}

/** As favoritas DESTE visitante. Lista vazia quando ele ainda não marcou nada. */
export async function minhasFavoritas(galeriaId: string): Promise<string[]> {
  const visitante = await visitanteAtual(galeriaId);
  if (!visitante) return [];
  const linhas = await consultar<{ media_id: string }>(
    "select media_id from favoritas where galeria_id = $1 and visitante = $2",
    [galeriaId, visitante],
  );
  return linhas.map((l) => l.media_id);
}

export interface ResumoFavoritas {
  /** media_id → quantas pessoas marcaram */
  porMedia: Map<string, number>;
  /** quantas fotos distintas foram marcadas */
  fotos: number;
  /** quantas listas diferentes existem (celular da noiva e notebook do noivo contam 2) */
  pessoas: number;
}

/** O que o fotógrafo vê no painel. */
export async function resumoDaGaleria(galeriaId: string): Promise<ResumoFavoritas> {
  const linhas = await consultar<{ media_id: string; quantas: number }>(
    `select media_id, count(*)::int as quantas
       from favoritas where galeria_id = $1
      group by media_id`,
    [galeriaId],
  );
  const pessoas = await consultarUm<{ n: number }>(
    "select count(distinct visitante)::int as n from favoritas where galeria_id = $1",
    [galeriaId],
  );
  return {
    porMedia: new Map(linhas.map((l) => [l.media_id, l.quantas])),
    fotos: linhas.length,
    pessoas: pessoas?.n ?? 0,
  };
}
