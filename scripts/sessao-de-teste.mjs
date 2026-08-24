/**
 * Forja um cookie de sessão para os testes.
 *
 * POR QUE ISTO EXISTE NUM ARQUIVO SÓ: o formato do cookie estava copiado em
 * oito suítes. Quando a sessão passou a carregar a data de emissão (para poder
 * ser revogada na troca de senha), as oito quebraram de uma vez — e cada uma
 * teria que ser consertada na mão, com a mesma chance de oito divergências.
 *
 * Regra que vale para o projeto inteiro: formato compartilhado mora num módulo,
 * não em cópias. Vale para a regra de órfãos (varrer-orfaos-regras.mjs) e vale
 * para isto.
 */
import { createHmac } from "node:crypto";

const NOME = "fotonio_sessao";
/** Precisa acompanhar DURACAO_DIAS de src/lib/auth.ts. */
const DURACAO_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Devolve o cabeçalho `cookie` pronto.
 *
 * @param tenantId    dono da sessão
 * @param opcoes.emitidoEm  quando o cookie nasceu (padrão: agora). Um valor no
 *                          passado serve para testar revogação por troca de senha.
 * @param opcoes.expiraEm   vencimento (padrão: emissão + 30 dias)
 */
export function cookieDeSessao(tenantId, opcoes = {}) {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error("SESSION_SECRET ausente — o cookie não pode ser assinado");

  const emitidoEm = opcoes.emitidoEm ?? Date.now();
  const expiraEm = opcoes.expiraEm ?? emitidoEm + DURACAO_MS;

  const dados = `${tenantId}.${emitidoEm}.${expiraEm}`;
  const assinatura = createHmac("sha256", segredo).update(dados).digest("hex");
  return `${NOME}=${dados}.${assinatura}`;
}
