import "server-only";
import { consultar, consultarUm } from "./db";
import { emailConfigurado, enviarEmail, moldura } from "./email";
import { asaasConfigurado, cancelarAssinatura } from "./asaas";
import { formatarBytes } from "./tenants";
import { registrarEvento, ACOES } from "./eventos";
import { hashDeEmail } from "./ip";
import {
  alertarUmaPessoa,
  apagarGaleriasDaConta,
  escapar,
  porExtenso,
  TETO_POR_RODADA,
} from "./testes-abandonados";
import { marca } from "@/config/marca";
import { AVISOS_ANTES_DE_APAGAR, DIAS_DE_RETENCAO, TOTAL_DE_AVISOS } from "@/config/retencao";

/**
 * A CONTA ENCERRADA — três meses no ar, quatro avisos, e só então apagar.
 *
 * ── POR QUE EXISTE (30/09/2026) ──────────────────────────────────────────
 *
 * Conta cancelada ou inadimplente ficava guardada para sempre: nada a apagava,
 * e nenhum texto dizia até quando. Juridicamente é o lado seguro, mas é disco
 * pago por nós sem prazo, e o dia em que alguém decidisse limpar à mão seria o
 * dia de apagar sem regra escrita — o que processo nenhum perdoa. O Felipe
 * decidiu: "3 meses, mas colocando vários avisos" (`config/retencao.ts`).
 *
 * É a SEGUNDA exceção ao princípio 2 do PRODUCT.md ("nada é apagado sem alguém
 * pedir e nomear"), depois do teste abandonado, e usa as mesmas travas dele.
 *
 * ── O CALENDÁRIO ─────────────────────────────────────────────────────────
 *
 *   fim        o período pago acaba (`pago_ate`) — ou o teste, para quem
 *              assinou e nunca pagou (`trial_ate`). 1º aviso: "os arquivos
 *              serão apagados em <data>", data = aviso + 90 dias.
 *   data − 30  2º aviso
 *   data − 7   3º aviso
 *   data − 1   último aviso
 *   data       os arquivos são apagados. A CONTA fica: dá para entrar,
 *              assinar de novo e recomeçar.
 *
 * As galerias continuam no ar durante os três meses. É o casal que perde o
 * link no dia em que o arquivo sai — e é por isso que os avisos dizem "baixe o
 * que quiser guardar".
 *
 * A data sai do aviso que DE FATO saiu, nunca do calendário teórico: se o
 * e-mail ficar desligado um mês, tudo atrasa um mês. Aviso atrasado empurra a
 * data para garantir a antecedência que ele promete; nunca a puxa.
 *
 * ── AS TRAVAS (as mesmas do teste abandonado) ────────────────────────────
 *
 *   - Só com o e-mail E a cobrança ligados.
 *   - Um aviso só conta se o e-mail SAIU.
 *   - Pagou, reativou, virou cortesia: sai da fila na hora. E o aviso de um
 *     ciclo anterior (antes do fim do período de agora) não vale — reassinar e
 *     cancelar de novo recomeça do primeiro aviso.
 *   - O teto: mais de `TETO_POR_RODADA` contas para apagar numa madrugada, e
 *     nenhuma é apagada; uma pessoa é chamada.
 *   - Inadimplente que chega ao fim tem a assinatura cancelada no Asaas: não
 *     há o que cobrar de quem não tem mais arquivo.
 */

const DIA_MS = 24 * 60 * 60 * 1000;
/* Mesma folga do teste abandonado: a rodada diária de um dia para o outro não
 * pode perder o passo por dois segundos. */
const FOLGA_MS = 2 * 60 * 60 * 1000;

export const STATUS_ENCERRADOS = ["cancelado", "inadimplente"] as const;

export interface ContaEncerrada {
  status: string;
  pago_ate: Date | string | null;
  trial_ate: Date | string | null;
  retencao_aviso_em: Date | string | null;
  retencao_avisos: number;
  retencao_apagar_em: Date | string | null;
  /** Quantas galerias a conta ainda tem, em qualquer estado. */
  galerias: number;
}

export type PassoDaRetencao =
  | { tipo: "nada" }
  /** `numero` é 1 a TOTAL_DE_AVISOS. */
  | { tipo: "aviso"; numero: number; apagarEm: Date }
  | { tipo: "apagar" };

function data(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Quando o serviço pago acabou: o período, ou o teste de quem nunca pagou. */
export function fimDoServico(conta: Pick<ContaEncerrada, "pago_ate" | "trial_ate">): Date | null {
  return data(conta.pago_ate) ?? data(conta.trial_ate);
}

/**
 * O próximo passo de uma conta encerrada. PURA — o teste percorre o calendário
 * dia a dia sem banco e sem e-mail.
 *
 * Na dúvida, "nada": status que não é de conta encerrada, data que não se lê,
 * conta vazia. Guardar mais um mês custa pouco; apagar o que não devia não tem
 * volta.
 */
export function proximoPassoDaRetencao(conta: ContaEncerrada, agora: Date = new Date()): PassoDaRetencao {
  if (!(STATUS_ENCERRADOS as readonly string[]).includes(conta.status) || conta.galerias <= 0) {
    return { tipo: "nada" };
  }
  const fim = fimDoServico(conta);
  if (!fim) return { tipo: "nada" };

  const t = agora.getTime() + FOLGA_MS;
  if (t < fim.getTime()) return { tipo: "nada" };

  const primeiro = data(conta.retencao_aviso_em);
  if (!primeiro || primeiro.getTime() < fim.getTime() || conta.retencao_avisos < 1) {
    return {
      tipo: "aviso",
      numero: 1,
      apagarEm: new Date(agora.getTime() + DIAS_DE_RETENCAO * DIA_MS),
    };
  }

  const prometido =
    data(conta.retencao_apagar_em)?.getTime() ?? primeiro.getTime() + DIAS_DE_RETENCAO * DIA_MS;

  if (conta.retencao_avisos < TOTAL_DE_AVISOS) {
    const antes = AVISOS_ANTES_DE_APAGAR[conta.retencao_avisos - 1];
    if (t < prometido - antes * DIA_MS) return { tipo: "nada" };
    return {
      tipo: "aviso",
      numero: conta.retencao_avisos + 1,
      /* Atrasado, garante a antecedência inteira que o e-mail anuncia. */
      apagarEm: new Date(Math.max(prometido, agora.getTime() + antes * DIA_MS)),
    };
  }

  return t >= prometido ? { tipo: "apagar" } : { tipo: "nada" };
}

/**
 * A data que o último aviso prometeu, para a tela de Conta — só quando a conta
 * está encerrada, já foi avisada e a data ainda não passou.
 */
export function dataPrometidaParaApagar(
  conta: Pick<ContaEncerrada, "status" | "retencao_avisos" | "retencao_apagar_em">,
  agora: Date = new Date(),
): Date | null {
  if (!(STATUS_ENCERRADOS as readonly string[]).includes(conta.status) || conta.retencao_avisos < 1) {
    return null;
  }
  const d = data(conta.retencao_apagar_em);
  return d && d.getTime() > agora.getTime() ? d : null;
}

/** A rotina pode rodar? Ver "AS TRAVAS". */
export function retencaoLigada(): boolean {
  return emailConfigurado() && asaasConfigurado();
}

interface Candidata extends ContaEncerrada {
  id: string;
  email: string;
  nome_estudio: string;
  bytes: string;
  asaas_assinatura_id: string | null;
}

async function candidatas(agora: Date, apenas?: string[]): Promise<Candidata[]> {
  return consultar<Candidata>(
    `select t.id, t.email, t.nome_estudio, t.status, t.pago_ate, t.trial_ate,
            t.asaas_assinatura_id, t.retencao_aviso_em, t.retencao_avisos, t.retencao_apagar_em,
            count(g.id)::int as galerias,
            coalesce(sum(g.bytes_total), 0)::text as bytes
       from tenants t
       join galerias g on g.tenant_id = t.id
      where t.status = any($2::text[])
        and coalesce(t.pago_ate, t.trial_ate) < $1::timestamptz + interval '1 day'
        and ($3::uuid[] is null or t.id = any($3::uuid[]))
      group by t.id
      order by coalesce(t.pago_ate, t.trial_ate)`,
    [agora, [...STATUS_ENCERRADOS], apenas ?? null],
  );
}

/** O e-mail do aviso `numero`. Devolve se saiu. */
export async function enviarAvisoDeRetencao(
  conta: { email: string; nome_estudio: string; galerias: number; bytes: string },
  numero: number,
  apagarEm: Date,
): Promise<boolean> {
  const quando = porExtenso(apagarEm);
  const link = `https://${marca.dominio}/painel/conta`;
  const quanto = `${conta.galerias} ${conta.galerias === 1 ? "galeria" : "galerias"} (${formatarBytes(conta.bytes)})`;
  const ultimo = numero === TOTAL_DE_AVISOS;
  const faltam = Math.max(1, Math.round((apagarEm.getTime() - Date.now()) / DIA_MS));

  const assunto =
    numero === 1
      ? `Sua assinatura na ${marca.nome} terminou: os arquivos ficam até ${quando}`
      : ultimo
        ? `Último aviso: os arquivos de ${conta.nome_estudio} serão apagados em ${quando}`
        : `Faltam ${faltam} dias: os arquivos de ${conta.nome_estudio} serão apagados em ${quando}`;

  const linhas = [
    numero === 1
      ? `A assinatura de ${conta.nome_estudio} terminou. As galerias continuam no ar e os arquivos — ${quanto} — ficam guardados até ${quando}. Nessa data, as galerias saem do ar e os arquivos são apagados.`
      : `Os arquivos de ${conta.nome_estudio} — ${quanto} — serão apagados em ${quando}. Até lá, as galerias continuam no ar.`,
    "Para manter tudo como está, basta reativar a assinatura antes dessa data. Nada muda de endereço.",
    "Se não for continuar, baixe antes dessa data o que quiser guardar — pelo próprio link de cada galeria, com o download ligado. Esta é uma ferramenta de entrega, e depois da data não há outra cópia do nosso lado. A conta continua existindo, e você pode assinar de novo quando quiser.",
  ];

  const corpo = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#a4adbd">${escapar(linhas[0])}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a4adbd">${escapar(linhas[1])}</p>
    <p style="margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#d9a441;color:#07080b;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px">
        Reativar a assinatura
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7484">${escapar(linhas[2])}</p>`;

  return enviarEmail({
    para: conta.email,
    assunto,
    html: moldura(ultimo ? "Último aviso" : "Seus arquivos", corpo),
    texto: [linhas[0], "", linhas[1], link, "", linhas[2]].join("\n"),
  });
}

/**
 * Apaga os arquivos de uma conta encerrada. Confere de novo, na hora, que ela
 * continua encerrada e com o MESMO fim de serviço — quem pagou nesse meio tempo
 * mudou o `pago_ate` e sai daqui intocado.
 */
async function apagarArquivosDaContaEncerrada(c: Candidata): Promise<void> {
  const fim = fimDoServico(c);
  const ainda = await consultarUm<{ nome_estudio: string; asaas_assinatura_id: string | null }>(
    `select nome_estudio, asaas_assinatura_id from tenants
      where id = $1 and status = any($2::text[])
        and coalesce(pago_ate, trial_ate) = $3::timestamptz`,
    [c.id, [...STATUS_ENCERRADOS], fim],
  );
  if (!ainda) return;

  const { galerias, arquivos } = await apagarGaleriasDaConta(c.id, ainda.nome_estudio, "conta_encerrada");

  /* Inadimplente com assinatura viva: o Asaas continuaria gerando cobrança
   * para uma conta sem arquivo nenhum. Falhar aqui não desfaz a limpeza — fica
   * no log e no evento, para uma pessoa cancelar à mão. */
  let assinaturaCancelada: boolean | null = null;
  if (ainda.asaas_assinatura_id) {
    try {
      await cancelarAssinatura(ainda.asaas_assinatura_id);
      assinaturaCancelada = true;
    } catch (e) {
      assinaturaCancelada = false;
      console.error(`[contas-encerradas] não cancelei a assinatura de ${c.id}:`, e);
    }
  }

  await consultar(
    `update tenants
        set arquivos_limpos_em = now(),
            status = 'cancelado',
            asaas_assinatura_id = case when $2 then null else asaas_assinatura_id end,
            atualizado_em = now()
      where id = $1`,
    [c.id, assinaturaCancelada === true],
  );
  await registrarEvento({
    tenantId: c.id,
    estudio: ainda.nome_estudio,
    ator: "sistema",
    acao: ACOES.ARQUIVOS_DA_CONTA_ENCERRADA_APAGADOS,
    alvoTipo: "conta",
    alvoId: c.id,
    detalhe: {
      galerias,
      arquivos,
      statusAntes: c.status,
      fimDoServico: fim?.toISOString() ?? null,
      avisos: c.retencao_avisos,
      assinaturaCancelada,
    },
  });
}

export interface ResumoDaRetencao {
  ligada: boolean;
  avisos: number;
  apagadas: number;
  travadasPeloTeto: number;
  falhasDeEnvio: number;
  linhas: string[];
}

/**
 * Uma rodada da rotina. Sem `aplicar`, só descreve — não envia e não apaga.
 * Os parâmetros são os de `rodarLimpezaDeTestes`, pelos mesmos motivos.
 */
export async function rodarRetencaoDeContasEncerradas(opcoes: {
  aplicar: boolean;
  agora?: Date;
  liberarTeto?: boolean;
  forcarLigada?: boolean;
  apenas?: string[];
}): Promise<ResumoDaRetencao> {
  const resumo: ResumoDaRetencao = {
    ligada: opcoes.forcarLigada ?? retencaoLigada(),
    avisos: 0,
    apagadas: 0,
    travadasPeloTeto: 0,
    falhasDeEnvio: 0,
    linhas: [],
  };
  if (!resumo.ligada) return resumo;

  const agora = opcoes.agora ?? new Date();
  const passos = (await candidatas(agora, opcoes.apenas)).map((c) => ({
    c,
    passo: proximoPassoDaRetencao(c, agora),
  }));

  const paraApagar = passos.filter((p) => p.passo.tipo === "apagar");
  const travada = paraApagar.length > TETO_POR_RODADA && !opcoes.liberarTeto;
  if (travada) {
    resumo.travadasPeloTeto = paraApagar.length;
    const lista = paraApagar.map(
      ({ c }) => `apagar: ${c.nome_estudio} <${c.email}> — ${c.galerias} galeria(s), ${formatarBytes(c.bytes)}`,
    );
    resumo.linhas.push(`TETO: ${paraApagar.length} contas encerradas para apagar (teto ${TETO_POR_RODADA}) — nada apagado`);
    resumo.linhas.push(...lista);
    if (opcoes.aplicar) {
      await alertarUmaPessoa(
        `limpeza de contas encerradas parada pelo teto (${paraApagar.length} contas)`,
        "Limpeza parada pelo teto",
        [
          `${paraApagar.length} contas encerradas estavam para ter os arquivos apagados nesta`,
          `madrugada, e o teto é ${TETO_POR_RODADA}. Nada foi apagado.`,
          "",
          ...lista,
          "",
          "Conferido que está certo, rodar no servidor:",
          "  scripts/limpar-lixeira.mjs --aplicar --liberar-teto",
        ].join("\n"),
      );
    }
  }

  for (const { c, passo } of passos) {
    if (passo.tipo === "nada") continue;
    const quem = `${c.nome_estudio} <${c.email}>`;

    if (passo.tipo === "apagar") {
      if (travada) continue;
      resumo.linhas.push(`apagar (conta encerrada): ${quem} — ${c.galerias} galeria(s), ${formatarBytes(c.bytes)}`);
      if (opcoes.aplicar) await apagarArquivosDaContaEncerrada(c);
      resumo.apagadas++;
      continue;
    }

    resumo.linhas.push(
      `aviso ${passo.numero}/${TOTAL_DE_AVISOS} (conta encerrada): ${quem} — apagar em ${porExtenso(passo.apagarEm)}`,
    );
    if (!opcoes.aplicar) {
      resumo.avisos++;
      continue;
    }

    if (!(await enviarAvisoDeRetencao(c, passo.numero, passo.apagarEm))) {
      resumo.falhasDeEnvio++;
      continue;
    }
    /* O primeiro aviso recomeça o calendário: zera a contagem de um ciclo
     * anterior. Os seguintes só andam uma casa. */
    await consultar(
      passo.numero === 1
        ? `update tenants set retencao_aviso_em = $2, retencao_avisos = 1, retencao_apagar_em = $3 where id = $1`
        : `update tenants set retencao_avisos = $3, retencao_apagar_em = $2 where id = $1`,
      passo.numero === 1 ? [c.id, agora, passo.apagarEm] : [c.id, passo.apagarEm, passo.numero],
    );
    await registrarEvento({
      tenantId: c.id,
      estudio: c.nome_estudio,
      ator: "sistema",
      acao: ACOES.AVISO_RETENCAO_ENVIADO,
      alvoTipo: "conta",
      alvoId: c.id,
      detalhe: {
        numero: passo.numero,
        de: TOTAL_DE_AVISOS,
        apagar_em: passo.apagarEm.toISOString(),
        para_hash: hashDeEmail(c.email),
      },
    });
    resumo.avisos++;
  }
  return resumo;
}
