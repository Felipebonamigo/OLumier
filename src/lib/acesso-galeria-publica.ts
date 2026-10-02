import "server-only";
import { consultarUm } from "./db";
import { temAcessoLiberado } from "./galerias-publicas";

/**
 * A AUTORIZAÇÃO DA GALERIA PÚBLICA, num lugar só.
 *
 * Esta função é a porta de toda rota que o navegador do convidado chama: ela
 * responde "esta galeria está aberta para quem está pedindo?". Publicada, fora
 * do cofre, e a senha conferida quando houver.
 *
 * Até 02/10/2026 ela existia COPIADA em duas rotas (`/api/g/[id]/eu` e
 * `/api/g/[id]/favoritas`), e a terceira cópia estava a caminho junto com o
 * recado do cliente. É a autorização inteira da galeria pública: três cópias
 * significam que, no dia em que a regra mudar (um estado novo, um segundo jeito
 * de liberar senha), uma delas vai ficar atrás — e a que ficar atrás é uma porta
 * aberta, não um bug de tela.
 *
 * Os códigos, e por que cada um:
 *
 *   404  não existe, ou não está publicada — e a resposta é a mesma de propósito,
 *        para não confirmar a existência de um id;
 *   409  no cofre: existe, mas não serve arquivo para ninguém agora;
 *   401  tem senha e esta pessoa não passou por ela.
 *
 * A conferência de senha NÃO é opcional em rota nenhuma. Sem ela, quem só
 * descobriu o id de uma galeria trancada conseguiria marcar favoritas ou deixar
 * recado sem nunca ver uma foto — sujando a lista que o fotógrafo usa para
 * montar o álbum.
 */
export async function galeriaLiberada(id: string) {
  const galeria = await consultarUm<{ id: string; senha_hash: string | null; estado: string }>(
    "select id, senha_hash, estado from galerias where id = $1 and publicada",
    [id],
  );
  if (!galeria) return { ok: false as const, status: 404 };
  if (galeria.estado !== "online") return { ok: false as const, status: 409 };
  if (galeria.senha_hash && !(await temAcessoLiberado(id, galeria.senha_hash))) {
    return { ok: false as const, status: 401 };
  }
  return { ok: true as const, galeria };
}
