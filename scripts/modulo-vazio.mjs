/**
 * Substituto de "server-only" nos testes.
 *
 * O pacote real lança ao ser importado fora de um Server Component — a proteção
 * existe para impedir que código de servidor seja empacotado no navegador. Num
 * script Node isso não se aplica: o risco que ele protege não existe aqui, e o
 * efeito prático seria só impedir testar as funções de servidor.
 */
export {};
