/**
 * O endereço de outra tela da MESMA galeria: outro capítulo, outra parte.
 *
 * Mexe só em `cap` e `parte`, e larga `fotos` (o recorte da busca por rosto,
 * que é de uma tela só). Todo o resto da consulta atual fica — principalmente o
 * `?previa=1` do dono. A primeira versão das partes montava "?cap=X&parte=2" do
 * zero: no rascunho a parte 2 dava 404, e na galeria publicada o fotógrafo
 * conferindo a própria prévia virava um "abriu" na Atividade do casal
 * (revisão de 16/09/2026). As pastilhas de capítulo tinham o mesmo defeito.
 *
 * Parte 1 não leva número: é a tela que o capítulo abre sozinho.
 */
export function enderecoNaGaleria(
  buscaAtual: string,
  mudar: { cap?: string | null; parte?: number },
): string {
  const p = new URLSearchParams(buscaAtual.replace(/^\?/, ""));
  p.delete("fotos");
  p.delete("cap");
  p.delete("parte");
  if (mudar.cap) p.set("cap", mudar.cap);
  if (mudar.parte && mudar.parte > 1) p.set("parte", String(mudar.parte));
  const consulta = p.toString();
  return consulta ? `?${consulta}` : "?";
}
