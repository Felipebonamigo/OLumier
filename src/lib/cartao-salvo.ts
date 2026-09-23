/**
 * O cartão que o Asaas guardou para cobrar sozinho — e como a tela o nomeia.
 *
 * Quando a assinatura é de cartão, o número é digitado UMA vez, na página do
 * Asaas, e fica salvo lá. O sistema nunca vê o cartão: o que volta na consulta
 * da assinatura são a bandeira e os quatro últimos dígitos, que é exatamente o
 * bastante para a pessoa reconhecer qual cartão está sendo cobrado.
 *
 * ── A REGRA DE SILÊNCIO ───────────────────────────────────────────────────
 *
 * Consulta que falhou, assinatura sem cartão e cartão sem os quatro dígitos
 * viram TODOS `null`. A tela só promete "cobrança automática" quando consegue
 * mostrar EM QUAL cartão, e os dois erros possíveis são caros de jeitos
 * diferentes:
 *
 *   prometer sem mostrar  deixa a pessoa sem como conferir se o cartão certo
 *                         está lá, e sem saber o que fazer se não estiver;
 *   prometer por engano   faz quem paga por Pix PARAR de pagar, achando que já
 *                         está resolvido — e a conta cai em inadimplência por
 *                         causa de uma frase na tela.
 *
 * O segundo é o que não dá para desfazer, então `null` é o padrão.
 *
 * Sem componente e sem React de propósito: é regra, e regra se testa sem
 * navegador. Ver `scripts/testar-assinatura-recorrente.mjs`.
 */

/**
 * Só o pedaço da resposta do Asaas que interessa aqui.
 *
 * Deliberadamente frouxo: quem chama passa a assinatura inteira, e ela tem
 * muito mais campos — exigir o tipo cheio obrigaria a inventar um espelho da
 * API para chamar uma função de rótulo.
 */
export type ComCartao =
  | {
      creditCard?: {
        creditCardNumber?: string | null;
        creditCardBrand?: string | null;
      } | null;
    }
  | null
  | undefined;

/** "VISA •••• 4444", ou `null` quando não há cartão salvo que dê para mostrar. */
export function rotuloDoCartao(assinatura: ComCartao): string | null {
  const cartao = assinatura?.creditCard;
  const fim = cartao?.creditCardNumber?.trim();
  if (!fim) return null;
  /* Bandeira ausente cai em "Cartão", e não em "undefined •••• 4444" na cara da
     pessoa. O que importa é ela reconhecer os quatro dígitos. */
  const bandeira = cartao?.creditCardBrand?.trim();
  return `${bandeira || "Cartão"} •••• ${fim}`;
}
