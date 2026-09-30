import { ehAdmin } from "./admin";

/**
 * QUEM VÊ PASTAS E STREAM (30/09/2026).
 *
 * Felipe, ao publicar os estilos: "isso só ficará visível para sócios
 * primeiramente (eu, Carol, Sirius)". Os formatos estão construídos e testados
 * na bancada, mas a estratégia de marca (§6) pede entrega real antes de
 * abrir — e quem valida são os três, com as próprias entregas.
 *
 * Liberado quando o admin apertou o botão na ficha do estúdio
 * (`tenants.formatos_liberados_em`, migração 054) OU quando a conta é de
 * admin (`ADMINS`) — quem aperta o botão não precisa apertá-lo para si.
 *
 * Sem liberação a conta não vê o grupo Formato no Design, nem a escolha na
 * criação da galeria, nem o "capa da pasta"; e a galeria pública desenha a
 * galeria de sempre mesmo que a aparência gravada diga outra coisa (o
 * formulário é um endpoint, e o que decide é o servidor).
 *
 * Abrir para todo mundo é trocar o corpo desta função por `return true`.
 */
export function formatosLiberados(conta: {
  formatos_liberados_em?: Date | string | null;
  email?: string | null;
}): boolean {
  return Boolean(conta.formatos_liberados_em) || ehAdmin(conta.email);
}
