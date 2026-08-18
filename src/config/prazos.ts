/**
 * Prazos do cofre — constantes puras, sem acesso a banco.
 *
 * Ficam separadas de `lib/cofre.ts` (que é `server-only`) porque a tela do
 * painel é um componente de cliente e precisa desta lista para desenhar os
 * botões. Importar o módulo de servidor ali quebraria a compilação.
 */

/** Opções oferecidas ao fotógrafo. `null` = fica no ar para sempre. */
export const PRAZOS = [
  { meses: 6, rotulo: "6 meses" },
  { meses: 12, rotulo: "12 meses" },
  { meses: 24, rotulo: "2 anos" },
  { meses: null, rotulo: "Sem prazo" },
] as const;

export const PRAZO_PADRAO = 12;

export function calcularVencimento(meses: number | null, base = new Date()): Date | null {
  if (meses === null) return null;
  const d = new Date(base);
  d.setMonth(d.getMonth() + meses);
  return d;
}

/** Dias que faltam para a galeria descer ao cofre; null quando não tem prazo. */
export function diasAteArquivar(expiraEm: Date | string | null): number | null {
  if (!expiraEm) return null;
  const ms = new Date(expiraEm).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/**
 * Descobre qual opção de prazo corresponde à data guardada — para marcar o botão
 * certo na tela. Usa a folga de 20 dias porque o prazo foi contado a partir da
 * publicação, não de hoje.
 */
export function mesesEquivalentes(expiraEm: Date | string | null): number | null {
  if (!expiraEm) return null;
  const dias = diasAteArquivar(expiraEm) ?? 0;
  const candidatos = PRAZOS.filter((p) => p.meses !== null).map((p) => p.meses as number);
  let melhor = candidatos[0];
  let menorDistancia = Infinity;
  for (const m of candidatos) {
    const d = Math.abs(m * 30 - dias);
    if (d < menorDistancia) {
      menorDistancia = d;
      melhor = m;
    }
  }
  return melhor;
}
