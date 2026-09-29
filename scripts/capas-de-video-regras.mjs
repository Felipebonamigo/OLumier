/**
 * A REGRA QUE SEPARA CAPA DE VERDADE DE CAPA DE FÁBRICA.
 *
 * Módulo puro, sem banco e sem rede, pelo mesmo motivo de
 * `varrer-orfaos-regras.mjs`: a decisão que autoriza uma escrita precisa poder
 * ser testada sem nada por perto. `scripts/testar-capas-de-video.mjs` prende.
 *
 * ── POR QUE NÃO SE DECODIFICA A IMAGEM AQUI ───────────────────────────────
 *
 * Seria o caminho óbvio — abrir o PNG e ver se é chapado. Custa uma dependência
 * nova só para isto, e não é necessário: a evidência mais forte está no
 * conteúdo BRUTO, e é conclusiva.
 *
 * Duas fotos diferentes NÃO produzem o mesmo arquivo. Se dois vídeos distintos
 * têm capas byte a byte idênticas, aquilo não é o quadro de nenhum dos dois —
 * é a imagem que a falha produz sempre igual. Em 29/09/2026, em produção, 40
 * vídeos de três estúdios diferentes compartilhavam o MESMO arquivo de 4.195
 * bytes.
 *
 * O tamanho entra como segunda evidência, para o caso de um único vídeo ter
 * saído em branco sem par: uma miniatura de 640 px com imagem de verdade pesa
 * centenas de KB (as três legítimas de produção pesavam 375, 465 e 484 KB),
 * enquanto as vazias pesavam 4 KB.
 */

/**
 * Abaixo disto, a miniatura quase certamente não tem imagem.
 *
 * 20 KB é folgado de propósito: as vazias medidas tinham 4 KB e as boas, 375 KB
 * ou mais. Um número no meio desse vão erra para o lado seguro — no máximo
 * marca para regerar uma capa legítima porém muito simples, e regerar não
 * destrói nada.
 */
export const BYTES_SUSPEITOS = 20 * 1024;

/**
 * Classifica cada vídeo. Recebe a lista já com o tamanho e o hash da capa.
 *
 * @param {{id: string, chave: string|null, bytes: number|null, hash: string|null, galeria: string, nome: string}[]} videos
 * @returns {{id: string, situacao: "sem-capa"|"de-fabrica"|"suspeita"|"ok", motivo: string, galeria: string, nome: string}[]}
 */
export function classificarCapas(videos) {
  /* Quantos vídeos DIFERENTES compartilham cada conteúdo. */
  const porHash = new Map();
  for (const v of videos) {
    if (!v.hash) continue;
    porHash.set(v.hash, (porHash.get(v.hash) ?? 0) + 1);
  }

  return videos.map((v) => {
    const base = { id: v.id, galeria: v.galeria, nome: v.nome };
    if (!v.chave) return { ...base, situacao: "sem-capa", motivo: "nunca teve miniatura" };
    if (!v.hash) return { ...base, situacao: "sem-capa", motivo: "a miniatura não está no armazém" };

    const repetida = porHash.get(v.hash) ?? 0;
    if (repetida > 1) {
      return {
        ...base,
        situacao: "de-fabrica",
        motivo: `a mesma imagem de outros ${repetida - 1} vídeo${repetida - 1 === 1 ? "" : "s"}`,
      };
    }
    if ((v.bytes ?? 0) < BYTES_SUSPEITOS) {
      return { ...base, situacao: "suspeita", motivo: `só ${v.bytes} bytes` };
    }
    return { ...base, situacao: "ok", motivo: "" };
  });
}

/** As que devem voltar para a fila de "sem capa". */
export const paraRegerar = (classificadas) =>
  classificadas.filter((c) => c.situacao !== "ok");
