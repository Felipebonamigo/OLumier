/**
 * O RECADO DO CLIENTE — as medidas e as réguas (migração 058).
 *
 * Fica em `config/` e NÃO em `lib/` por um motivo mecânico: o editor do painel é
 * componente de cliente e precisa dos tetos e do convite padrão. `lib/recados.ts`
 * é `server-only` e importa o banco — arrastar o `pg` para o navegador foi
 * exatamente o erro que fez esta separação existir.
 *
 * Aqui não há nada que toque banco. A leitura e a escrita moram em
 * `lib/recados.ts`, que reexporta tudo isto para quem já importava de lá.
 */

/**
 * O teto do texto, e o número não é chute: é `LIMITES.depoimentoTexto`
 * (`lib/site-estudio.ts`), o teto do depoimento no site do estúdio. O caminho
 * natural deste recado é virar depoimento, e um teto maior aqui faria o passo
 * seguinte cortar o fim da frase de quem escreveu — com a autorização dela já
 * dada.
 */
export const TETO_DO_RECADO = 900;

/** Quantas perguntas com nota o fotógrafo pode montar. Seis cabem numa tela. */
export const MAX_PERGUNTAS = 6;
/** Uma pergunta é uma pergunta, não um parágrafo. */
export const TETO_DA_PERGUNTA = 80;
/** O convite que o casal lê antes de escrever. */
export const TETO_DO_CONVITE = 200;

/** O convite padrão, quando o fotógrafo não escreveu o dele. */
export const CONVITE_PADRAO = "Conte para o fotógrafo o que você achou desta entrega.";

export interface ConfigDoRecado {
  /** Há alguma coisa para a pessoa fazer? É `escrito || estrelas`. */
  ativo: boolean;
  /** O campo de texto livre aparece. */
  escrito: boolean;
  /** As linhas de estrelas aparecem — e só com pergunta montada. */
  estrelas: boolean;
  convite: string;
  perguntas: string[];
}

/**
 * A lista de perguntas, lida de `jsonb` — que pode conter qualquer coisa.
 *
 * Mesma forma de `lerAparencia` e `lerDepoimentos`: valida item por item e
 * devolve o que serve, em vez de confiar na coluna ou de derrubar a tela do
 * casal por causa de um `jsonb` estranho. Pergunta vazia sai da lista: ela
 * desenharia cinco estrelas sem pergunta nenhuma em cima.
 */
export function lerPerguntas(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const item of bruto) {
    if (typeof item !== "string") continue;
    const limpo = item.replace(/\s+/g, " ").trim().slice(0, TETO_DA_PERGUNTA);
    /* Pergunta repetida viraria uma chave só no `notas`, e a segunda linha de
       estrelas sobrescreveria a primeira sem ninguém entender por quê. */
    if (!limpo || vistas.has(limpo)) continue;
    vistas.add(limpo);
    saida.push(limpo);
    if (saida.length >= MAX_PERGUNTAS) break;
  }
  return saida;
}

/**
 * A configuração como a galeria pública a usa.
 *
 * Recebe a LINHA que a página já carregou, e por isso não custa consulta
 * nenhuma: as 512 galerias que nunca vão ligar recado não pagam por este
 * recurso existir.
 */
export function configDoRecado(linha: {
  recado_ativo?: boolean | null;
  recado_estrelas?: boolean | null;
  recado_convite?: string | null;
  recado_perguntas?: unknown;
}): ConfigDoRecado {
  const perguntas = lerPerguntas(linha.recado_perguntas);
  const estrelas = Boolean(linha.recado_estrelas) && perguntas.length > 0;
  const escrito = Boolean(linha.recado_ativo);
  return {
    /*
     * Ligado é "existe alguma coisa para a pessoa fazer". As duas chaves são
     * separadas até aqui porque fazem coisas diferentes na tela: desligar o
     * texto escrito tem de TIRAR a caixa de escrever, e não só deixar de
     * convidar. Só as estrelas, sem pergunta montada, não é convite nenhum — é
     * um formulário vazio.
     */
    ativo: escrito || estrelas,
    escrito,
    estrelas,
    convite: (linha.recado_convite ?? "").trim().slice(0, TETO_DO_CONVITE) || CONVITE_PADRAO,
    perguntas,
  };
}


/**
 * As notas que a pessoa mandou, cruzadas com as perguntas que o fotógrafo FEZ.
 *
 * As chaves chegam do navegador. Gravar o que vier deixaria qualquer um escrever
 * texto livre na tela do fotógrafo por dentro de um campo de nota — e nota fora
 * de 0 a 5 estragaria a média sem ninguém ver de onde veio.
 */
export function notasValidas(bruto: unknown, perguntas: string[]): Record<string, number> {
  if (!bruto || typeof bruto !== "object") return {};
  const saida: Record<string, number> = {};
  for (const pergunta of perguntas) {
    const valor = (bruto as Record<string, unknown>)[pergunta];
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0 || n > 5) continue;
    saida[pergunta] = n;
  }
  return saida;
}

