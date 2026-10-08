/**
 * COMO A LISTA DE CAPÍTULOS FALA DO QUE TEM DENTRO (08/10/2026).
 *
 * Juan, olhando a aba Fotos de uma galeria com capítulos de filme ("Vídeos -
 * Júlia e Gustavo — ver as 7 fotos"): "tá escrito só 'fotos', poderia
 * descrever o que são fotos e o que são vídeos".
 *
 * A contagem do capítulo sempre foi de MÍDIAS PRONTAS, e a tela a chamava toda
 * de foto. Agora ela separa os dois, e este arquivo é a única régua das
 * palavras — a lista, a linha das soltas e as confirmações leem daqui, para
 * nenhuma delas voltar a dizer "foto" para um filme.
 *
 *   229 fotos                  só fotos
 *   7 vídeos                   só vídeos
 *   229 fotos · 3 vídeos       os dois
 *
 * Sem `server-only` de propósito: o editor de capítulos é do cliente.
 */
export interface Contagem {
  fotos: number;
  videos: number;
}

/**
 * Separa o total em fotos e vídeos. `videos` nunca passa do total nem fica
 * negativo — a contagem vem de duas consultas, e a tela não deve mostrar
 * "-2 fotos" se uma delas chegar desencontrada da outra.
 */
export function contagemDe(total: number, videos: number): Contagem {
  const t = Math.max(0, total);
  const v = Math.min(Math.max(0, videos), t);
  return { fotos: t - v, videos: v };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "229 fotos" · "7 vídeos" · "229 fotos · 3 vídeos". Vazio continua "0 fotos". */
export function textoDaContagem({ fotos, videos }: Contagem): string {
  if (fotos === 0 && videos === 0) return "0 fotos";
  const partes: string[] = [];
  if (fotos > 0) partes.push(plural(fotos, "foto", "fotos"));
  if (videos > 0) partes.push(plural(videos, "vídeo", "vídeos"));
  return partes.join(" · ");
}

/**
 * O texto do link que abre a grade: "ver as 229 fotos", "ver os 7 vídeos",
 * "ver 229 fotos · 3 vídeos". O artigo só entra quando há um tipo só — com os
 * dois, ele não concordaria com ambos.
 */
export function textoDoLinkVer(c: Contagem): string {
  if (c.videos === 0) return c.fotos === 1 ? "ver a 1 foto" : `ver as ${c.fotos} fotos`;
  if (c.fotos === 0) return c.videos === 1 ? "ver o 1 vídeo" : `ver os ${c.videos} vídeos`;
  return `ver ${textoDaContagem(c)}`;
}

/** O botão "tirar …" da linha: diz o que sai, e não só "as fotos". */
export function textoDoTirar({ fotos, videos }: Contagem): string {
  if (videos === 0) return "tirar as fotos";
  if (fotos === 0) return "tirar os vídeos";
  return "tirar tudo";
}
