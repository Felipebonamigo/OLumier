/**
 * Por qual critério reordenar as fotos de um capítulo.
 *
 * Felipe, 16/09/2026: "poder organizar por ordem de upload/adição // por ordem
 * cronológica // por nome A-Z // por nome Z-A".
 *
 * ── POR QUE ESTA LISTA MORA EM `config/` E NÃO EM `lib/secoes.ts` ─────────
 *
 * Porque quem a desenha é a tela, e `lib/secoes.ts` é `server-only` — importá-lo
 * de um componente de cliente estoura na compilação. A REGRA (o que cada
 * critério faz com as linhas) continua lá, onde tem banco; o que vem para cá é
 * só o cardápio, que os dois lados precisam conhecer pelo mesmo nome.
 *
 * ── OS RÓTULOS FALAM DA FOTO, NÃO DO CAMPO ───────────────────────────────
 *
 * "Data da foto" e não "EXIF DateTimeOriginal"; "Ordem de envio" e não
 * `criado_em`. Quem lê é fotógrafo escolhendo como a entrega vai aparecer.
 */
export type OrdemDasFotos = "envio" | "cronologica" | "nome" | "nome-invertido" | "mais-baixadas";

export const ORDENS_DAS_FOTOS: { id: OrdemDasFotos; nome: string }[] = [
  { id: "envio", nome: "Ordem de envio" },
  { id: "cronologica", nome: "Data da foto" },
  { id: "nome", nome: "Nome A → Z" },
  { id: "nome-invertido", nome: "Nome Z → A" },
  /*
   * Felipe, 23/09/2026, junto do pedido de saber quem baixou: "e o numero de
   * downloads de cada foto, fazer tambem uma ordenação por mais baixadas".
   *
   * É a única ordem daqui que não vem do ARQUIVO: as outras quatro olham nome,
   * data ou posição, e esta olha o que o casal fez. Numa galeria recém-entregue
   * ela não tem o que ordenar — e é assim mesmo, ninguém baixou nada ainda.
   */
  { id: "mais-baixadas", nome: "Mais baixadas" },
];
