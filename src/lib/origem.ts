import "server-only";
import { headers } from "next/headers";

/**
 * De qual endereço veio a requisição.
 *
 * O app roda atrás do Caddy, então `x-forwarded-for` é o único lugar onde o IP
 * de verdade aparece — o socket enxerga só o proxy local. Quando há mais de um
 * salto o cabeçalho vira uma lista, e o primeiro item é o cliente.
 *
 * A lógica estava repetida em três arquivos (login, acesso à galeria, página
 * pública) com pequenas diferenças entre si; agora mora aqui. Devolve `null` em
 * vez de lançar porque nada que chama isto pode falhar por causa de um
 * cabeçalho ausente: registrar de onde veio é secundário à ação em si.
 */
export async function ipDaRequisicao(): Promise<string | null> {
  try {
    const cab = await headers();
    const encaminhado = cab.get("x-forwarded-for")?.split(",")[0]?.trim();
    return encaminhado || cab.get("x-real-ip") || null;
  } catch {
    return null;
  }
}
