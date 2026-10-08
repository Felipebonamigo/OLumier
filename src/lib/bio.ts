import "server-only";
import { consultar } from "./db";
import { hashDeVisitanteDoDia } from "./ip";
import { ehRobo } from "./bio-regras";
import { FUSO } from "@/config/fuso";
import { PRODUTOS_DA_BIO } from "@/config/bio";

/**
 * A MEDIÇÃO DO LINK DA BIO — gravar, e ler.
 *
 * As regras (o que é robô, de onde veio a visita, como o cookie se escreve)
 * moram em `bio-regras.ts`, puras. Aqui só o que toca o banco. A história e o
 * porquê de ser uma tabela à parte estão na migração 063.
 */

/** O dia em Brasília, AAAA-MM-DD. O hash do visitante gira à meia-noite DELES, não à do servidor (UTC). */
export function diaDeHoje(agora = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO }).format(agora);
}

/**
 * Quem está pedindo: se é gente, e o hash do dia dela.
 *
 * `gente: false` (robô) e QUEM CHAMA NÃO GRAVA. Fica no mesmo lugar que a conta
 * do hash para ninguém lembrar de uma metade e esquecer a outra. Sem IP (só
 * acontece fora de produção, sem o Caddy na frente) é gente sem hash: o evento
 * é gravado, só não entra na conta de "pessoas".
 */
export function quemPede(ip: string | null, agente: string | null): { gente: boolean; visitante: string | null } {
  if (ehRobo(agente)) return { gente: false, visitante: null };
  return { gente: true, visitante: ip ? hashDeVisitanteDoDia(ip, agente ?? "", diaDeHoje()) : null };
}

/* ── o freio ──────────────────────────────────────────────────────────────────
 *
 * A rota de visita é pública e escreve no banco: sem freio, um laço de `curl`
 * enche a tabela e estraga o número que ela existe para dar. Na memória, como
 * `tentativas.ts` e pelos mesmos motivos (um processo só; reiniciar zera e tudo
 * bem). O teto é folgado para gente de verdade — uma pessoa abre a página uma
 * vez, no máximo algumas — e apertado para um script.
 */
const TETO_POR_VISITANTE_NA_HORA = 30;
const contagens = new Map<string, { n: number; ate: number }>();

export function dentroDoLimite(visitante: string, agora = Date.now()): boolean {
  if (contagens.size > 5000) {
    for (const [k, v] of contagens) if (v.ate < agora) contagens.delete(k);
  }
  const c = contagens.get(visitante);
  if (!c || c.ate < agora) {
    contagens.set(visitante, { n: 1, ate: agora + 60 * 60 * 1000 });
    return true;
  }
  c.n += 1;
  return c.n <= TETO_POR_VISITANTE_NA_HORA;
}

/*
 * O DUPLO TOQUE, em memória e não no banco.
 *
 * Era um `where not exists` no próprio `insert`, e tinha uma corrida: o clique
 * grava DEPOIS de responder (`after`), então dois toques quase juntos conferiam o
 * banco antes de o primeiro `insert` terminar, e os dois passavam. Pegou na
 * suíte, que dispara os dois pedidos em sequência colada. Um `Map` é atômico
 * num processo só — que é o que o app é, e pelo mesmo motivo de `tentativas.ts`
 * (reiniciar zera, e tudo bem: o duplo toque dura segundos).
 */
const ultimosToques = new Map<string, number>();

function toqueRepetido(visitante: string, evento: string, janelaSeg: number, agora = Date.now()): boolean {
  if (ultimosToques.size > 5000) {
    for (const [k, quando] of ultimosToques) if (agora - quando > 60_000) ultimosToques.delete(k);
  }
  const chave = `${evento}|${visitante}`;
  const antes = ultimosToques.get(chave);
  ultimosToques.set(chave, agora);
  return antes !== undefined && agora - antes < janelaSeg * 1000;
}

/**
 * Grava um evento da bio.
 *
 * `janelaSeg` é uma janela de DUPLO TOQUE: o mesmo visitante, o mesmo evento,
 * dentro dela, conta uma vez só. Para clique é 3 s — o polegar que aperta duas
 * vezes. Para visita não há janela: a página decide, no navegador, que uma aba
 * conta uma vez, e dois celulares na mesma rede com o mesmo modelo não podem
 * apagar um ao outro por cair no mesmo hash. Sem hash (sem IP), não há como
 * dizer que é o mesmo visitante, então também não há janela.
 *
 * NUNCA LANÇA: medir é secundário a levar a pessoa aonde ela quer ir.
 */
export async function registrarEventoDaBio(e: {
  evento: string;
  fonte: string | null;
  meio: string | null;
  campanha: string | null;
  visitante: string | null;
  janelaSeg?: number;
}): Promise<void> {
  try {
    if (e.janelaSeg && e.visitante && toqueRepetido(e.visitante, e.evento, e.janelaSeg)) return;
    await consultar(
      "insert into bio_eventos (evento, fonte, meio, campanha, visitante) values ($1, $2, $3, $4, $5)",
      [e.evento, e.fonte, e.meio, e.campanha, e.visitante],
    );
  } catch (erro) {
    console.error("[bio] evento não gravado:", erro instanceof Error ? erro.message : erro);
  }
}

/* ── a leitura do admin ───────────────────────────────────────────────────── */

export interface LinhaDoDia {
  dia: string;
  visitas: number;
  cliques: Record<string, number>;
  entrar: number;
}

export interface ResumoDaBio {
  desde: Date;
  visitas: number;
  /** Pessoas por dia, somadas — o hash gira, então a mesma pessoa em dois dias conta duas. */
  pessoas: number;
  /** Cliques por evento de produto (`click_galeria_atomo`, …). */
  cliques: Record<string, number>;
  /** Cliques em "Entrar", somando os produtos. */
  entrar: number;
  dias: LinhaDoDia[];
  /** Visitas, cliques e contas por fonte/campanha. */
  origens: { fonte: string; campanha: string; visitas: number; cliques: number }[];
  /** Contas criadas no período que vieram pela ponte, por origem. */
  contas: { origem: string; campanha: string; contas: number }[];
}

const EH_ENTRAR = (evento: string) => evento.startsWith("click_login");

/**
 * Tudo que a página do admin mostra, de uma vez.
 *
 * `dias = 0` é "desde o começo". O recorte é por dia de BRASÍLIA (a tabela
 * guarda `timestamptz`), para o "hoje" do painel ser o hoje de quem lê.
 */
export async function resumoDaBio(dias: number): Promise<ResumoDaBio> {
  const desde = dias > 0 ? new Date(Date.now() - dias * 24 * 60 * 60 * 1000) : new Date(0);

  const [porEvento, porDia, porOrigem, contas] = await Promise.all([
    consultar<{ evento: string; n: number; pessoas: number }>(
      `select evento, count(*)::int as n, count(distinct visitante)::int as pessoas
         from bio_eventos where criado_em >= $1 group by evento`,
      [desde],
    ),
    consultar<{ dia: string; evento: string; n: number }>(
      `select to_char((criado_em at time zone $2)::date, 'YYYY-MM-DD') as dia, evento, count(*)::int as n
         from bio_eventos where criado_em >= $1 group by 1, 2 order by 1 desc`,
      [desde, FUSO],
    ),
    consultar<{ fonte: string; campanha: string; visitas: number; cliques: number }>(
      `select coalesce(fonte, 'direto') as fonte, coalesce(campanha, '—') as campanha,
              count(*) filter (where evento = 'page_view')::int as visitas,
              count(*) filter (where evento like 'click\\_%' and evento not like 'click\\_login%')::int as cliques
         from bio_eventos where criado_em >= $1
        group by 1, 2 order by visitas desc, cliques desc limit 30`,
      [desde],
    ),
    consultar<{ origem: string; campanha: string; contas: number }>(
      `select origem, coalesce(origem_campanha, '—') as campanha, count(*)::int as contas
         from tenants where origem is not null and criado_em >= $1
        group by 1, 2 order by contas desc`,
      [desde],
    ),
  ]);

  const cliques: Record<string, number> = {};
  let entrar = 0;
  let visitas = 0;
  let pessoas = 0;
  for (const l of porEvento) {
    if (l.evento === "page_view") {
      visitas = l.n;
      pessoas = l.pessoas;
    } else if (EH_ENTRAR(l.evento)) entrar += l.n;
    else cliques[l.evento] = l.n;
  }

  const mapa = new Map<string, LinhaDoDia>();
  for (const l of porDia) {
    const linha = mapa.get(l.dia) ?? { dia: l.dia, visitas: 0, cliques: {}, entrar: 0 };
    if (l.evento === "page_view") linha.visitas = l.n;
    else if (EH_ENTRAR(l.evento)) linha.entrar += l.n;
    else linha.cliques[l.evento] = l.n;
    mapa.set(l.dia, linha);
  }

  return { desde, visitas, pessoas, cliques, entrar, dias: [...mapa.values()], origens: porOrigem, contas };
}

/** Os eventos de clique de produto, na ordem em que a página mostra os produtos. */
export const EVENTOS_DE_PRODUTO = PRODUTOS_DA_BIO.map((p) => ({ evento: p.evento, nome: p.nome }));
