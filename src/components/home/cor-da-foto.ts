"use client";

/**
 * A COR DE UMA FOTO, PARA O BRILHO ATRÁS DO HERO (03/10/2026).
 *
 * A home é neutra de propósito: quem traz a cor são as fotos (briefing §3).
 * O brilho atrás das galerias do hero segue a capa que está na frente — e a
 * capa pode ser trocada pelo admin a qualquer hora (`/painel/admin/home`), então
 * a cor não pode ser escrita à mão: ela é lida da miniatura, no navegador.
 *
 * A miniatura é desenhada num quadro de 12×12 e a média é ponderada pela
 * saturação de cada ponto — a média simples de uma foto de casamento é quase
 * sempre um cinza, e cinza não dá brilho nenhum.
 *
 * A foto trocada pelo admin chega por `/api/home/foto/…`, que redireciona para
 * o armazém, em outro endereço. Por isso `crossOrigin`: sem ele o canvas fica
 * "sujo" e não deixa ler os pontos. Se o armazém recusar, a resposta é `null`
 * e o hero fica sem brilho — nunca sem galeria.
 */
const lidas = new Map<string, Promise<string | null>>();

export function corDaFoto(src: string): Promise<string | null> {
  let p = lidas.get(src);
  if (!p) {
    p = new Promise((resolver) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => {
        try {
          const lado = 12;
          const c = document.createElement("canvas");
          c.width = lado;
          c.height = lado;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolver(null);
          ctx.drawImage(img, 0, 0, lado, lado);
          const d = ctx.getImageData(0, 0, lado, lado).data;
          let r = 0, g = 0, b = 0, peso = 0;
          for (let i = 0; i < d.length; i += 4) {
            const mx = Math.max(d[i], d[i + 1], d[i + 2]);
            const mn = Math.min(d[i], d[i + 1], d[i + 2]);
            const w = mx - mn + 8;
            r += d[i] * w;
            g += d[i + 1] * w;
            b += d[i + 2] * w;
            peso += w;
          }
          const hex = (v: number) => Math.round(v / peso).toString(16).padStart(2, "0");
          resolver(`#${hex(r)}${hex(g)}${hex(b)}`);
        } catch {
          resolver(null);
        }
      };
      img.onerror = () => resolver(null);
      img.src = src;
    });
    lidas.set(src, p);
  }
  return p;
}
