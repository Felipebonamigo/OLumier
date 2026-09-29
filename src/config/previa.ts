/**
 * A PRÉVIA DO DONO SAI DO ENDEREÇO (29/09/2026).
 *
 * O fotógrafo abria "Ver como o cliente vê", entrava num capítulo, copiava a
 * barra do navegador e mandava para o casal:
 *
 *     galeriaatomo.com.br/g/allan-santana-fotografia/sarah-e-levi/making-of?previa=1
 *
 * Pedido dele, pelo Felipe: tirar o "making of" e o "previa". O capítulo sai da
 * barra em `galeria-cliente.tsx`; este arquivo cuida do `?previa=1`.
 *
 * ── COMO A PRÉVIA CONTINUA EXISTINDO SEM O PARÂMETRO ──────────────────────
 *
 * O `?previa=1` é o PEDIDO ("sou o dono, deixa eu ver o rascunho"), e a
 * permissão continua vindo da sessão — ver `app/g/[estudio]/[galeria]/page.tsx`.
 * Agora o pedido chega do mesmo jeito, pelo mesmo botão, mas o proxy o troca
 * por um cookie preso ao caminho DAQUELA galeria e devolve o endereço limpo.
 * O cookie vai junto em toda tela da galeria (capítulos incluídos), e a barra
 * mostra o link que o cliente recebe.
 *
 * Só na navegação de verdade (`Sec-Fetch-Dest: document`): a caixinha de prévia
 * do editor de aparência é um iframe que leva `?previa=1&amostra=1&ap=…` a
 * cada clique, ninguém copia aquele endereço, e um redirecionamento a mais ali
 * seria só atraso.
 */

/** O nome do cookie. O valor é sempre "1"; o que ele vale é o caminho dele. */
export const COOKIE_PREVIA = "previa_galeria";

/**
 * Duas horas. É o tempo de conferir uma galeria — e cada clique em "Ver como o
 * cliente vê" renova.
 *
 * Não é mais longo porque, enquanto o cookie vive, o dono que abrir o link
 * normal da galeria NESTE navegador continua em prévia: vê o design ainda não
 * publicado, passa direto pela senha e não conta como abertura. Quem quiser ver
 * a entrega de verdade usa o "abrir" da aba Entrega, que vai pelo endereço do
 * estúdio — outro host, aonde este cookie não chega.
 *
 * E o rascunho não depende dele: galeria não publicada abre para o dono logado
 * mesmo sem o pedido (não existe outra coisa a mostrar para ele ali), então o
 * cookie vencer no meio da conferência não vira 404.
 */
export const VALIDADE_PREVIA_S = 2 * 60 * 60;

/**
 * `/g/<estudio>/<galeria>` de um caminho de galeria — com ou sem capítulo —,
 * ou `null` para qualquer outra coisa. É o `path` do cookie: preso à galeria,
 * ele não vaza para as outras do mesmo estúdio.
 */
export function baseDaGaleria(caminho: string): string | null {
  const m = /^\/g\/([^/]+)\/([^/]+)(?:\/[^/]+)?\/?$/.exec(caminho);
  return m ? `/g/${m[1]}/${m[2]}` : null;
}
