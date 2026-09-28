import { NextResponse, after, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { consultar, consultarUm } from "@/lib/db";
import { eventoEhNosso, tenantDaReferencia } from "@/lib/asaas";
import { efeitoDoEvento, fimDoPeriodoPago } from "@/lib/assinatura";
import { PREFIXO_ATOMATIZA } from "@/config/combo";
import { recalcularCombo, recalcularComboDoCliente } from "@/lib/combo";

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
 *
 * 4. O evento do Atomatiza não é só ruído: é o gatilho do COMBO. Quem assina os
 *    dois paga menos pela Galeria enquanto o Atomatiza estiver vivo e em dia,
 *    e é aqui que ficamos sabendo que ele nasceu, foi pago, atrasou ou acabou.
 *    A conferência vai para depois da resposta (`after`): ela fala com o Asaas
 *    algumas vezes, e a fila é SEQUENCIAL — segurar a resposta atrasaria todos
 *    os avisos da conta, os de lá inclusive. Se ela falhar, o evento já foi
 *    confirmado e o preço fica como estava até a próxima conferência; nunca
 *    devolvemos erro ao Asaas por causa do combo. Ver `src/lib/combo.ts`.
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
    payment?: { externalReference?: string; value?: number; id?: string; customer?: string };
    subscription?: { externalReference?: string; id?: string; customer?: string };
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
    // Do Atomatiza, o evento ainda serve para conferir o combo de quem tem o
    // mesmo CPF/CNPJ aqui — depois da resposta, e sem nunca virar erro.
    const cliente = corpo.payment?.customer ?? corpo.subscription?.customer;
    if (referencia?.startsWith(PREFIXO_ATOMATIZA) && cliente) {
      after(() =>
        recalcularComboDoCliente(cliente, evento).catch((erro) =>
          console.error(`[combo] ${evento} do Atomatiza (cliente ${cliente}):`, erro),
        ),
      );
    }
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
    // Cada pagamento nosso também confere o combo. É a rede de segurança: se um
    // aviso do Atomatiza se perdeu, o preço se acerta a cada ciclo.
    after(() =>
      recalcularCombo(tenantId, evento).catch((erro) =>
        console.error(`[combo] ${evento} do estúdio ${tenantId}:`, erro),
      ),
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
