import "server-only";
import { consultar, consultarUm } from "./db";
import { enderecoDaGaleria } from "@/config/marca";
import { TIPOS, lerTemplate, type TipoDeEmail } from "@/config/email-da-galeria";

/**
 * A ENTREGA POR E-MAIL E O "REMEMBER" (migração 059).
 *
 * Juan, 01/10/2026: a galeria avisa por e-mail quando fica pronta, e depois
 * volta — três meses para pedir recado, seis meses do evento para relembrar, e
 * na véspera de um ano.
 *
 * ── AGENDAR NÃO É ENVIAR ──────────────────────────────────────────────────
 *
 * Quem aperta o botão no painel AGENDA: uma linha por e-mail, com a data. Quem
 * envia é o script diário (`scripts/enviar-emails-da-galeria.mjs`). A separação
 * é o que torna o reenvio impossível — ver a chave única da migração — e é o que
 * permite ao fotógrafo ver, antes de qualquer coisa sair, exatamente o que vai
 * sair e quando.
 */

/** Quantos destinatários uma galeria aceita. É o casal, não uma lista. */
export const MAX_DESTINATARIOS = 10;

export interface EmailAgendado {
  id: string;
  tipo: TipoDeEmail;
  para: string;
  nome: string | null;
  /*
   * JÁ ESCRITA (dd/mm/aaaa), e não `Date` — e isto é um defeito evitado, não
   * preguiça.
   *
   * `agendado_para` é `date`, e o driver devolve `date` como meia-noite LOCAL do
   * processo. No VPS, que roda em UTC, formatar essa data no fuso do Brasil
   * (`lib/data-na-tela.ts`) subtrai três horas e mostra o DIA ANTERIOR: a fila
   * diria 01/10 para o e-mail agendado em 02/10. Aqui o Postgres escreve a data,
   * e nenhum fuso entra na conta.
   *
   * `enviado_em` é `timestamptz` e não tem esse problema: ali o instante é
   * absoluto, e converter para o fuso do Brasil é exatamente o certo.
   */
  agendadoPara: string;
  enviadoEm: Date | null;
  erro: string | null;
}

/** A régua mais burra que separa engano de endereço — a mesma das favoritas. */
export function emailPlausivel(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}

function somarDias(base: Date, dias: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

/** "2026-10-02" — o que a coluna `date` guarda, sem passar por fuso. */
function soData(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * O CALENDÁRIO de uma galeria — o que seria agendado, e para quando.
 *
 * Fora do banco e sem efeito nenhum, de propósito: é a regra, e a tela do painel
 * mostra exatamente isto ao fotógrafo antes de ele apertar o botão. O teste
 * (`scripts/testar-emails-da-galeria.mjs`) confere esta função, não a fila.
 *
 * `hoje` entra como parâmetro porque data de sistema dentro de regra é o que
 * torna a regra impossível de testar em dezembro.
 */
export function calendarioDosEmails(
  hoje: Date,
  dataEvento: Date | null,
  comLembretes: boolean,
): { tipo: TipoDeEmail; quando: string }[] {
  const saida: { tipo: TipoDeEmail; quando: string }[] = [];
  for (const t of TIPOS) {
    if (t.id === "entrega") {
      /* A entrega sai hoje — é o que o botão faz. */
      saida.push({ tipo: t.id, quando: soData(hoje) });
      continue;
    }
    if (!comLembretes) continue;

    if (t.diasDepoisDaEntrega !== undefined) {
      saida.push({ tipo: t.id, quando: soData(somarDias(hoje, t.diasDepoisDaEntrega)) });
      continue;
    }
    if (t.diasDepoisDoEvento !== undefined) {
      /* Sem data de evento não há de onde contar: o lembrete simplesmente não
         existe, em vez de sair numa data inventada. */
      if (!dataEvento) continue;
      const quando = somarDias(dataEvento, t.diasDepoisDoEvento);
      /*
       * Data que já passou não entra. É o caso comum: a galeria é entregue
       * semanas depois do casamento, e "no dia do casamento" não tem mais como
       * acontecer. Agendar no passado faria o script diário mandar tudo de uma
       * vez na primeira rodada — seis meses, um ano e o dia do evento no mesmo
       * minuto, para quem casou no ano passado.
       */
      if (soData(quando) <= soData(hoje)) continue;
      saida.push({ tipo: t.id, quando: soData(quando) });
    }
  }
  return saida;
}

/**
 * Agenda os e-mails desta galeria para estes destinatários.
 *
 * `on conflict do nothing`: quem já tem a linha não ganha outra, e apertar o
 * botão duas vezes não manda nada duas vezes. Devolve quantas linhas nasceram,
 * que é o número que a tela mostra.
 */
export async function agendarEmails(
  galeriaId: string,
  tenantId: string,
  destinatarios: { email: string; nome?: string | null }[],
  hoje = new Date(),
): Promise<{ agendados: number; erro?: string }> {
  const galeria = await consultarUm<{
    id: string;
    data_evento: Date | null;
    email_lembretes: boolean;
    publicada: boolean;
  }>(
    "select id, data_evento, email_lembretes, publicada from galerias where id = $1 and tenant_id = $2",
    [galeriaId, tenantId],
  );
  if (!galeria) return { agendados: 0, erro: "Galeria não encontrada." };
  /*
   * Galeria fora do ar não é entregue. O link iria para o casal e abriria um
   * 404 — e o fotógrafo descobriria pelo WhatsApp da noiva.
   */
  if (!galeria.publicada) {
    return { agendados: 0, erro: "Publique a galeria antes de avisar o cliente." };
  }

  const limpos: { email: string; nome: string | null }[] = [];
  const vistos = new Set<string>();
  for (const d of destinatarios.slice(0, MAX_DESTINATARIOS)) {
    const email = String(d.email ?? "").trim().slice(0, 160).toLowerCase();
    if (!emailPlausivel(email) || vistos.has(email)) continue;
    vistos.add(email);
    limpos.push({ email, nome: d.nome?.trim().slice(0, 80) || null });
  }
  if (limpos.length === 0) return { agendados: 0, erro: "Escreva pelo menos um e-mail válido." };

  const calendario = calendarioDosEmails(hoje, galeria.data_evento, galeria.email_lembretes);

  let agendados = 0;
  for (const quem of limpos) {
    for (const item of calendario) {
      const linha = await consultarUm<{ id: string }>(
        `insert into emails_da_galeria (galeria_id, tipo, para, nome, agendado_para)
              values ($1, $2, $3, $4, $5::date)
         on conflict (galeria_id, tipo, para) do nothing
           returning id`,
        [galeriaId, item.tipo, quem.email, quem.nome, item.quando],
      );
      if (linha) agendados += 1;
    }
  }
  return { agendados };
}

/** O que esta galeria tem agendado ou já mandou — a lista do painel. */
export async function emailsDaGaleria(galeriaId: string): Promise<EmailAgendado[]> {
  const linhas = await consultar<{
    id: string;
    tipo: string;
    para: string;
    nome: string | null;
    agendado_para: string;
    enviado_em: Date | null;
    erro: string | null;
  }>(
    `select id, tipo, para, nome,
            to_char(agendado_para, 'DD/MM/YYYY') as agendado_para,
            enviado_em, erro
       from emails_da_galeria
      where galeria_id = $1
      order by agendado_para, para`,
    [galeriaId],
  );
  return linhas.map((l) => ({
    id: l.id,
    tipo: l.tipo as TipoDeEmail,
    para: l.para,
    nome: l.nome,
    agendadoPara: l.agendado_para,
    enviadoEm: l.enviado_em,
    erro: l.erro,
  }));
}

/**
 * Cancela o que AINDA NÃO SAIU desta galeria.
 *
 * Só o pendente: e-mail já enviado não se desfaz, e tirar a linha dele faria a
 * tela mentir sobre o que o casal recebeu. É o que acontece quando o fotógrafo
 * desliga os lembretes — e por isso a entrega, que já saiu, continua listada.
 */
export async function cancelarPendentes(
  galeriaId: string,
  tenantId: string,
  tipos?: TipoDeEmail[],
): Promise<number> {
  const apagadas = await consultar<{ id: string }>(
    `delete from emails_da_galeria e
      using galerias g
      where e.galeria_id = $1 and e.galeria_id = g.id and g.tenant_id = $2
        and e.enviado_em is null
        and ($3::text[] is null or e.tipo = any($3::text[]))
      returning e.id`,
    [galeriaId, tenantId, tipos ?? null],
  );
  return apagadas.length;
}

export interface EmailParaEnviar {
  id: string;
  tipo: TipoDeEmail;
  para: string;
  nome: string | null;
  galeriaId: string;
  tenantId: string;
  titulo: string;
  dataEvento: Date | null;
  template: string;
  mensagem: string | null;
  estudioNome: string;
  estudioSlug: string;
  estudioCor: string;
  estudioLogo: string | null;
  galeriaSlug: string;
  capaChave: string | null;
  capaMediaId: string | null;
  /** Estados que impedem o envio: a galeria saiu do ar, ou foi para o cofre. */
  publicada: boolean;
  estado: string;
}

/**
 * O que venceu e ainda não saiu.
 *
 * `agendado_para <= hoje` e não `= hoje`: se o servidor ficar dois dias fora, o
 * que venceu no meio sai na volta, em vez de nunca sair.
 */
export async function pendentesParaEnviar(hoje: Date, limite = 200): Promise<EmailParaEnviar[]> {
  const linhas = await consultar<Record<string, unknown>>(
    `select e.id, e.tipo, e.para, e.nome, e.galeria_id, e.agendado_para,
            g.tenant_id, g.titulo, g.data_evento, g.email_template, g.email_mensagem,
            g.slug as galeria_slug, g.capa_chave, g.capa_media_id, g.publicada, g.estado,
            t.nome_estudio, t.slug as estudio_slug, t.cor_destaque, t.logo_chave
       from emails_da_galeria e
       join galerias g on g.id = e.galeria_id
       join tenants t on t.id = g.tenant_id
      where e.enviado_em is null and e.agendado_para <= $1::date
      order by e.agendado_para
      limit $2`,
    [soData(hoje), limite],
  );
  return linhas.map((l) => ({
    id: String(l.id),
    tipo: String(l.tipo) as TipoDeEmail,
    para: String(l.para),
    nome: (l.nome as string | null) ?? null,
    galeriaId: String(l.galeria_id),
    tenantId: String(l.tenant_id),
    titulo: String(l.titulo),
    dataEvento: (l.data_evento as Date | null) ?? null,
    template: lerTemplate(l.email_template),
    mensagem: (l.email_mensagem as string | null) ?? null,
    estudioNome: String(l.nome_estudio),
    estudioSlug: String(l.estudio_slug),
    estudioCor: String(l.cor_destaque ?? ""),
    estudioLogo: (l.logo_chave as string | null) ?? null,
    galeriaSlug: String(l.galeria_slug),
    capaChave: (l.capa_chave as string | null) ?? null,
    capaMediaId: (l.capa_media_id as string | null) ?? null,
    publicada: Boolean(l.publicada),
    estado: String(l.estado),
  }));
}

/** O endereço que vai no e-mail — o mesmo formato que o Atomatiza recebe. */
export function urlDoEmail(e: EmailParaEnviar): string {
  return enderecoDaGaleria(e.estudioSlug, e.galeriaSlug);
}

export async function marcarEnviado(id: string): Promise<void> {
  await consultarUm(
    "update emails_da_galeria set enviado_em = now(), erro = null where id = $1",
    [id],
  );
}

export async function marcarErro(id: string, motivo: string): Promise<void> {
  await consultarUm("update emails_da_galeria set erro = $2 where id = $1", [
    id,
    motivo.slice(0, 300),
  ]);
}

/**
 * A FOTO DE CAPA, para a imagem do e-mail.
 *
 * A mesma consulta da aba Design, pelo mesmo motivo escrito lá: `limit 1` com
 * `order by (id = capa)` pega exatamente a foto que a galeria pública usaria —
 * a marcada como capa, ou a primeira. Arquivo enviado (`capa_chave`) vence as
 * duas e nem chega aqui: quem chama confere primeiro.
 */
export async function fotoDaCapa(galeriaId: string, capaMediaId: string | null) {
  return consultarUm<{ chave: string; chave_preview: string | null; armazem: string | null }>(
    `select chave, chave_preview, armazem
       from medias
      where galeria_id = $1 and pronto and tipo = 'foto'
      order by (id = $2) desc, ordem, criado_em
      limit 1`,
    [galeriaId, capaMediaId],
  );
}

/**
 * As fotos mais baixadas desta galeria — o destaque dos lembretes.
 *
 * Juan: "algo que destaque as fotos mais baixadas talvez?". O número sai de
 * `acessos` com `acao = 'baixou'`, a mesma fonte de `downloadsPorFoto` — e por
 * isso `baixou_tudo` fica de fora, pela razão escrita lá: ele daria +1 em todas
 * de uma vez e "as mais baixadas" viraria a ordem de sempre.
 *
 * Só foto: pôster de vídeo numa faixa de três miniaturas parece uma foto
 * quebrada. Galeria que ninguém baixou devolve lista vazia, e o e-mail sai sem a
 * faixa — inventar destaque sem dado seria mostrar três fotos quaisquer dizendo
 * que são as preferidas do casal.
 */
export async function maisBaixadas(galeriaId: string, quantas = 3) {
  return consultar<{ chave: string; chave_thumb: string | null; armazem: string | null }>(
    `select m.chave, m.chave_thumb, m.armazem, count(*)::int as vezes
       from acessos a
       join medias m on m.id = a.media_id
      where a.galeria_id = $1 and a.acao = 'baixou' and m.tipo = 'foto' and m.pronto
      group by m.chave, m.chave_thumb, m.armazem
      order by vezes desc
      limit $2`,
    [galeriaId, quantas],
  );
}
