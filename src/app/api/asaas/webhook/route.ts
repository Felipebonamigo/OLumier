import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { consultar, consultarUm } from "@/lib/db";
import { eventoEhNosso, tenantDaReferencia } from "@/lib/asaas";

/**
 * Webhook do Asaas: é assim que sabemos que o cliente pagou (ou deixou de pagar).
 *
 * Dois cuidados que não são opcionais aqui:
 *
 * 1. A conta do Asaas é COMPARTILHADA com o Atomatiza. Todo evento chega nos dois
 *    webhooks, então filtramos por `externalReference` — evento sem o prefixo
 *    "fotonio:" é respondido com 200 e ignorado. Sem esse filtro, um pagamento
 *    do Atomatiza tentaria ativar uma assinatura que não existe aqui.
 *
 * 2. Responder 200 mesmo ao ignorar é proposital: erro faz o Asaas reenviar o
 *    evento em looping e, depois de muitas falhas, ele SUSPENDE a fila da conta
 *    inteira — o que derrubaria a cobrança do Atomatiza junto.
 */

const PAGOU = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);
const FALHOU = new Set(["PAYMENT_OVERDUE"]);
const ACABOU = new Set([
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "SUBSCRIPTION_DELETED",
]);

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
  const tenant = await consultarUm<{ id: string }>("select id from tenants where id = $1", [
    tenantId,
  ]);
  if (!tenant) {
    // Referência nossa mas estúdio inexistente: registra e não quebra.
    console.warn(`[asaas] evento ${evento} para estúdio desconhecido ${tenantId}`);
    return NextResponse.json({ ok: true, ignorado: "estúdio não encontrado" });
  }

  if (PAGOU.has(evento)) {
    await consultar(
      `update tenants set status = 'ativo', trial_ate = null, atualizado_em = now()
        where id = $1`,
      [tenantId],
    );
  } else if (FALHOU.has(evento)) {
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
  } else if (ACABOU.has(evento)) {
    await consultar(
      `update tenants set status = 'cancelado', atualizado_em = now() where id = $1`,
      [tenantId],
    );
  }

  console.log(`[asaas] ${evento} → estúdio ${tenantId}`);
  return NextResponse.json({ ok: true });
}
