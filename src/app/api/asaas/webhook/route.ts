import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { consultar, consultarUm } from "@/lib/db";
import { eventoEhNosso, tenantDaReferencia } from "@/lib/asaas";
import { efeitoDoEvento, fimDoPeriodoPago } from "@/lib/assinatura";

/**
 * Webhook do Asaas: é assim que sabemos que o cliente pagou (ou deixou de pagar).
 *
 * Três cuidados que não são opcionais aqui:
 *
 * 1. A conta do Asaas é COMPARTILHADA com o Atomatiza. Todo evento chega nos dois
 *    webhooks, então filtramos por `externalReference` — evento sem o prefixo
 *    "olumier:" é respondido com 200 e ignorado. Sem esse filtro, um pagamento
 *    do Atomatiza tentaria ativar uma assinatura que não existe aqui.
 *
 * 2. Responder 200 mesmo ao ignorar é proposital: erro faz o Asaas reenviar o
 *    evento em looping e, depois de muitas falhas, ele SUSPENDE a fila da conta
 *    inteira — o que derrubaria a cobrança do Atomatiza junto.
 *
 * 3. Cancelar e ESTORNAR não são a mesma coisa, embora os dois terminem a
 *    assinatura. No cancelamento o dinheiro ficou conosco e o período pago
 *    continua devido; no estorno ele voltou, e o período é zerado. Os quatro
 *    eventos moravam no mesmo conjunto até 26/08/2026. Ver `efeitoDoEvento`.
 */

export async function POST(request: NextRequest) {
  // O Asaas manda um token fixo que você define no painel dele.
  //
  // Antes isto era `if (esperado && token !== esperado)`: com a variável vazia a
  // condição era falsa e a rota processava QUALQUER POST da internet. Como só é
  // preciso saber o uuid do tenant, dava para marcar qualquer estúdio como ativo
  // ou inadimplente de fora. Sem token configurado, agora a porta fica fechada —
  // é o mesmo que o webhook do Atomatiza já faz.
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!esperado) {
    return NextResponse.json(
      { erro: "webhook sem token configurado" },
      { status: 503 },
    );
  }

  const token = request.headers.get("asaas-access-token") ?? "";
  // timingSafeEqual em vez de !==: a comparação de string sai no primeiro byte
  // diferente, e esse tempo entrega o token caractere a caractere.
  const a = Buffer.from(token);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  let corpo: {
    event?: string;
    payment?: { externalReference?: string; value?: number; id?: string };
    subscription?: { externalReference?: string; id?: string };
  };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: true, ignorado: "corpo inválido" });
  }

  const evento = corpo.event ?? "";
  const referencia = corpo.payment?.externalReference ?? corpo.subscription?.externalReference;

  // Não é nosso (provavelmente do Atomatiza): confirma o recebimento e sai.
  if (!eventoEhNosso(referencia)) {
    return NextResponse.json({ ok: true, ignorado: "outro produto" });
  }

  const tenantId = tenantDaReferencia(referencia!);
  // O ciclo vem junto porque é ele que diz quanto tempo um pagamento compra.
  const tenant = await consultarUm<{ id: string; ciclo_cobranca: string }>(
    "select id, ciclo_cobranca from tenants where id = $1",
    [tenantId],
  );
  if (!tenant) {
    // Referência nossa mas estúdio inexistente: registra e não quebra.
    console.warn(`[asaas] evento ${evento} para estúdio desconhecido ${tenantId}`);
    return NextResponse.json({ ok: true, ignorado: "estúdio não encontrado" });
  }

  const efeito = efeitoDoEvento(evento);

  if (efeito === "pagou") {
    /*
     * O período pago é contado a PARTIR DE AGORA, não somado ao que já havia.
     *
     * O Asaas manda PAYMENT_CONFIRMED e PAYMENT_RECEIVED para a mesma cobrança.
     * Somar daria dois meses por um pagamento — e o erro só apareceria meses
     * depois, num estúdio com acesso que ninguém pagou. Contar de agora torna o
     * evento repetido inofensivo: o segundo reescreve o mesmo valor.
     *
     * O PREÇO tem desconto anual, o PERÍODO não: doze meses de disco por dez
     * meses de fatura. Ver `fimDoPeriodoPago`.
     */
    await consultar(
      `update tenants
          set status = 'ativo', trial_ate = null,
              ultimo_pagamento_em = now(), pago_ate = $2, atualizado_em = now()
        where id = $1`,
      [tenantId, fimDoPeriodoPago(tenant.ciclo_cobranca, new Date())],
    );
  } else if (efeito === "atrasou") {
    /*
     * Inadimplente NÃO derruba as galerias no ato: o cliente final do fotógrafo
     * não tem culpa de um boleto atrasado, e tirar as fotos do ar no primeiro
     * vencimento seria desproporcional. O estado muda, o painel avisa, e a
     * decisão de bloquear fica para uma régua de cobrança depois.
     */
    await consultar(
      `update tenants set status = 'inadimplente', atualizado_em = now() where id = $1`,
      [tenantId],
    );
  } else if (efeito === "cancelou") {
    // `pago_ate` fica de pé: o dinheiro do período corrente continua conosco, e
    // o serviço dele é devido. Ver db/migracoes/021-periodo-pago.sql.
    await consultar(
      `update tenants set status = 'cancelado', atualizado_em = now() where id = $1`,
      [tenantId],
    );
  } else if (efeito === "estornou") {
    // Aqui o dinheiro VOLTOU. Manter o período seria deixar o disco correndo
    // por nossa conta para quem pediu reembolso ou abriu chargeback.
    await consultar(
      `update tenants set status = 'cancelado', pago_ate = null, atualizado_em = now()
        where id = $1`,
      [tenantId],
    );
  }

  console.log(`[asaas] ${evento} → estúdio ${tenantId}`);
  return NextResponse.json({ ok: true });
}
