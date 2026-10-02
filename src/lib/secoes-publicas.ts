import "server-only";
import { consultarUm } from "./db";

/**
 * O NOME de um capítulo, a partir do endereço público da galeria.
 *
 * Existe para o título da aba do navegador (`[capitulo]/page.tsx`): a pessoa
 * está vendo a Recepção e vai para a Festa, e a aba precisa dizer isso.
 *
 * ── POR QUE NÃO REUSAR `secaoPeloApelido` ─────────────────────────────────
 *
 * Aquela recebe o ID da galeria e vive em `lib/secoes.ts`, ao lado das escritas
 * do painel. Aqui não há id: há dois pedaços de URL que qualquer pessoa da
 * internet escreve. Resolver o estúdio e a galeria ANTES, na mesma consulta, é
 * o que impede o apelido de um capítulo valer na galeria de outro estúdio.
 *
 * Devolve o NOME, não o apelido: "recem-casados" é endereço, e a aba é texto de
 * tela. Nulo quando não existe — e aí a aba continua sendo a da galeria, em vez
 * de repetir o que veio de fora.
 *
 * Não confere senha nem publicação de propósito: o nome do capítulo não é
 * conteúdo protegido, e a página já decide o que mostrar. Fazer a trava aqui
 * seria uma segunda régua de acesso para manter igual à primeira.
 */
export async function secaoPeloApelidoPublica(
  estudioSlug: string,
  galeriaSlug: string,
  apelido: string,
): Promise<string | null> {
  if (!apelido || apelido === "sem-capitulo") return null;
  const achada = await consultarUm<{ nome: string }>(
    `select s.nome
       from secoes s
       join galerias g on g.id = s.galeria_id
       join tenants  t on t.id = g.tenant_id
      where t.slug = $1 and g.slug = $2 and s.slug = $3
      limit 1`,
    [estudioSlug, galeriaSlug, apelido],
  );
  return achada?.nome ?? null;
}
