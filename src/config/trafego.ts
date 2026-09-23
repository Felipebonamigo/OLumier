/**
 * TRÁFEGO — o que os fornecedores cobram (ou dão) por byte que SAI.
 *
 * ── POR QUE É UM ARQUIVO SÓ PARA ISSO (23/09/2026) ────────────────────────
 *
 * `planos.ts` reserva o custo de GUARDAR; download nunca entrou lá, e o
 * comentário de `custoArmazenamentoCentavos` avisa que é "o único variável que
 * pode morder de verdade". Até aqui ele não era medido em lugar nenhum. Com o
 * servidor de ZIP a conta ganhou duas franquias e dois preços de excedente, e
 * o painel de administração passou a comparar o que saiu no mês com elas. Os
 * números moram aqui para terem UM lugar, com a fonte e a data ao lado.
 *
 * Nada disto entra no preço do plano. O que entra é a DECISÃO: se o excedente
 * aparecer com frequência, o painel avisa e é hora de rever o desenho, não de
 * somar centavos à reserva por cima.
 *
 * Câmbio como em `planos.ts`: R$ 5,50/US$ e R$ 6,30/€. IOF e spread do cartão
 * vêm de `custos-fixos.ts` e são aplicados por quem calcula.
 */

/**
 * Backblaze B2: download grátis até 3× a média do que está guardado no mês
 * (byte-hora, nível da conta), depois US$ 0,01/GB. Conferido na página de
 * preços em 23/09/2026. Não bloqueia: cobra.
 */
export const FRANQUIA_B2_MULTIPLO = 3;
export const EXCEDENTE_B2_CENTAVOS_GB = 5.5;

/**
 * O servidor de ZIP (Hetzner Cloud): 20 TB de saída por mês incluídos no
 * plano, depois € 1,00 por TB. Ficha do plano em 23/09/2026 — os dois números
 * estão no contrato do servidor, não no repo: conferir lá se a Hetzner mudar
 * de tabela (subiu em abril e junho de 2026).
 */
export const FRANQUIA_SERVIDOR_ZIP_BYTES = 20 * 1000 ** 4;
export const EXCEDENTE_SERVIDOR_ZIP_CENTAVOS_GB = 0.63;

/** O VPS da Hostinger (KVM 2): 8 TB por mês. Passou, cai para 10 Mbps até a virada. */
export const FRANQUIA_VPS_BYTES = 8 * 1000 ** 4;

/** Quantos GB cabem num número de bytes, com fração — para multiplicar por R$/GB. */
export const gbDe = (bytes: number | bigint) => Number(bytes) / 1000 ** 3;
