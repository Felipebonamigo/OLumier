import "server-only";
import { consultar, consultarUm } from "./db";
import { emailConfigurado, enviarEmail, moldura } from "./email";
import { asaasConfigurado } from "./asaas";
import { apagarArquivosDasMedias } from "./armazem";
import { apagarObjetos } from "./r2";
import { formatarBytes } from "./tenants";
import { registrarEvento, ACOES } from "./eventos";
import { hashDeEmail } from "./ip";
import { marca } from "@/config/marca";

/**
 * O TESTE ABANDONADO — avisar, avisar de novo, e só então apagar os arquivos.
 *
 * ── POR QUE EXISTE (28/09/2026) ──────────────────────────────────────────
 *
 * Felipe: "Apagar os arquivos de testes abandonados (ex.: 60 dias após vencer,
 * com aviso por e-mail)". Quem testou 14 dias e sumiu ocupava disco para
 * sempre — até 10 GB por conta, pagos por nós. A carência de 15 dias
 * (`galeriasNoAr`) já tirava as galerias do ar; nada tirava os arquivos.
 *
 * É a ÚNICA exceção ao princípio 2 do PRODUCT.md ("nada é apagado sem alguém
 * pedir e nomear"), e por isso as travas abaixo são tantas.
 *
 * ── O CALENDÁRIO ─────────────────────────────────────────────────────────
 *
 *   dia 0    o teste vence; o envio para
 *   dia 15   as galerias saem do ar (carência, `config/trial.ts`)
 *   dia 30   1º aviso: "os arquivos serão apagados em <data>" — data = aviso + 30
 *   dia 53   aviso final: faltam 7 dias
 *   dia 60   os arquivos são apagados. A CONTA fica: a pessoa pode entrar,
 *            assinar e recomeçar.
 *
 * A data prometida sai do aviso que DE FATO foi enviado, e não do vencimento:
 * se o primeiro aviso atrasar (o e-mail desligado por um mês, por exemplo), o
 * apagamento atrasa junto. Nunca o contrário. Pelo mesmo motivo o aviso final
 * garante sete dias inteiros, mesmo que saia depois do dia 53.
 *
 * ── AS TRAVAS ────────────────────────────────────────────────────────────
 *
 *   - Só com o e-mail E a cobrança ligados. Sem e-mail não há aviso, e sem
 *     aviso nada é apagado — a rotina simplesmente não começa. Sem cobrança
 *     não havia como assinar para salvar os arquivos, então também não.
 *   - Um passo só é gravado se o e-mail SAIU. Envio que falha é tentado de
 *     novo na madrugada seguinte, e o relógio não anda.
 *   - Qualquer assinatura (mesmo cancelada depois), status diferente de
 *     `trial` ou teste estendido pelo admin tira a conta da fila, na hora.
 *   - O teto. A página /seguranca promete que "nenhuma rotina apaga mais que
 *     uma fração pequena de uma vez" e que, se uma faxina fosse remover muito
 *     mais que o normal, "ela para sozinha e chama uma pessoa". Aqui é isso ao
 *     pé da letra: mais de `TETO_POR_RODADA` contas para apagar na mesma
 *     madrugada, e a rodada não apaga NENHUMA — manda o alerta para
 *     `ALERTA_EMAIL_DESTINO` (o mesmo do vigia e do backup) e espera alguém
 *     conferir e rodar com `--liberar-teto`. Os avisos continuam saindo.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/** Depois do vencimento, quanto tempo até o primeiro aviso. */
export const DIAS_ATE_O_PRIMEIRO_AVISO = 30;
/** Do primeiro aviso até apagar — é a data que o e-mail promete. */
export const DIAS_DO_AVISO_ATE_APAGAR = 30;
/** O aviso final sai com, no mínimo, este tanto de antecedência. */
export const DIAS_DO_AVISO_FINAL = 7;
/** Acima disto numa rodada, nada é apagado e uma pessoa é chamada. */
export const TETO_POR_RODADA = 20;

/*
 * O temporizador roda uma vez por dia, no mesmo horário. Sem folga, o passo
 * marcado para "30 dias depois das 04:50:03" perderia a rodada das 04:50:01 e
 * atrasaria um dia inteiro. Duas horas cobrem o atraso de qualquer rodada sem
 * adiantar nada de forma que alguém perceba.
 */
const FOLGA_MS = 2 * 60 * 60 * 1000;

export interface ContaNoTeste {
  status: string;
  trial_ate: Date | string | null;
  asaas_assinatura_id: string | null;
  aviso_limpeza_em: Date | string | null;
  aviso_limpeza_final_em: Date | string | null;
  /** Quantas galerias a conta ainda tem, em qualquer estado. */
  galerias: number;
}

export type Passo =
  | { tipo: "nada" }
  | { tipo: "primeiro_aviso"; apagarEm: Date }
  | { tipo: "aviso_final"; apagarEm: Date }
  | { tipo: "apagar" };

function data(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * O próximo passo de uma conta. PURA — é aqui que mora a regra inteira, e o
 * teste a percorre dia a dia sem banco e sem e-mail.
 *
 * Na dúvida, "nada": data que não se lê, status que não se conhece, conta com
 * assinatura. Deixar um teste abandonado ocupando disco mais um mês custa
 * pouco; apagar o que não devia não tem volta.
 */
export function proximoPasso(conta: ContaNoTeste, agora: Date = new Date()): Passo {
  if (conta.status !== "trial" || conta.asaas_assinatura_id || conta.galerias <= 0) {
    return { tipo: "nada" };
  }
  const fim = data(conta.trial_ate);
  if (!fim) return { tipo: "nada" };

  const t = agora.getTime() + FOLGA_MS;
  if (t < fim.getTime() + DIAS_ATE_O_PRIMEIRO_AVISO * DIA_MS) return { tipo: "nada" };

  /* Aviso de um teste ANTERIOR não vale: se o admin estendeu o teste e ele
   * venceu de novo, o calendário recomeça do primeiro aviso. */
  const aviso = data(conta.aviso_limpeza_em);
  if (!aviso || aviso.getTime() <= fim.getTime()) {
    return {
      tipo: "primeiro_aviso",
      apagarEm: new Date(agora.getTime() + DIAS_DO_AVISO_ATE_APAGAR * DIA_MS),
    };
  }

  const prometido = aviso.getTime() + DIAS_DO_AVISO_ATE_APAGAR * DIA_MS;
  const final = data(conta.aviso_limpeza_final_em);
  if (!final || final.getTime() < aviso.getTime()) {
    if (t < prometido - DIAS_DO_AVISO_FINAL * DIA_MS) return { tipo: "nada" };
    return {
      tipo: "aviso_final",
      apagarEm: new Date(Math.max(prometido, agora.getTime() + DIAS_DO_AVISO_FINAL * DIA_MS)),
    };
  }

  const apagarEm = Math.max(prometido, final.getTime() + DIAS_DO_AVISO_FINAL * DIA_MS);
  return t >= apagarEm ? { tipo: "apagar" } : { tipo: "nada" };
}

/** A rotina pode rodar? Ver "AS TRAVAS" acima. */
export function limpezaLigada(): boolean {
  return emailConfigurado() && asaasConfigurado();
}

interface Candidata extends ContaNoTeste {
  id: string;
  email: string;
  nome_estudio: string;
  bytes: string;
}

/**
 * As contas que PODEM ter algum passo pela frente. O filtro fino é
 * `proximoPasso`; esta consulta só evita carregar a base inteira.
 */
async function candidatas(agora: Date, apenas?: string[]): Promise<Candidata[]> {
  return consultar<Candidata>(
    `select t.id, t.email, t.nome_estudio, t.status, t.trial_ate, t.asaas_assinatura_id,
            t.aviso_limpeza_em, t.aviso_limpeza_final_em,
            count(g.id)::int as galerias,
            coalesce(sum(g.bytes_total), 0)::text as bytes
       from tenants t
       join galerias g on g.tenant_id = t.id
      where t.status = 'trial'
        and t.asaas_assinatura_id is null
        and t.trial_ate < $1::timestamptz - ($2 || ' days')::interval
        and ($3::uuid[] is null or t.id = any($3::uuid[]))
      group by t.id
      order by t.trial_ate`,
    [agora, String(DIAS_ATE_O_PRIMEIRO_AVISO - 1), apenas ?? null],
  );
}

export function porExtenso(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

export function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** O e-mail de aviso. Devolve se saiu. */
export async function enviarAvisoDeLimpeza(
  conta: { email: string; nome_estudio: string; galerias: number; bytes: string },
  apagarEm: Date,
  final: boolean,
): Promise<boolean> {
  const quando = porExtenso(apagarEm);
  const link = `https://${marca.dominio}/painel/conta`;
  const quanto = `${conta.galerias} ${conta.galerias === 1 ? "galeria" : "galerias"} (${formatarBytes(conta.bytes)})`;

  const assunto = final
    ? `Último aviso: os arquivos do seu teste serão apagados em ${quando}`
    : `Os arquivos do seu teste na ${marca.nome} serão apagados em ${quando}`;

  const linhas = [
    final
      ? `Faltam ${DIAS_DO_AVISO_FINAL} dias. O teste grátis de ${conta.nome_estudio} terminou, e os arquivos enviados durante ele — ${quanto} — serão apagados em ${quando}.`
      : `O teste grátis de ${conta.nome_estudio} terminou há um mês. As galerias já saíram do ar, e os arquivos — ${quanto} — continuam guardados até ${quando}. Depois disso, são apagados.`,
    "Para manter tudo como está, basta ativar a assinatura antes dessa data. As galerias voltam no mesmo endereço.",
    "Se não for continuar, não precisa fazer nada. A conta continua existindo depois da limpeza, e você pode assinar quando quiser — só as fotos e os vídeos do teste é que não voltam.",
  ];

  const corpo = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#a4adbd">${escapar(linhas[0])}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a4adbd">${escapar(linhas[1])}</p>
    <p style="margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#d9a441;color:#07080b;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px">
        Ativar a assinatura
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7484">${escapar(linhas[2])}</p>`;

  return enviarEmail({
    para: conta.email,
    assunto,
    html: moldura(final ? "Último aviso" : "Seus arquivos do teste", corpo),
    texto: [linhas[0], "", linhas[1], link, "", linhas[2]].join("\n"),
  });
}

/**
 * Apaga todas as galerias de uma conta — linhas e arquivos — e registra cada
 * uma. Serve ao teste abandonado e à conta encerrada (`contas-encerradas.ts`);
 * quem chama confere ANTES, na hora, que a conta ainda está no estado que
 * autoriza apagar.
 *
 * Os arquivos saem por `apagarArquivosDasMedias`, que sabe quais originais
 * moram no B2 — e a capa enviada à parte (`capa_chave`, migração 029), que não
 * é mídia e ficaria para trás.
 */
export async function apagarGaleriasDaConta(
  tenantId: string,
  estudio: string,
  motivo: "teste_abandonado" | "conta_encerrada",
): Promise<{ galerias: number; arquivos: number }> {
  const galerias = await consultar<{ id: string; titulo: string; capa_chave: string | null }>(
    "select id, titulo, capa_chave from galerias where tenant_id = $1",
    [tenantId],
  );

  let arquivos = 0;
  for (const g of galerias) {
    const medias = await consultar<{
      chave: string;
      chave_thumb: string | null;
      chave_preview: string | null;
      armazem: string | null;
    }>("select chave, chave_thumb, chave_preview, armazem from medias where galeria_id = $1", [g.id]);

    const apagou = await consultar("delete from galerias where id = $1 returning id", [g.id]);
    if (apagou.length === 0) continue;

    await registrarEvento({
      tenantId,
      estudio,
      ator: "sistema",
      acao: ACOES.GALERIA_DESTRUIDA,
      alvoTipo: "galeria",
      alvoId: g.id,
      detalhe: { titulo: g.titulo, arquivos: medias.length, motivo },
    });

    /* O banco já é a verdade; falha no armazém vira órfão, que
     * `varrer-orfaos.mjs` recolhe — mesma regra de `destruirGaleria`. */
    const r = await apagarArquivosDasMedias(medias);
    if (r.falhou) console.error(`[${motivo}] galeria ${g.id}: ${r.falhou}`);
    if (g.capa_chave) {
      await apagarObjetos([g.capa_chave]).catch((e) =>
        console.error(`[${motivo}] capa da galeria ${g.id}:`, e),
      );
    }
    arquivos += medias.length;
  }
  return { galerias: galerias.length, arquivos };
}

/**
 * Apaga os arquivos de um teste abandonado.
 *
 * Confere de novo, na hora, que a conta continua um teste sem assinatura: a
 * lista foi montada minutos antes, e alguém pode ter assinado nesse meio tempo.
 */
async function apagarArquivosDaConta(tenantId: string): Promise<{ galerias: number; arquivos: number }> {
  const ainda = await consultarUm<{ nome_estudio: string }>(
    `select nome_estudio from tenants
      where id = $1 and status = 'trial' and asaas_assinatura_id is null`,
    [tenantId],
  );
  if (!ainda) return { galerias: 0, arquivos: 0 };

  const { galerias, arquivos } = await apagarGaleriasDaConta(
    tenantId,
    ainda.nome_estudio,
    "teste_abandonado",
  );

  await consultar("update tenants set arquivos_limpos_em = now() where id = $1", [tenantId]);
  await registrarEvento({
    tenantId,
    estudio: ainda.nome_estudio,
    ator: "sistema",
    acao: ACOES.ARQUIVOS_DO_TESTE_APAGADOS,
    alvoTipo: "conta",
    alvoId: tenantId,
    detalhe: { galerias, arquivos },
  });
  return { galerias, arquivos };
}

export interface ResumoDaRodada {
  ligada: boolean;
  avisos: number;
  avisosFinais: number;
  apagadas: number;
  /**
   * Quantas contas estavam para apagar quando o teto travou a rodada — e aí
   * `apagadas` é zero. Zero quando não travou.
   */
  travadasPeloTeto: number;
  falhasDeEnvio: number;
  linhas: string[];
}

/**
 * Um e-mail para quem cuida do servidor — o endereço é o dos alertas do vigia
 * e do backup. Sem o endereço, fica no log, e o log diz que ninguém soube.
 */
export async function alertarUmaPessoa(assunto: string, titulo: string, texto: string): Promise<void> {
  const para = process.env.ALERTA_EMAIL_DESTINO?.trim();
  if (!para) {
    console.error(`[alerta] ALERTA_EMAIL_DESTINO ausente — ninguém foi avisado: ${assunto}`);
    return;
  }
  await enviarEmail({
    para,
    assunto: `[${marca.nome}] ${assunto}`,
    html: moldura(titulo, `<pre style="white-space:pre-wrap;font-size:13px;color:#a4adbd">${escapar(texto)}</pre>`),
    texto,
  });
}

/** "Para sozinha e chama uma pessoa". */
async function chamarUmaPessoa(quantas: number, linhas: string[]): Promise<void> {
  const texto = [
    `A limpeza de testes abandonados parou: ${quantas} contas estavam para ter os arquivos apagados`,
    `nesta madrugada, e o teto é ${TETO_POR_RODADA}. Nada foi apagado.`,
    "",
    ...linhas,
    "",
    "Conferido que está certo, rodar no servidor:",
    "  scripts/limpar-lixeira.mjs --aplicar --liberar-teto",
  ].join("\n");
  await alertarUmaPessoa(
    `limpeza de testes parada pelo teto (${quantas} contas)`,
    "Limpeza parada pelo teto",
    texto,
  );
}

/**
 * Uma rodada da rotina. Sem `aplicar`, só descreve — não envia e não apaga.
 * `agora` existe para o teste; em produção é o relógio.
 */
export async function rodarLimpezaDeTestes(opcoes: {
  aplicar: boolean;
  agora?: Date;
  /** Uma pessoa conferiu a lista e autoriza passar do teto nesta rodada. */
  liberarTeto?: boolean;
  /** Para o teste: ignora `limpezaLigada()`. Nunca passado em produção. */
  forcarLigada?: boolean;
  /**
   * Para o teste: só estas contas. Sem isto, a suíte rodando num banco
   * compartilhado limparia o estúdio de teste de OUTRA suíte.
   */
  apenas?: string[];
}): Promise<ResumoDaRodada> {
  const resumo: ResumoDaRodada = {
    ligada: opcoes.forcarLigada ?? limpezaLigada(),
    avisos: 0,
    avisosFinais: 0,
    apagadas: 0,
    travadasPeloTeto: 0,
    falhasDeEnvio: 0,
    linhas: [],
  };
  if (!resumo.ligada) return resumo;

  const agora = opcoes.agora ?? new Date();
  const passos = (await candidatas(agora, opcoes.apenas)).map((c) => ({
    c,
    passo: proximoPasso(c, agora),
  }));

  /* O teto é conferido ANTES de apagar a primeira: parar no meio deixaria
   * metade feita e a outra metade para uma pessoa entender depois. */
  const paraApagar = passos.filter((p) => p.passo.tipo === "apagar");
  const travada = paraApagar.length > TETO_POR_RODADA && !opcoes.liberarTeto;
  if (travada) {
    resumo.travadasPeloTeto = paraApagar.length;
    const lista = paraApagar.map(
      ({ c }) => `apagar: ${c.nome_estudio} <${c.email}> — ${c.galerias} galeria(s), ${formatarBytes(c.bytes)}`,
    );
    resumo.linhas.push(`TETO: ${paraApagar.length} contas para apagar (teto ${TETO_POR_RODADA}) — nada apagado`);
    resumo.linhas.push(...lista);
    if (opcoes.aplicar) await chamarUmaPessoa(paraApagar.length, lista);
  }

  for (const { c, passo } of passos) {
    if (passo.tipo === "nada") continue;

    const quem = `${c.nome_estudio} <${c.email}>`;

    if (passo.tipo === "apagar") {
      if (travada) continue;
      resumo.linhas.push(`apagar: ${quem} — ${c.galerias} galeria(s), ${formatarBytes(c.bytes)}`);
      if (opcoes.aplicar) await apagarArquivosDaConta(c.id);
      resumo.apagadas++;
      continue;
    }

    const final = passo.tipo === "aviso_final";
    resumo.linhas.push(
      `${final ? "aviso final" : "1º aviso"}: ${quem} — apagar em ${porExtenso(passo.apagarEm)}`,
    );
    if (!opcoes.aplicar) {
      if (final) resumo.avisosFinais++;
      else resumo.avisos++;
      continue;
    }

    if (!(await enviarAvisoDeLimpeza(c, passo.apagarEm, final))) {
      resumo.falhasDeEnvio++;
      continue;
    }
    /* O primeiro aviso zera o final: é o recomeço do calendário quando o teste
     * foi estendido e venceu de novo. */
    await consultar(
      final
        ? "update tenants set aviso_limpeza_final_em = $2 where id = $1"
        : "update tenants set aviso_limpeza_em = $2, aviso_limpeza_final_em = null where id = $1",
      [c.id, agora],
    );
    await registrarEvento({
      tenantId: c.id,
      estudio: c.nome_estudio,
      ator: "sistema",
      acao: ACOES.AVISO_LIMPEZA_ENVIADO,
      alvoTipo: "conta",
      alvoId: c.id,
      /* O destinatário vai em hash: é a prova de PARA ONDE o aviso foi, num
       * registro que não se apaga (ver `hashDeEmail`). */
      detalhe: { final, apagar_em: passo.apagarEm.toISOString(), para_hash: hashDeEmail(c.email) },
    });
    if (final) resumo.avisosFinais++;
    else resumo.avisos++;
  }
  return resumo;
}
