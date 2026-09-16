/**
 * Como as fotos saem da galeria para cada aparelho.
 *
 *   computador  um zip montado no servidor (`api/g/[id]/zip`)
 *   menu        iPhone/iPad: o menu de compartilhar, onde "Salvar N imagens"
 *               grava no app Fotos. Um toque por lote.
 *   download    Android: download comum, foto por foto. Cai na pasta Download,
 *               que a Galeria e o Google Fotos mostram.
 *
 * ── POR QUE O ANDROID NÃO USA O MENU (16/09/2026) ─────────────────────────
 *
 * O Chrome do Android recusa `share()` com mais de 10 arquivos ou mais de
 * 50 MB (navigator_share.cc, kMaxSharedFileCount = 10) — e só recusa depois de
 * gastar o toque. E o menu dele não tem "salvar na galeria": os destinos são
 * apps. O download direto termina onde a pessoa procura e custa um "Permitir"
 * só, na segunda foto.
 *
 * Este arquivo roda nos dois lados: o servidor usa o palpite pelo user-agent
 * para a primeira pintura já sair com o rótulo certo; o navegador confirma com
 * detecção de recurso (`modoDeEntrega` em `lib/salvar-client.ts`).
 */
export type ModoDeEntrega = "computador" | "menu" | "download";

export function modoPeloUserAgent(ua: string): ModoDeEntrega {
  if (/android/i.test(ua)) return "download";
  if (/iphone|ipad|ipod/i.test(ua)) return "menu";
  /* iPad com UA de Mac não se distingue daqui — o navegador corrige ao montar. */
  return "computador";
}
