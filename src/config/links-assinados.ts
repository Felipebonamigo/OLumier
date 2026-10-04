/**
 * QUANTO VALE O LINK DE UMA FOTO NA GALERIA DO CLIENTE.
 *
 * Toda foto da galeria pública chega por um link assinado que vence sozinho —
 * "link que vaza para de funcionar" é o que a página de segurança e a home
 * prometem. Eram dois `6 * 3600` escritos à mão (a página da galeria e a rota
 * que entrega os endereços sob demanda); desde 03/10/2026 a home também mostra
 * esse prazo (o relógio do bloco de recursos), então ele mora num lugar só.
 *
 * Em segundos.
 */
export const VALIDADE_DO_LINK_DA_GALERIA = 6 * 3600;
