/**
 * A ORDEM "NATURAL" DE UM NOME DE ARQUIVO — a mesma régua no envio e no painel.
 *
 * ── DE ONDE VEIO (25/09/2026) ─────────────────────────────────────────────
 *
 * Juan, sobre uma galeria com pares de foto colorida + preto-e-branco:
 *
 *   "Nas horizontais; a preto e branco tá na frente" — a PB aparecendo ANTES
 *   da colorida, na ordem "Nome A → Z". "Eu cheguei a atualizar ali os
 *   capítulos 'por ordem de nome A-Z'. E ainda assim nothing happened" — ou
 *   seja, a galeria JÁ SAÍA nessa ordem, e reordenar não mudava nada.
 *
 * A causa é a extensão. O editor dele exporta a variante em preto-e-branco
 * com um sufixo colado no nome — "-PB", "_bw", " (PB)", o formato varia por
 * pessoa — e comparando o nome INTEIRO, com a extensão junto, o "." do
 * arquivo colorido cai bem onde o sufixo do outro começa:
 *
 *     "lu-042.jpg"       "lu-042.jpg"
 *     "lu-042-PB.jpg"         ↑ aqui os dois têm "lu-042", e o próximo
 *                               caractere é "." de um lado e "-" do outro
 *
 * "-" (0x2D) vem ANTES de "." (0x2E) em toda tabela de caracteres — ASCII,
 * Unicode, e por isso também no `Intl.Collator` (que trata pontuação como
 * critério de desempate, não como coisa que se ignora). O mesmo vale para
 * espaço, parêntese e `_`: qualquer separador que o fotógrafo use antes do
 * sufixo faz o arquivo COM sufixo (mais longo) perder para o SEM sufixo
 * exatamente no ponto em que a extensão apareceria — e "perder" aqui quer
 * dizer vir primeiro, o oposto do que qualquer fotógrafo espera.
 *
 * Comparar SEM a extensão resolve os dois de uma vez: "lu-042" é PREFIXO de
 * "lu-042-PB", e um prefixo sempre vem antes do que ele prefixa (a string
 * mais curta "acaba" primeiro) — em qualquer separador, sem precisar
 * reconhecer "-PB", "_bw" ou qualquer outro sufixo específico.
 *
 * ── POR QUE ISTO MORA NUM MÓDULO PRÓPRIO, E NÃO EM `lib/secoes.ts` ────────
 *
 * Porque o comentário que descobriu a ligação já dizia: é "a MESMA função
 * que ordena os arquivos no envio". Só que não era — eram duas instâncias
 * de `Intl.Collator` iguais, uma em `lib/secoes.ts` (server-only) e outra em
 * `lib/fila-upload.ts` (client), copiadas em vez de compartilhadas. Consertar
 * uma sozinha teria arrumado o "Nome A → Z" do painel e deixado a ordem de
 * ENVIO — que é de onde a galeria nasce errada, antes de qualquer reordenar
 * — exatamente como estava. As duas têm de vir do mesmo lugar para não
 * poderem divergir de novo.
 *
 * Nem `secoes.ts` (que é `server-only`) nem `fila-upload.ts` (que é
 * `"use client"`) podem importar um do outro; um módulo neutro, sem os dois
 * rótulos, é o que os dois lados conseguem importar.
 */

/** Compara como o fotógrafo espera: "foto_2" antes de "foto_10". */
const colador = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/**
 * Tira a extensão do fim do nome — só a ÚLTIMA, e só quando sobra pelo menos
 * um caractere antes do ponto (".jpg" sozinho não tem "nome" para expor).
 *
 * Funciona igual para um CAMINHO ("01 Making Of/foto-PB.jpg"): o ponto que
 * importa é sempre o último da string inteira, porque nome de pasta com
 * ponto no fim não existe na prática.
 */
function semExtensao(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i > 0 ? nome.slice(0, i) : nome;
}

/**
 * Compara dois nomes (ou caminhos) na ordem que o fotógrafo espera.
 *
 * A extensão fica de fora da conta — ver o comentário do módulo. O empate que
 * isso pode criar (dois arquivos de nomes iguais, extensões diferentes: p.ex.
 * uma capa exportada em `.jpg` e em `.png`) é raro, e quem desempata depois é
 * sempre `criado_em`/`ordem`/`id`, nunca este comparador sozinho.
 */
export function compararNomeNatural(a: string, b: string): number {
  return colador.compare(semExtensao(a), semExtensao(b));
}
