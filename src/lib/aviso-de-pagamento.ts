import "server-only";
import { administradores } from "@/config/admin";
import { enviarEmail, moldura } from "@/lib/email";
import { diagnosticarCombo, type DiagnosticoDoCombo } from "@/lib/combo";

/**
 * O E-MAIL "FULANO PAGOU" PARA QUEM TOCA A PLATAFORMA.
 *
 * Felipe, 30/09/2026: "a Bia Zac fez o pagamento há pouco da Galeria [...] eu
 * também não recebi nenhum e-mail (igual do Atomatiza) que foi pago". O
 * Atomatiza avisa venda e renovação pelo vigia; aqui o pagamento chegava em
 * silêncio, e a primeira notícia de um cliente novo era abrir o admin.
 *
 * Vai para a lista `ADMINS`, uma vez por cobrança CONTADA — o webhook só chega
 * aqui depois de passar pela guarda de cobrança repetida, então o mesmo
 * pagamento avisado duas vezes pelo Asaas (CONFIRMED e RECEIVED) não vira dois
 * e-mails.
 *
 * E diz o COMBO. "Temos que garantir o desconto por usar as duas plataformas":
 * o e-mail responde na hora se o desconto valeu e, quando não valeu, por quê —
 * com o mesmo diagnóstico de `scripts/conferir-combo.mjs`. Roda DEPOIS da
 * conferência do combo, então o valor que ele mostra já é o acertado.
 *
 * Nunca atrapalha o pagamento: roda depois da resposta ao Asaas, e qualquer
 * falha aqui é só log.
 */

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const escapar = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const NOME_DA_FAIXA = { solo: "Solo", equipe: "Equipe", estudio: "Estúdio" } as const;

/** A linha do combo, em texto: o que o Felipe precisa saber de relance. */
export function linhaDoCombo(d: DiagnosticoDoCombo): string {
  if (d.faixa) {
    return `Sim — Atomatiza ${NOME_DA_FAIXA[d.faixa]}. A Galeria cede ${reais(d.descontoMensalCentavos)} por mês; a outra metade do desconto sai na assinatura do Atomatiza.`;
  }
  return `Não — ${d.motivo ?? "sem motivo identificado"}.`;
}

/** O valor da assinatura bate com o que deveria cobrar? */
export function linhaDoValor(d: DiagnosticoDoCombo): string {
  if (d.valorAtualCentavos === null) return "Sem assinatura ativa no Asaas.";
  const ciclo = d.ciclo === "anual" ? "ano" : "mês";
  if (d.valorAtualCentavos === d.valorCertoCentavos) return `A assinatura cobra ${reais(d.valorAtualCentavos)} por ${ciclo}, o valor certo.`;
  return `ATENÇÃO: a assinatura cobra ${reais(d.valorAtualCentavos)} por ${ciclo}, e o certo seria ${reais(d.valorCertoCentavos)}. Valor mudado à mão no Asaas? Confira com scripts/conferir-combo.mjs.`;
}

export async function avisarPagamento(
  tenantId: string,
  pagamento: { valor: number | null; evento: string; primeiro: boolean },
): Promise<void> {
  const para = administradores();
  if (para.length === 0) return;

  const d = await diagnosticarCombo(tenantId);
  if (!d) return;

  const oque = pagamento.primeiro ? "pagou pela primeira vez" : "renovou";
  const valor = pagamento.valor !== null ? reais(Math.round(pagamento.valor * 100)) : "valor não informado";
  const assunto = `${d.estudio} ${oque} a Galeria Átomo — ${valor}${d.faixa ? " · combo" : ""}`;

  const linhas: [string, string][] = [
    ["Estúdio", d.estudio],
    ["E-mail", d.email],
    ["Plano", `${d.planoId} · ${d.ciclo}`],
    ["Pagamento", `${valor} (${pagamento.evento})`],
    ["Combo com o Atomatiza", linhaDoCombo(d)],
    ["Assinatura", linhaDoValor(d)],
  ];

  const texto = linhas.map(([k, v]) => `${k}: ${v}`).join("\n");
  const html = moldura(
    escapar(`${d.estudio} ${oque}`),
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#eef1f6">${linhas
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 12px 6px 0;color:#a4adbd;vertical-align:top;white-space:nowrap">${escapar(k)}</td><td style="padding:6px 0">${escapar(v)}</td></tr>`,
      )
      .join("")}</table>`,
  );

  for (const email of para) {
    await enviarEmail({ para: email, assunto, html, texto });
  }
}
