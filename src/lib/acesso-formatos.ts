import "server-only";
import { consultarUm } from "@/lib/db";
import { ACOES, registrarEvento } from "@/lib/eventos";
import { hashDeEmail } from "@/lib/ip";
import { formatosLiberados } from "@/config/formatos-liberados";
import type { Aparencia } from "@/config/aparencia";

/** A conta pode usar Pastas e Stream? Ver `config/formatos-liberados.ts`. */
export async function formatosLiberadosPara(tenantId: string): Promise<boolean> {
  const conta = await consultarUm<{ email: string | null; formatos_liberados_em: Date | null }>(
    "select email, formatos_liberados_em from tenants where id = $1",
    [tenantId],
  );
  return conta ? formatosLiberados(conta) : false;
}

/**
 * A aparência como a conta pode usá-la: sem liberação, o formato volta a
 * ser a galeria. Só consulta o banco quando há o que conferir — a galeria de
 * sempre, que é quase toda galeria, não paga nada.
 */
export async function aparenciaPermitida(aparencia: Aparencia, tenantId: string): Promise<Aparencia> {
  if (aparencia.formato === "galeria") return aparencia;
  return (await formatosLiberadosPara(tenantId)) ? aparencia : { ...aparencia, formato: "galeria" };
}

/**
 * Libera ou bloqueia Pastas e Stream para UM estúdio — o botão da ficha no
 * Admin. Mesma forma de `definirLoginLiberado` (lib/acesso-plataforma.ts): só escreve quando o estado
 * muda, e registra quem apertou na auditoria do estúdio.
 */
export async function definirFormatosLiberados(
  estudioId: string,
  liberar: boolean,
  admin: { id: string; email: string },
): Promise<"liberado" | "bloqueado" | "sem-mudanca" | "nao-existe"> {
  const mudou = await consultarUm<{ nome_estudio: string }>(
    `update tenants
        set formatos_liberados_em = case when $2 then now() else null end
      where id = $1 and (formatos_liberados_em is null) = $2
      returning nome_estudio`,
    [estudioId, liberar],
  );

  if (!mudou) {
    const existe = await consultarUm("select 1 from tenants where id = $1", [estudioId]);
    return existe ? "sem-mudanca" : "nao-existe";
  }

  await registrarEvento({
    tenantId: estudioId,
    estudio: mudou.nome_estudio,
    ator: "sistema",
    acao: liberar ? ACOES.FORMATOS_LIBERADOS : ACOES.FORMATOS_BLOQUEADOS,
    alvoTipo: "conta",
    alvoId: estudioId,
    detalhe: { por_hash: hashDeEmail(admin.email), adminId: admin.id },
  });

  return liberar ? "liberado" : "bloqueado";
}
