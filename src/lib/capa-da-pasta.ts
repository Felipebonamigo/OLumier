import "server-only";
import { randomUUID } from "node:crypto";
import { consultarUm } from "./db";

/**
 * A CAPA DE UM CAPÍTULO ENVIADA COMO ARQUIVO (migração 057).
 *
 * Mesmo desenho da capa da galeria (`capa-galeria.ts`) e da logo do estúdio: o
 * arquivo vai do navegador direto para o bucket com URL assinada, o banco
 * guarda só a chave, e o link é assinado na hora de desenhar a página.
 *
 * O teto, os tipos aceitos e o texto da recusa são OS MESMOS da capa da
 * galeria, importados dali em vez de copiados: são a mesma decisão vista de
 * perto ("que imagem o fotógrafo pode subir como frente de alguma coisa"), e
 * duas listas separadas divergiriam no dia em que uma delas ganhasse WEBP.
 */
export { TIPOS_CAPA, LIMITE_CAPA, recusaDaCapa } from "./capa-galeria";

/**
 * Dentro da pasta da galeria, numa subpasta por CAPÍTULO.
 *
 * O id do capítulo no caminho não é organização: é o que deixa a conferência da
 * chave recusar a capa de um capítulo apontada para outro — ver
 * `chaveDoCapitulo`. Sem ele, "esta chave é desta galeria" seria tudo o que se
 * poderia provar.
 */
export function chaveDaCapaDaPasta(
  tenantId: string,
  galeriaId: string,
  secaoId: string,
  extensao: string,
) {
  const ext = /^[a-z0-9]{1,10}$/.test(extensao) ? extensao : "bin";
  return `${tenantId}/${galeriaId}/capa-pasta/${secaoId}/${randomUUID()}.${ext}`;
}

/**
 * A chave pertence à capa DESTE capítulo desta galeria deste estúdio?
 *
 * A chave chega do navegador na hora de confirmar. Sem esta conferência, um
 * pedido forjado apontaria a capa de um capítulo para um objeto de outra conta
 * — ou para a foto de um cliente alheio.
 */
export function chaveDoCapitulo(
  chave: string,
  tenantId: string,
  galeriaId: string,
  secaoId: string,
) {
  return chave.startsWith(`${tenantId}/${galeriaId}/capa-pasta/${secaoId}/`);
}

/**
 * O capítulo, se ele é desta galeria e a galeria é deste estúdio. As três
 * condições na mesma consulta: é a autorização, e separá-las abriria a janela
 * de apontar um capítulo de outra galeria da mesma conta.
 */
export function capituloParaCapa(secaoId: string, galeriaId: string, tenantId: string) {
  return consultarUm<{ id: string; capa_chave: string | null }>(
    `select s.id, s.capa_chave
       from secoes s join galerias g on g.id = s.galeria_id
      where s.id = $1 and s.galeria_id = $2 and g.tenant_id = $3`,
    [secaoId, galeriaId, tenantId],
  );
}

/** Grava a capa nova e devolve a chave ANTERIOR, para quem chama poder apagá-la. */
export async function trocarCapaDaPasta(
  secaoId: string,
  galeriaId: string,
  tenantId: string,
  chave: string | null,
): Promise<string | null> {
  /* Lê antes de trocar: depois do update não há mais como saber qual objeto
     ficou sem dono, e objeto sem dono é arquivo pago que ninguém acha. */
  const antes = await capituloParaCapa(secaoId, galeriaId, tenantId);
  if (!antes) return null;
  /* O foco volta ao centro junto: a imagem mudou, e o enquadramento era dela.
     Vale também para TIRAR a capa (chave null) — a pasta passa a mostrar a
     primeira foto do capítulo, que é outra imagem ainda. Ver migração 067. */
  await consultarUm(
    "update secoes set capa_chave = $1, capa_foco_x = 50, capa_foco_y = 50 where id = $2",
    [chave, secaoId],
  );
  return antes.capa_chave && antes.capa_chave !== chave ? antes.capa_chave : null;
}
