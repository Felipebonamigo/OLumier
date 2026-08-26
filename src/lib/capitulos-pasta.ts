/**
 * Lê a estrutura de pastas do envio e devolve os capítulos da galeria.
 *
 * O fotógrafo já organiza o casamento em pastas no disco — é assim que ele sai
 * do Lightroom. Antes desta peça, arrastar a pasta subia os arquivos e jogava
 * todos no mesmo destino: a organização que ele já tinha feito era descartada na
 * porta, e ele refazia à mão, no painel, o que já estava pronto.
 *
 * É também a resposta barata ao plugin de Lightroom do concorrente. O plugin
 * economiza UM passo (exportar para a pasta). Ler a pasta economiza o resto.
 *
 * ── ONDE MORA O CAPÍTULO ──────────────────────────────────────────────────
 * Depende de como a pessoa soltou os arquivos, e não dá para perguntar:
 *
 *   selecionou a pasta do casamento → "Casamento/Cerimônia/foto.jpg"
 *   arrastou duas pastas de uma vez  → "Cerimônia/foto.jpg"
 *
 * A regra que resolve as duas: se TODOS os caminhos começam pela mesma pasta,
 * essa primeira é a do casamento e o capítulo é a seguinte. Se começam por
 * pastas diferentes, não existe pasta do casamento e o capítulo é a primeira.
 *
 * O caso que quebra a regra ingênua (prefixo comum a todos) é o arquivo que fica
 * solto dentro do capítulo enquanto outro está numa subpasta dele:
 * "Casamento/Cerimônia/a.jpg" e "Casamento/Cerimônia/Selecionadas/b.jpg". O
 * prefixo comum aí é "Casamento/Cerimônia", e o capítulo viraria "Selecionadas"
 * para um e nada para o outro. Por isso a raiz é no máximo UMA pasta: o que está
 * mais fundo pertence ao capítulo acima, não vira capítulo próprio.
 *
 * ── POR QUE O NÚMERO NA FRENTE IMPORTA ────────────────────────────────────
 * "01 Making Of", "02 Cerimônia", "03 Festa" — o fotógrafo numera porque a
 * ordem É a narrativa. Em ordem alfabética a cerimônia vem antes do making of e
 * a festa acaba antes da noiva se arrumar. O número decide a ordem e sai do
 * nome; pasta sem número entra depois, na ordem em que apareceu.
 */

export interface CapituloDaPasta {
  /** Nome já limpo do número de ordenação. */
  nome: string;
  /** Caminhos originais dos arquivos deste capítulo, na ordem recebida. */
  caminhos: string[];
}

export interface CapituloCasado extends CapituloDaPasta {
  /** Id da seção que já existe, ou null quando ainda precisa nascer. */
  id: string | null;
  criar: boolean;
}

/** Windows manda `\`, o arrasto manda `/` na frente. Aqui vira um formato só. */
function segmentos(caminho: string): string[] {
  return caminho
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
}

/**
 * Tira o número de ordenação da frente: "02 - Cerimônia" vira { 2, "Cerimônia" }.
 *
 * Pasta que é SÓ número ("01") mantém o nome original — um capítulo sem nome
 * seria pior que um capítulo chamado "01", e o fotógrafo renomeia em um clique.
 *
 * O número precisa terminar em separador ou no fim do nome. Sem essa exigência,
 * "2026 Casamento" viraria ordem 202 com nome "6 Casamento" — pasta com ano na
 * frente é comum, e o estrago aparece só no nome do capítulo que o cliente lê.
 */
function separarOrdem(nomeBruto: string): { ordem: number | null; nome: string } {
  const m = /^(\d{1,3})(?:\s*[-._)]+\s*|\s+|$)(.*)$/.exec(nomeBruto);
  if (!m) return { ordem: null, nome: nomeBruto };
  const resto = m[2].trim();
  return { ordem: Number(m[1]), nome: resto || nomeBruto };
}

/** Compara nomes como uma pessoa compara: sem acento, sem caixa, sem espaço sobrando. */
export function mesmaCoisa(a: string, b: string): boolean {
  const limpar = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  return limpar(a) === limpar(b);
}

/**
 * Agrupa os caminhos em capítulos. Arquivo sem capítulo simplesmente não aparece
 * no resultado — ele segue para o destino que o fotógrafo escolheu na tela.
 */
export function capitulosDaPasta(caminhos: string[]): CapituloDaPasta[] {
  const partido = caminhos.map((c) => ({ caminho: c, pastas: segmentos(c).slice(0, -1) }));

  /* A raiz é no máximo UMA pasta, e só quando todos concordam com ela. Ver o
   * comentário do topo: prefixo comum mais fundo que isso engole o capítulo. */
  const primeiras = new Set(partido.map((p) => p.pastas[0] ?? ""));
  const temRaiz = primeiras.size === 1 && !primeiras.has("");
  const nivel = temRaiz ? 1 : 0;

  const porNome = new Map<string, { ordem: number | null; nome: string; caminhos: string[] }>();

  for (const { caminho, pastas } of partido) {
    const bruto = pastas[nivel];
    if (!bruto) continue; // arquivo solto na raiz: fica sem capítulo, por desenho

    const { ordem, nome } = separarOrdem(bruto);
    /* A chave é o nome comparável, não o literal: "Cerimônia" e "cerimonia" na
     * mesma leva são um capítulo só, não dois quase iguais no menu do cliente. */
    const chave = nome
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();

    const atual = porNome.get(chave);
    if (atual) atual.caminhos.push(caminho);
    else porNome.set(chave, { ordem, nome, caminhos: [caminho] });
  }

  /* Numeradas primeiro, pelo número. Sem número depois, na ordem em que
   * apareceram — que costuma ser a ordem do disco, e é melhor que alfabética. */
  const lista = [...porNome.values()];
  const comNumero = lista.filter((c) => c.ordem !== null).sort((a, b) => a.ordem! - b.ordem!);
  const semNumero = lista.filter((c) => c.ordem === null);

  return [...comNumero, ...semNumero].map(({ nome, caminhos: cs }) => ({ nome, caminhos: cs }));
}

/**
 * Liga cada capítulo lido da pasta ao que já existe na galeria.
 *
 * Sem isto, enviar a segunda leva de fotos criaria um segundo "Cerimônia" ao
 * lado do primeiro — e o cliente veria dois capítulos iguais no menu. É o mesmo
 * defeito que o painel tem hoje ao criar capítulo à mão.
 */
export function casarComExistentes(
  capitulos: CapituloDaPasta[],
  existentes: { id: string; nome: string }[],
): CapituloCasado[] {
  return capitulos.map((c) => {
    const achado = existentes.find((e) => mesmaCoisa(e.nome, c.nome));
    return achado
      ? { ...c, id: achado.id, criar: false }
      : { ...c, id: null, criar: true };
  });
}
