import "server-only";
import { consultarUm } from "@/lib/db";
import { ACOES, registrarEvento, type Acao } from "@/lib/eventos";
import { hashDeEmail } from "@/lib/ip";
import { plataformaPorId, type Plataforma } from "@/config/plataformas-de-origem";

/**
 * Libera ou bloqueia o "Entrar com a conta de <plataforma>" de UM estúdio.
 *
 * Quem chama é a ação do admin (ficha do estúdio), que já conferiu o portão.
 * Aqui mora só a escrita e o registro, para a regra não depender da tela.
 *
 * O `update` só pega a linha quando o estado MUDA — liberar o que já está
 * liberado não mexe no carimbo (a data continua sendo a da primeira vez) e não
 * gera evento repetido na auditoria. Dois cliques no mesmo botão, com a página
 * atrasada, são o caso real.
 *
 * A coluna entra no SQL por interpolação, e é seguro só porque ela vem da lista
 * fechada de `config/plataformas-de-origem.ts`, nunca do que chegou de fora:
 * plataforma desconhecida volta como "nao-existe" antes de qualquer consulta.
 */

const EVENTOS: Record<Plataforma, { liberado: Acao; bloqueado: Acao }> = {
  pixieset: { liberado: ACOES.PIXIESET_LIBERADO, bloqueado: ACOES.PIXIESET_BLOQUEADO },
  pixellu: { liberado: ACOES.PIXELLU_LIBERADO, bloqueado: ACOES.PIXELLU_BLOQUEADO },
};

export async function definirLoginLiberado(
  estudioId: string,
  plataforma: Plataforma,
  liberar: boolean,
  admin: { id: string; email: string },
): Promise<"liberado" | "bloqueado" | "sem-mudanca" | "nao-existe"> {
  const p = plataformaPorId(plataforma);
  if (!p) return "nao-existe";

  const mudou = await consultarUm<{ nome_estudio: string }>(
    `update tenants
        set ${p.coluna} = case when $2 then now() else null end
      where id = $1 and (${p.coluna} is null) = $2
      returning nome_estudio`,
    [estudioId, liberar],
  );

  if (!mudou) {
    const existe = await consultarUm("select 1 from tenants where id = $1", [estudioId]);
    return existe ? "sem-mudanca" : "nao-existe";
  }

  /* O evento fica na conta do ESTÚDIO — é na ficha dele que a pergunta "quem
     liberou?" aparece. Ator "sistema" porque não foi o estúdio quem mudou a
     própria conta. */
  await registrarEvento({
    tenantId: estudioId,
    estudio: mudou.nome_estudio,
    ator: "sistema",
    acao: liberar ? EVENTOS[p.id].liberado : EVENTOS[p.id].bloqueado,
    alvoTipo: "conta",
    alvoId: estudioId,
    /* O e-mail do admin vai em hash: o registro não se apaga, e o
       `adminId` já diz quem foi (ver `hashDeEmail`). */
    detalhe: { plataforma: p.id, por_hash: hashDeEmail(admin.email), adminId: admin.id },
  });

  return liberar ? "liberado" : "bloqueado";
}
