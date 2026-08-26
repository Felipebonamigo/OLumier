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

/** Por que a seleção não aceita mudança agora. `null` = está aberta. */
export type MotivoFechada = "fechada" | "prazo";

export interface EstadoSelecao {
  /** Quantas fotos estão escolhidas na galeria inteira. */
  total: number;
  limite: number | null;
  prazo: Date | null;
  fechadaEm: Date | null;
  aberta: boolean;
  /** Chegou ao limite. Com a lista cheia ainda dá para DESmarcar. */
  cheia: boolean;
  motivo: MotivoFechada | null;
}

/**
 * O estado da seleção, numa consulta só.
 *
 * O prazo é conferido aqui e não por uma rotina noturna: seleção que só trancava
 * na madrugada seguinte aceitaria escolha depois do combinado, e o fotógrafo
 * descobriria pelo cliente. Comparar a data na leitura custa nada e nunca atrasa.
 */
export async function estadoSelecao(galeriaId: string): Promise<EstadoSelecao> {
  const linha = await consultarUm<{
    limite: number | null;
    prazo: Date | null;
    fechada_em: Date | null;
    total: number;
  }>(
    `select g.selecao_limite as limite, g.selecao_prazo as prazo,
            g.selecao_fechada_em as fechada_em,
            (select count(*)::int from favoritas f where f.galeria_id = g.id) as total
       from galerias g where g.id = $1`,
    [galeriaId],
  );

  if (!linha) {
    return { total: 0, limite: null, prazo: null, fechadaEm: null, aberta: false, cheia: false, motivo: "fechada" };
  }

  const vencida = linha.prazo !== null && linha.prazo.getTime() <= Date.now();
  /* "Fechada" vence "prazo" na mensagem: se o cliente clicou em terminei, é isso
   * que ele lembra de ter feito, e é a explicação que faz sentido para ele. */
  const motivo: MotivoFechada | null = linha.fechada_em ? "fechada" : vencida ? "prazo" : null;

  return {
    total: linha.total,
    limite: linha.limite,
    prazo: linha.prazo,
    fechadaEm: linha.fechada_em,
    aberta: motivo === null,
    cheia: linha.limite !== null && linha.total >= linha.limite,
    motivo,
  };
}

/**
 * Marca ou desmarca, e devolve como ficou.
 *
 * A media precisa ser DESTA galeria: sem essa conferência, um id chutado
 * marcaria foto de outra galeria — e ela apareceria na lista do fotógrafo
 * errado.
 *
 * ── ONDE O LIMITE É CONFERIDO, E POR QUÊ AQUI ─────────────────────────────
 * Aqui, não na tela. Qualquer pessoa com o link chama esta rota direto do
 * console do navegador; limite que só existe no botão é sugestão, e a conversa
 * de "mas eu escolhi 90 fotos" sobra para o fotógrafo.
 *
 * DESmarcar passa mesmo com a lista cheia — senão o casal fica preso no limite
 * sem poder trocar uma foto por outra, que é justamente o que se faz no fim de
 * uma seleção.
 */
export async function alternar(
  galeriaId: string,
  mediaId: string,
  visitante: string,
): Promise<{ favorita: boolean; total: number } | { erro: MotivoFechada | "cheia" } | null> {
  const media = await consultarUm<{ id: string }>(
    "select id from medias where id = $1 and galeria_id = $2 and pronto",
    [mediaId, galeriaId],
  );
  if (!media) return null;

  const estado = await estadoSelecao(galeriaId);
  if (!estado.aberta) return { erro: estado.motivo! };

  const removidas = await consultar<{ id: string }>(
    "delete from favoritas where galeria_id = $1 and media_id = $2 returning id",
    [galeriaId, mediaId],
  );
  if (removidas.length > 0) return { favorita: false, total: estado.total - 1 };

  if (estado.cheia) return { erro: "cheia" };

  /*
   * `on conflict do nothing` fecha a corrida: dois cliques quase juntos (ou uma
   * rede que reenvia) chegariam aqui duas vezes, e sem isto o segundo estouraria
   * no índice único e viraria erro 500 numa ação que, para a pessoa, deu certo.
   */
  await consultar(
    `insert into favoritas (galeria_id, media_id, visitante)
     values ($1, $2, $3) on conflict (galeria_id, media_id) do nothing`,
    [galeriaId, mediaId, visitante],
  );
  return { favorita: true, total: estado.total + 1 };
}

/**
 * As fotos escolhidas na galeria — a lista é uma só, compartilhada.
 *
 * O nome ficou de quando cada visitante tinha a sua (migração 010). Continua
 * aqui porque é o que a página pública chama, e trocar o nome sem trocar o
 * comportamento seria churn; o comportamento mudou na 019.
 */
export async function minhasFavoritas(galeriaId: string): Promise<string[]> {
  const linhas = await consultar<{ media_id: string }>(
    "select media_id from favoritas where galeria_id = $1",
    [galeriaId],
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

/**
 * O cliente diz "terminei minha escolha".
 *
 * Não pede tenant: quem fecha é quem está escolhendo, e ele não tem login. O
 * link (e a senha, quando existe) já foram conferidos pela rota — a mesma régua
 * que vale para marcar.
 *
 * Fechar duas vezes não mexe na data da primeira: o `is null` evita que um
 * clique repetido, ou uma rede que reenviou, mova o "quando" para depois.
 */
export async function fecharSelecao(galeriaId: string): Promise<boolean> {
  const r = await consultar<{ id: string }>(
    `update galerias set selecao_fechada_em = now()
      where id = $1 and selecao_fechada_em is null returning id`,
    [galeriaId],
  );
  return r.length > 0;
}

/**
 * O fotógrafo reabre a seleção.
 *
 * Existe porque cliente muda de ideia — e sem isto a única saída seria o
 * fotógrafo editar o banco. Aqui SIM exige tenant: reabrir é decisão de quem
 * entrega, não de quem tem o link, senão qualquer convidado desfaz o "terminei"
 * do casal.
 */
export async function reabrirSelecao(galeriaId: string, tenantId: string): Promise<boolean> {
  const r = await consultar<{ id: string }>(
    `update galerias set selecao_fechada_em = null
      where id = $1 and tenant_id = $2 returning id`,
    [galeriaId, tenantId],
  );
  return r.length > 0;
}

/**
 * Define limite e prazo. Só o dono da galeria.
 *
 * NÃO apaga marcação nenhuma ao baixar o limite. Baixar de 40 para 20 com 30
 * fotos já escolhidas apagaria 10 escolhas do casal para caber num número — e o
 * casal nem saberia quais sumiram. A lista fica "cheia" (30 de 20) e o próximo
 * passo é dele: desmarcar até caber.
 */
export async function definirRegrasSelecao(
  galeriaId: string,
  tenantId: string,
  regras: { limite: number | null; prazo: Date | null },
): Promise<boolean> {
  const limite =
    regras.limite !== null && Number.isFinite(regras.limite) && regras.limite > 0
      ? Math.floor(regras.limite)
      : null;
  const r = await consultar<{ id: string }>(
    `update galerias set selecao_limite = $3, selecao_prazo = $4
      where id = $1 and tenant_id = $2 returning id`,
    [galeriaId, tenantId, limite, regras.prazo],
  );
  return r.length > 0;
}

export interface ItemDaSelecao {
  id: string;
  /** Nome do arquivo como saiu da câmera — é por ele que se filtra no Lightroom. */
  nome: string;
  capitulo: string | null;
}

/**
 * A lista que o fotógrafo leva para o Lightroom.
 *
 * Devolve o NOME ORIGINAL do arquivo, não o id: o id não existe fora daqui, e o
 * que o fotógrafo faz com esta lista é filtrar por nome dentro do editor. É este
 * método que economiza o "IMG_4471, IMG_4488…" no WhatsApp.
 *
 * Na ordem da GALERIA, não na de marcação: é assim que ele vê as fotos no
 * editor, e uma lista fora de ordem obriga a procurar uma por uma.
 */
export async function listaDaSelecao(galeriaId: string): Promise<ItemDaSelecao[]> {
  return consultar<ItemDaSelecao>(
    `select m.id, m.nome_original as nome, s.nome as capitulo
       from favoritas f
       join medias m on m.id = f.media_id
       left join secoes s on s.id = m.secao_id
      where f.galeria_id = $1
      order by m.ordem, m.criado_em`,
    [galeriaId],
  );
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
