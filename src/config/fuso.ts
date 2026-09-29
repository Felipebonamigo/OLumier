/**
 * O FUSO EM QUE AS DATAS SÃO MOSTRADAS.
 *
 * ── POR QUE ISTO PRECISOU EXISTIR (29/09/2026) ────────────────────────────
 *
 * Felipe, olhando os "Últimos eventos" do admin às 18:50: "esse horário está
 * errado, ainda são 18:50 aqui". A tela dizia 21:16.
 *
 * Três horas exatas. O VPS roda em `Etc/UTC` — conferido, `timedatectl` diz
 * "Time zone: Etc/UTC" — e o serviço não define `TZ`. Como a página é desenhada
 * NO SERVIDOR, `toLocaleString("pt-BR")` usa o fuso do processo, não o de quem
 * lê. A etiqueta "pt-BR" escolhe o IDIOMA, nunca o fuso: o formato saía
 * brasileiro e a hora, inglesa.
 *
 * ── E O PIOR NÃO É A HORA, É A DATA ───────────────────────────────────────
 *
 * Entre 21:00 e 00:00 de Brasília já é o dia seguinte em UTC. Toda data
 * desenhada nessa faixa saía um dia à frente — e isso alcança o prazo da
 * galeria ("expira em"), o vencimento do teste e a data do último pagamento.
 * Um dia de diferença ali é uma conversa com cliente.
 *
 * ── POR QUE NÃO ARRUMAR O `TZ` DO SERVIÇO ─────────────────────────────────
 *
 * Trocar `TZ` no systemd consertaria a tela e mexeria no processo inteiro: nos
 * logs, no `new Date()` e em toda conta de data que hoje assume UTC. A mudança
 * honesta é menor: a hora é GRAVADA em UTC (as colunas são `timestamptz`) e
 * EXIBIDA em Brasília. Dizer isso na hora de formatar não mexe em mais nada.
 *
 * ── UM ÚNICO FUSO, E NÃO O DO NAVEGADOR ───────────────────────────────────
 *
 * O produto é brasileiro: o preço é em real, o atendimento é em português, e o
 * fotógrafo e o casal estão no mesmo país. Mostrar no fuso do navegador faria a
 * mesma galeria dizer horas diferentes para o casal em viagem e para o
 * fotógrafo em casa — e, pior, faria o servidor e o navegador desenharem textos
 * diferentes para a mesma linha, que é o erro de hidratação mais chato de achar.
 *
 * Um dia, se houver cliente fora do Brasil, isto vira uma preferência do
 * estúdio. Hoje seria eixo novo para ninguém.
 *
 * `scripts/testar-fuso-do-brasil.mjs` prende o valor e varre `src/` atrás de
 * formatador que tenha esquecido o fuso — é ele que impede o 39º nascer errado,
 * já que na máquina de quem escreve (que está em Brasília) o defeito não
 * aparece.
 */
export const FUSO = "America/Sao_Paulo";
