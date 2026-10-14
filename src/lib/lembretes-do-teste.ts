import "server-only";
import { consultar } from "./db";
import { emailConfigurado, enviarEmail, moldura } from "./email";
import { asaasConfigurado } from "./asaas";
import { usoDoEstudio } from "./medias";
import { formatarBytes } from "./tenants";
import { registrarEvento, ACOES } from "./eventos";
import { hashDeEmail } from "./ip";
import { escapar, porExtenso } from "./testes-abandonados";
import { marca } from "@/config/marca";
import { CARENCIA_POS_TRIAL_DIAS, TETO_TRIAL_GB } from "@/config/trial";
import {
  DIAS_PARA_AVISAR_TEMPO,
  lembreteDoTeste,
  type LembreteDoTeste,
} from "./lembrete-do-teste";

/**
 * O E-MAIL DO LEMBRETE DO TESTE — um por limite, uma vez por teste.
 *
 * A regra de QUANDO avisar mora em `lembrete-do-teste.ts` (a mesma que desenha a
 * tela). Aqui moram o texto, o envio e a memória do que já saiu (migração 077).
 *
 * Mesmas travas dos outros e-mails da conta: sem e-mail ou sem cobrança ligada a
 * rotina não começa (o texto pede para assinar, e sem cobrança não há como), e a
 * marca de "enviado" só é gravada se o e-mail SAIU — falha tenta de novo na
 * madrugada seguinte.
 */

export type TipoDeLembrete = "tempo" | "espaco";

export function lembretesLigados(): boolean {
  return emailConfigurado() && asaasConfigurado();
}

/** O assunto e o corpo — separados do envio para o teste poder lê-los. */
export function textoDoLembrete(
  tipo: TipoDeLembrete,
  conta: { nome_estudio: string },
  l: LembreteDoTeste,
): { assunto: string; paragrafos: string[]; titulo: string } {
  const usado = formatarBytes(l.usadoBytes);
  const teto = `${TETO_TRIAL_GB} GB`;
  const fim = porExtenso(l.terminaEm);
  const depois =
    `Depois disso o envio de novos arquivos para, e as galerias já publicadas ficam no ar por mais ` +
    `${CARENCIA_POS_TRIAL_DIAS} dias.`;

  if (tipo === "tempo") {
    const quando = l.diasRestantes === 1 ? "amanhã" : `em ${l.diasRestantes} dias`;
    return {
      titulo: "Seu teste está terminando",
      assunto: `Seu teste na ${marca.nome} termina ${quando}`,
      paragrafos: [
        `O teste grátis de ${conta.nome_estudio} termina em ${fim}. Até lá você continua enviando normalmente. ${depois}`,
        `Hoje o teste está usando ${usado} dos ${teto} a que tem direito. Ativar a assinatura mantém tudo como está e libera o espaço completo do seu plano.`,
      ],
    };
  }
  const cheio = l.espaco === "cheio";
  return {
    titulo: cheio ? "O espaço do teste acabou" : "O espaço do teste está enchendo",
    assunto: cheio
      ? `O espaço do teste na ${marca.nome} acabou`
      : `O espaço do teste na ${marca.nome} está quase no limite`,
    paragrafos: [
      cheio
        ? `O teste de ${conta.nome_estudio} chegou aos ${teto}, o espaço que ele tem. Novos envios são recusados até a assinatura ser ativada.`
        : `O teste de ${conta.nome_estudio} está com ${usado} dos ${teto} que ele tem. Quando encher, novos envios são recusados até a assinatura ser ativada.`,
      `O teste termina em ${fim}. Ativar a assinatura libera o espaço completo do seu plano — o que já foi enviado continua onde está.`,
    ],
  };
}

export async function enviarLembreteDoTeste(
  tipo: TipoDeLembrete,
  conta: { email: string; nome_estudio: string },
  l: LembreteDoTeste,
): Promise<boolean> {
  const t = textoDoLembrete(tipo, conta, l);
  const link = `https://${marca.dominio}/painel/conta`;
  const corpo =
    t.paragrafos
      .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#a4adbd">${escapar(p)}</p>`)
      .join("") +
    `<p style="margin:8px 0 0">
      <a href="${link}" style="display:inline-block;background:#d9a441;color:#07080b;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px">
        Ativar a assinatura
      </a>
    </p>`;
  return enviarEmail({
    para: conta.email,
    assunto: t.assunto,
    html: moldura(t.titulo, corpo),
    texto: [...t.paragrafos.flatMap((p) => [p, ""]), link].join("\n"),
  });
}

interface Candidata {
  id: string;
  email: string;
  nome_estudio: string;
  status: string;
  trial_ate: Date;
  quota_bytes: string;
  aviso_teste_tempo_em: Date | null;
  aviso_teste_espaco_em: Date | null;
}

export interface ResumoDosLembretes {
  ligada: boolean;
  tempo: number;
  espaco: number;
  falhasDeEnvio: number;
  linhas: string[];
}

/**
 * Uma rodada. Sem `aplicar`, só descreve. `agora` e `apenas` existem para o
 * teste (um banco compartilhado não pode mandar e-mail de estúdio alheio).
 */
export async function rodarLembretesDoTeste(opcoes: {
  aplicar: boolean;
  agora?: Date;
  forcarLigada?: boolean;
  apenas?: string[];
}): Promise<ResumoDosLembretes> {
  const resumo: ResumoDosLembretes = {
    ligada: opcoes.forcarLigada ?? lembretesLigados(),
    tempo: 0,
    espaco: 0,
    falhasDeEnvio: 0,
    linhas: [],
  };
  if (!resumo.ligada) return resumo;

  const agora = opcoes.agora ?? new Date();
  /* Só teste em andamento e sem assinatura. Teste vencido tem a rotina própria
     (`testes-abandonados.ts`); aqui o assunto é avisar ANTES. */
  const contas = await consultar<Candidata>(
    `select id, email, nome_estudio, status, trial_ate, quota_bytes::text as quota_bytes,
            aviso_teste_tempo_em, aviso_teste_espaco_em
       from tenants
      where status = 'trial' and asaas_assinatura_id is null
        and trial_ate > $1::timestamptz
        and ($2::uuid[] is null or id = any($2::uuid[]))`,
    [agora, opcoes.apenas ?? null],
  );

  for (const c of contas) {
    const { noAr } = await usoDoEstudio(c.id);
    const l = lembreteDoTeste(c, noAr, true, agora);
    if (!l) continue;

    const fim = new Date(c.trial_ate).getTime();
    /* O aviso de um teste ANTERIOR não vale: se o admin estendeu o prazo, o
       aviso velho fica mais de 5 dias antes do novo fim. */
    const tempoJaAvisado =
      c.aviso_teste_tempo_em !== null &&
      new Date(c.aviso_teste_tempo_em).getTime() > fim - (DIAS_PARA_AVISAR_TEMPO + 2) * 24 * 60 * 60 * 1000;

    const devidos: TipoDeLembrete[] = [];
    if (l.tempo === "acabando" && !tempoJaAvisado) devidos.push("tempo");
    if (l.espaco !== "folgado" && c.aviso_teste_espaco_em === null) devidos.push("espaco");

    for (const tipo of devidos) {
      resumo.linhas.push(`${tipo === "tempo" ? "tempo" : "espaço"}: ${c.nome_estudio} <${c.email}>`);
      if (!opcoes.aplicar) {
        resumo[tipo]++;
        continue;
      }
      if (!(await enviarLembreteDoTeste(tipo, c, l))) {
        resumo.falhasDeEnvio++;
        continue;
      }
      await consultar(
        tipo === "tempo"
          ? "update tenants set aviso_teste_tempo_em = $2 where id = $1"
          : "update tenants set aviso_teste_espaco_em = $2 where id = $1",
        [c.id, agora],
      );
      await registrarEvento({
        tenantId: c.id,
        estudio: c.nome_estudio,
        ator: "sistema",
        acao: ACOES.AVISO_TESTE_ENVIADO,
        alvoTipo: "conta",
        alvoId: c.id,
        detalhe: { tipo, para_hash: hashDeEmail(c.email) },
      });
      resumo[tipo]++;
    }
  }
  return resumo;
}
