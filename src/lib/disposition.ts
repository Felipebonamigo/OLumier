/**
 * O `Content-Disposition` de um download, montado sem deixar o nome virar
 * cabeçalho injetado. Puro, sem dependência: é importado pelo app (via
 * `lib/r2.ts`) e pelo servidor de ZIP, que roda fora do Next.
 */
/**
 * Monta o `Content-Disposition` do download sem deixar o nome do arquivo virar
 * cabeçalho injetado.
 *
 * O nome vem do navegador de quem enviou. Tirar só as aspas não bastava: quebra
 * de linha no meio do nome permitiria emendar OUTRO cabeçalho na resposta, e
 * acento simplesmente não é válido num header — "Ana & Pedro — Cerimônia.jpg"
 * chegaria corrompido ou faria a requisição falhar.
 *
 * Por isso duas formas, como o padrão prevê: `filename` só com ASCII seguro,
 * para navegador antigo, e `filename*` em UTF-8, que os atuais preferem — e que
 * preserva o acento e o nome real que o casal espera ver.
 */
export function dispositionSegura(nome: string): string {
  const limpo = nome.replace(/[\r\n"\\]/g, "").slice(0, 200) || "arquivo";
  const soAscii = limpo.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${soAscii}"; filename*=UTF-8''${paraExtValue(limpo)}`;
}

/**
 * O nome no formato que a RFC 5987 chama de `ext-value`.
 *
 * ── POR QUE `encodeURIComponent` NÃO BASTA (11/09/2026) ───────────────────
 *
 * A Carol tentou salvar uma foto no celular e o navegador saiu da galeria para
 * o Backblaze, com isto na tela:
 *
 *     InvalidRequest invalid b2-content-disposition:
 *     expected a token character at 139, but got '('
 *
 * O parêntese era do nome do arquivo — "… (1).jpg" é o nome mais comum que sai
 * de uma pasta de fotos. `encodeURIComponent` deixa passar `!'()*` SEM
 * codificar: é assim por desenho, porque esses caracteres são legais numa URL.
 * Num `ext-value` eles não são. A gramática aceita só
 *
 *     ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+" / "-" / "." / "^" / "_" /
 *     "`" / "|" / "~"     e o resto como %XX
 *
 * de onde `( ) ' *` estão fora, e `!` é o único dos cinco que se salva.
 *
 * O R2 aceitava o cabeçalho torto; o B2 recusa. Como o ORIGINAL mora no B2 e a
 * derivada no R2, o defeito aparecia SÓ no download da foto em tamanho cheio —
 * a galeria abria normalmente, e era o "salvar" que morria.
 */
function paraExtValue(nome: string): string {
  return encodeURIComponent(nome).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
