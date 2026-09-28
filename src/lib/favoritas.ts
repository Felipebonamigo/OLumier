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

/*
 * ── O COOKIE DE QUEM SE IDENTIFICOU (15/09/2026) ──────────────────────────
 *
 * Segundo cookie, ao lado do `fav_`, e não uma troca: o primeiro identifica o
 * NAVEGADOR e existe desde a 010; este guarda a PESSOA, que é o que o e-mail
 * estabeleceu. São coisas diferentes e vivem separadas — a noiva no celular e
 * no notebook tem dois navegadores e uma pessoa só.
 *
 * Assinado pela mesma razão do outro: sem assinatura, bastaria trocar o id à
 * mão para abrir a lista de outra pessoa. Com ela, mexer no cookie só derruba
 * a própria identificação.
 */
const nomeCookiePessoa = (galeriaId: string) => `pes_${galeriaId.slice(0, 8)}`;

export async function pessoaAtual(galeriaId: string): Promise<string | null> {
  const jar = await cookies();
  const valor = jar.get(nomeCookiePessoa(galeriaId))?.value;
  if (!valor) return null;

  const corte = valor.lastIndexOf(".");
  if (corte < 1) return null;
  const pessoa = valor.slice(0, corte);
  const assinatura = valor.slice(corte + 1);

  const esperada = assinar(galeriaId, pessoa);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return pessoa;
}

export async function lembrarPessoa(galeriaId: string, pessoaId: string): Promise<void> {
  const jar = await cookies();
  jar.set(nomeCookiePessoa(galeriaId), `${pessoaId}.${assinar(galeriaId, pessoaId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACAO_DIAS * 24 * 60 * 60,
  });
}

/** Sair da própria identificação — o "não sou eu" da tela. */
export async function esquecerPessoa(galeriaId: string): Promise<void> {
  const jar = await cookies();
  jar.delete(nomeCookiePessoa(galeriaId));
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
  /**
   * O fotógrafo COMBINOU uma escolha — definiu limite ou prazo.
   *
   * ── SEM COMBINADO, AS FAVORITAS SÃO LIVRES (28/09/2026) ────────────────
   *
   * Felipe, no celular, numa galeria entregue da Carol: "escolha do quê? não
   * deveria ter escolha aqui, se for dos favoritos, é ilimitado os
   * favoritos". A galeria dizia "Escolha encerrada" e os corações tinham
   * sumido para todo mundo: alguém com o link tocou em "Terminei minha
   * escolha", e isso trancava a lista da galeria inteira — de todas as
   * pessoas, numa galeria em que o fotógrafo nunca combinou escolha nenhuma.
   *
   * Agora a escolha só existe quando o fotógrafo a combina. Sem limite e sem
   * prazo, favorita é favorita: ninguém encerra, nada tranca, e o "Terminei"
   * nem aparece. Com um dos dois, tudo segue como antes.
   */
  combinada: boolean;
}

/**
 * O estado da seleção, numa consulta só.
 *
 * O prazo é conferido aqui e não por uma rotina noturna: seleção que só trancava
 * na madrugada seguinte aceitaria escolha depois do combinado, e o fotógrafo
 * descobriria pelo cliente. Comparar a data na leitura custa nada e nunca atrasa.
 */
/**
 * ── QUEM ESCOLHEU (15/09/2026, migração 033) ──────────────────────────────
 *
 * A identidade é o E-MAIL, não o cookie. O cookie identifica o NAVEGADOR, e a
 * noiva abre no celular e no notebook: dois cookies, uma pessoa só. O que ele
 * passa a guardar é "quem você disse que é", para ela não redigitar.
 *
 * O e-mail não é conferido — decisão do Felipe em 15/09/2026. Isto separa
 * listas por honestidade, não por segurança, e é o bastante para o problema
 * real: o convidado que desmarcava a escolha da noiva sem querer.
 */
export interface PessoaDaGaleria {
  id: string;
  /** `null` em quem se identificou só pelo nome. Ver migração 040. */
  email: string | null;
  nome: string | null;
}

/** Como chamar esta pessoa numa tela. Nunca vazio — o banco garante (040). */
export const comoChamar = (p: { email: string | null; nome: string | null }): string =>
  p.nome?.trim() || p.email?.trim() || "não identificado";

/** A pessoa deste e-mail nesta galeria, criando na primeira vez. */
export async function pessoaPorEmail(
  galeriaId: string,
  email: string,
  nome?: string | null,
): Promise<PessoaDaGaleria | null> {
  const limpo = String(email ?? "").trim().slice(0, 160);
  /* A régua mais burra que separa engano de endereço: algo, arroba, algo,
     ponto, algo. Não é validação de e-mail — ninguém valida e-mail sem mandar
     um —, é só o filtro que impede "ana" e "ana@" de virarem listas órfãs. */
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpo)) return null;

  const limpoNome = nome ? String(nome).trim().slice(0, 80) || null : null;

  /*
   * `on conflict` em cima do índice de `lower(email)`: duas abas da mesma
   * pessoa chegando juntas não podem virar duas listas. O `do update` existe
   * para o nome poder ser corrigido depois, e o `coalesce` impede que uma
   * segunda entrada sem nome apague o nome já dado.
   */
  const linha = await consultarUm<PessoaDaGaleria>(
    `insert into pessoas_da_galeria (galeria_id, email, nome)
          values ($1, $2, $3)
     on conflict (galeria_id, lower(email))
     do update set nome = coalesce(excluded.nome, pessoas_da_galeria.nome)
       returning id, email, nome`,
    [galeriaId, limpo, limpoNome],
  );
  return linha ?? null;
}

/**
 * A pessoa por NOME OU E-MAIL — pelo menos um dos dois.
 *
 * Felipe, 23/09/2026, sobre o download: "pedir nome e email opcional, pelo
 * menos um dos dois para baixar a primeira vez".
 *
 * `pessoaPorEmail` acima continua existindo e continua exigindo e-mail, porque
 * ela serve às FAVORITAS: ali a identidade precisa ser a mesma no celular e no
 * notebook, e só o e-mail atravessa dois aparelhos. Para saber quem baixou,
 * "Tia Marta" vale — e exigir e-mail de cada convidado que quer salvar uma foto
 * é atrito em cima de quem não tem nada a ver com a contabilidade do estúdio.
 *
 * Quem dá e-mail cai no mesmo caminho das favoritas, e é de propósito: baixar e
 * favoritar com o mesmo e-mail é a MESMA pessoa, e o fotógrafo vê uma linha só.
 */
export async function pessoaPorNomeOuEmail(
  galeriaId: string,
  dados: { email?: string | null; nome?: string | null },
): Promise<PessoaDaGaleria | null> {
  const email = String(dados.email ?? "").trim().slice(0, 160);
  const nome = String(dados.nome ?? "").trim().slice(0, 80);

  if (email) return pessoaPorEmail(galeriaId, email, nome || null);
  if (!nome) return null;

  /* Só nome: a chave é o índice parcial da migração 040, que existe justamente
     para "Tia Marta" não abrir uma linha nova a cada download. */
  return consultarUm<PessoaDaGaleria>(
    `insert into pessoas_da_galeria (galeria_id, email, nome)
          values ($1, null, $2)
     on conflict (galeria_id, lower(btrim(nome))) where email is null
     do update set nome = excluded.nome
       returning id, email, nome`,
    [galeriaId, nome],
  );
}

/** Nome e e-mail de quem está identificado, para a tela dizer "você é fulano". */
export async function dadosDaPessoa(
  galeriaId: string,
  pessoaId: string,
): Promise<PessoaDaGaleria | null> {
  return consultarUm<PessoaDaGaleria>(
    "select id, email, nome from pessoas_da_galeria where id = $1 and galeria_id = $2",
    [pessoaId, galeriaId],
  );
}

/** As fotos que ESTA pessoa escolheu. Sem pessoa, lista vazia. */
export async function favoritasDaPessoa(
  galeriaId: string,
  pessoaId: string | null,
): Promise<string[]> {
  if (!pessoaId) return [];
  const linhas = await consultar<{ media_id: string }>(
    "select media_id from favoritas where galeria_id = $1 and pessoa_id = $2",
    [galeriaId, pessoaId],
  );
  return linhas.map((l) => l.media_id);
}

/** Quem escolheu o quê, para o painel do fotógrafo. */
export async function resumoPorPessoa(
  galeriaId: string,
): Promise<{ id: string; email: string | null; nome: string | null; quantas: number }[]> {
  return consultar<{ id: string; email: string | null; nome: string | null; quantas: number }>(
    `select p.id, p.email, p.nome, count(f.id)::int as quantas
       from pessoas_da_galeria p
       left join favoritas f on f.pessoa_id = p.id
      where p.galeria_id = $1
      group by p.id, p.email, p.nome, p.criado_em
      order by count(f.id) desc, p.criado_em`,
    [galeriaId],
  );
}

export async function estadoSelecao(
  galeriaId: string,
  /*
   * O LIMITE PASSA A CONTAR POR PESSOA (15/09/2026).
   *
   * Com listas separadas é a única leitura coerente: "escolha até 30" dito a
   * quatro pessoas não pode virar 30 no total, ou a primeira a abrir consome a
   * cota das outras. O efeito colateral é real e o fotógrafo precisa saber: se
   * ele combinou 30 fotos no álbum, a noiva escolhe 30 e o noivo outras 30.
   *
   * Sem pessoa, conta a galeria inteira — é o que o painel do fotógrafo lê, e
   * o que a lista antiga (`pessoa_id` nulo) sempre foi.
   */
  pessoaId?: string | null,
): Promise<EstadoSelecao> {
  const linha = await consultarUm<{
    limite: number | null;
    prazo: Date | null;
    fechada_em: Date | null;
    total: number;
  }>(
    `select g.selecao_limite as limite, g.selecao_prazo as prazo,
            g.selecao_fechada_em as fechada_em,
            (select count(*)::int from favoritas f
              where f.galeria_id = g.id
                and ($2::uuid is null or f.pessoa_id = $2)) as total
       from galerias g where g.id = $1`,
    [galeriaId, pessoaId ?? null],
  );

  if (!linha) {
    return {
      total: 0,
      limite: null,
      prazo: null,
      fechadaEm: null,
      aberta: false,
      cheia: false,
      motivo: "fechada",
      combinada: false,
    };
  }

  const vencida = linha.prazo !== null && linha.prazo.getTime() <= Date.now();
  /* Sem limite e sem prazo não há escolha combinada, e nada tranca — nem um
     "terminei" gravado antes desta regra existir. Ver `combinada`. */
  const combinada = linha.limite !== null || linha.prazo !== null;
  /* "Fechada" vence "prazo" na mensagem: se o cliente clicou em terminei, é isso
   * que ele lembra de ter feito, e é a explicação que faz sentido para ele. */
  const motivo: MotivoFechada | null = !combinada
    ? null
    : linha.fechada_em
      ? "fechada"
      : vencida
        ? "prazo"
        : null;

  return {
    total: linha.total,
    limite: linha.limite,
    prazo: linha.prazo,
    fechadaEm: linha.fechada_em,
    aberta: motivo === null,
    cheia: linha.limite !== null && linha.total >= linha.limite,
    motivo,
    combinada,
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


export interface ResumoFavoritas {
  /** media_id → quantas pessoas marcaram */
  porMedia: Map<string, number>;
  /** quantas fotos distintas foram marcadas */
  fotos: number;
  /** quantas listas diferentes existem (celular da noiva e notebook do noivo contam 2) */
  pessoas: number;
}

/**
 * Marca ou desmarca NA LISTA DESTA PESSOA.
 *
 * O `delete` leva `pessoa_id` no `where`, e é essa linha que resolve o pedido
 * inteiro. Filtrar só a LEITURA por pessoa mostraria listas separadas e deixaria
 * um continuar apagando a do outro — o defeito original, agora invisível.
 * `scripts/testar-favoritas-por-pessoa.mjs` gasta metade das etapas nisso.
 *
 * A media precisa ser DESTA galeria: sem essa conferência, um id chutado
 * marcaria foto de outra galeria, e ela apareceria na lista do fotógrafo errado.
 *
 * O limite é conferido AQUI, não na tela: qualquer pessoa com o link chama a
 * rota direto do console do navegador, e limite que só existe no botão é
 * sugestão. DESmarcar passa mesmo com a lista cheia — senão a pessoa fica presa
 * no limite sem poder trocar uma foto por outra, que é o que se faz no fim.
 */
export async function alternarDaPessoa(
  galeriaId: string,
  mediaId: string,
  pessoaId: string,
): Promise<{ favorita: boolean; total: number } | { erro: MotivoFechada | "cheia" } | null> {
  const media = await consultarUm<{ id: string }>(
    "select id from medias where id = $1 and galeria_id = $2 and pronto",
    [mediaId, galeriaId],
  );
  if (!media) return null;

  const estado = await estadoSelecao(galeriaId, pessoaId);
  if (!estado.aberta) return { erro: estado.motivo! };

  const removidas = await consultar<{ id: string }>(
    "delete from favoritas where galeria_id = $1 and media_id = $2 and pessoa_id = $3 returning id",
    [galeriaId, mediaId, pessoaId],
  );
  if (removidas.length > 0) return { favorita: false, total: estado.total - 1 };

  if (estado.cheia) return { erro: "cheia" };

  /* `visitante` continua preenchido porque a coluna é `not null` desde a 010 —
     e continua sendo o que sempre foi: de ONDE veio a marcação. Quem ela É
     agora mora em `pessoa_id`. */
  await consultar(
    `insert into favoritas (galeria_id, media_id, visitante, pessoa_id)
     values ($1, $2, $3::text, $4::uuid)
     on conflict (galeria_id, media_id, pessoa_id) where pessoa_id is not null do nothing`,
    [galeriaId, mediaId, pessoaId, pessoaId],
  );
  return { favorita: true, total: estado.total + 1 };
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
  /* Só fecha escolha COMBINADA (limite ou prazo). Sem isso não há o que
     encerrar — ver `EstadoSelecao.combinada`. A regra fica no SQL, e não só
     na rota, para nenhum caminho novo conseguir trancar favoritas livres. */
  const r = await consultar<{ id: string }>(
    `update galerias set selecao_fechada_em = now()
      where id = $1 and selecao_fechada_em is null
        and (selecao_limite is not null or selecao_prazo is not null)
      returning id`,
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
    /* Tirar limite E prazo desfaz a escolha combinada — e com ela o
       "terminei" que estivesse gravado. Sem isto, combinar um número de novo
       meses depois nasceria trancado por um clique antigo. */
    `update galerias set selecao_limite = $3, selecao_prazo = $4,
            selecao_fechada_em = case when $3::int is null and $4::timestamptz is null
                                      then null else selecao_fechada_em end
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
