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
 * ── ABERTO A TODAS AS CONTAS (07/10/2026) ───────────────────────────────
 *
 * Felipe: "Libere as pastas e stream para todos". `FORMATOS_ABERTOS_A_TODOS`
 * liga o formato para toda conta, sem carimbo e sem admin. A regra por conta
 * (carimbo OU admin) e o botão da ficha ficam guardados: fechar de novo é
 * trocar a chave por `false` — nenhuma migração, e quem foi liberado antes
 * volta a ver sem apertar nada.
 *
 * Abrir o painel não abre a comunicação: o §6 da estratégia de marca segue
 * valendo para home e vendas (vídeo e filmmaker só entram depois de entrega
 * real). Ver docs/formatos-de-entrega.md.
 */
export const FORMATOS_ABERTOS_A_TODOS = true;

export function formatosLiberados(
  conta: {
    formatos_liberados_em?: Date | string | null;
    email?: string | null;
  },
  /** Só os testes passam isto: a regra por conta, com a chave fechada. */
  aberto: boolean = FORMATOS_ABERTOS_A_TODOS,
): boolean {
  return aberto || Boolean(conta.formatos_liberados_em) || ehAdmin(conta.email);
}
