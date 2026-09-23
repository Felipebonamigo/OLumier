/**
 * O cabeçalho `Range`, lido como o navegador o manda ao RETOMAR um download
 * que caiu: `bytes=<de onde parou>-`. Puro, para o teste prender os cantos.
 */
/** `bytes=a-b` → [a, b] dentro de `tamanho`, ou null quando não é um Range válido. */
export function intervaloDoRange(cabecalho: string | undefined, tamanho: number): [number, number] | null {
  if (!cabecalho) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecalho.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    /* Os últimos N bytes. */
    const n = Math.min(Number(b), tamanho);
    return n > 0 ? [tamanho - n, tamanho - 1] : null;
  }
  const inicio = Number(a);
  const fim = b === "" ? tamanho - 1 : Math.min(Number(b), tamanho - 1);
  if (inicio > fim || inicio >= tamanho) return null;
  return [inicio, fim];
}
