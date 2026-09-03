import type { Metadata } from "next";
import { SpikeRostos } from "./spike";

export const metadata: Metadata = { title: "Spike — rostos" };

/**
 * BANCADA DE MEDIÇÃO do reconhecimento facial. Não é tela de produto e não deve
 * virar uma: existe para responder, com número, se o recurso pode ser
 * construído — e para poder ser rodada de novo quando alguém duvidar.
 *
 * ── COMO RODAR ────────────────────────────────────────────────────────────
 *
 * Os pesos (13 MB) não são versionados. Traga do próprio pacote:
 *
 *   cp node_modules/@vladmandic/face-api/model/{ssd_mobilenetv1,tiny_face_detector,face_landmark_68,face_recognition}_model* public/modelos-rosto/
 *
 * Depois abra /spike-rostos e clique em Medir. Leva ~2 min.
 *
 * ── O QUE JÁ FOI MEDIDO (03/09/2026, RTX 4070 Ti, backend webgl) ───────────
 *
 * CUSTO ~1 s por foto, com detecção + 68 pontos + vetor, na derivada de 2048.
 *   Casamento de 192 fotos: ~3 min. Sem aceleração de hardware o mesmo trabalho
 *   custa 11–15 s por foto (~40 min) — e o Chrome do Felipe está assim hoje.
 *
 * TAMANHO É TUDO. Encolhendo a MESMA foto (identidade constante, só muda o
 *   número de pixels), a distância do rosto para ele mesmo cresce assim:
 *
 *     95px 0,127 · 79px 0,177 · 62px 0,182 · 51px 0,187
 *     40px 0,307 · 31px 0,329 · 26px 0,450 · 20px 0,592
 *
 *   Ao mesmo tempo, a distância entre pessoas DIFERENTES encolhe. As duas
 *   curvas se cruzam entre 40 e 50 px: em 51 px a folga é ~0,4; em 31 px as
 *   distribuições já se sobrepõem e o vetor não distingue mais ninguém.
 *
 * O ERRO QUE ISSO CAUSA, VERIFICADO COM OS OLHOS. Em 7 fotos de 7 casamentos
 *   diferentes, 14 pares de estranhos ficaram abaixo do limiar de 0,6. Todos
 *   envolviam rosto de ≤38 px. O pior: uma mulher de cabelo longo e um homem
 *   barbudo, a 0,241 — a mesma faixa de distância de um acerto legítimo.
 *   Nenhum par com os dois rostos ≥59 px caiu abaixo de 0,6.
 *
 * ESPELHO É O MAIOR RISCO DA SELFIE, e não é óbvio. Câmera frontal de celular
 *   grava espelhado. Espelhar o recorte custa 0,23 a 0,55 de distância sozinho —
 *   mais que qualquer outra deformação de captura medida:
 *
 *     espelho 0,226–0,550 · girado 8° 0,204–0,282 · JPEG 40% 0,169–0,230
 *     mais claro 0,103–0,209 · mais escuro 0,062–0,181
 *
 *   Luz e compressão são baratas. Espelho come metade do orçamento antes de a
 *   pessoa ter mudado de roupa. Quem construir isto tem de desespelhar a selfie
 *   ou guardar os dois vetores.
 *
 * O DETECTOR GRANDE É SÓ DO FOTÓGRAFO. Quando o `tiny` (0,19 MB) acha o rosto,
 *   o vetor bate com o do SSD (5,6 MB) em 0,08–0,23 — a escolha de detector não
 *   muda o vetor. Na selfie o rosto ocupa a tela, que é o caso fácil, então o
 *   convidado baixa 7,0 MB em vez de 12,4 MB.
 *
 * ── O QUE CONTINUA SEM PROVA ──────────────────────────────────────────────
 *
 * Nenhuma medição aqui usa duas fotos reais da mesma pessoa em dias diferentes;
 * esse par não existe no material. Tudo acima é o MELHOR caso. Antes de
 * construir o recurso, falta exatamente um teste: uma selfie de hoje contra uma
 * foto de uma galeria real.
 *
 * ── ARMADILHAS DO NAVEGADOR EMBUTIDO ──────────────────────────────────────
 *
 * Num renderizador sem janela visível, três coisas simplesmente nunca resolvem,
 * sem erro e sem log: `img.decode()`, `canvas.toBlob()` e `fetch()` de uma URL
 * `data:`. Cada uma custou uma rodada de depuração. Por isso o código usa
 * `createImageBitmap` e `toDataURL` + `atob`, e por isso cada passo é anotado em
 * `window.__spike` — o estado do React não pinta enquanto o tfjs ocupa a thread.
 */
export default function SpikeRostosPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Spike — reconhecimento de rosto</h1>
      <p className="mt-1 text-sm text-texto-soft">
        Bancada de medição. Roda nas fotos da home e mede tamanho mínimo de rosto, falso positivo
        entre estranhos, deformações de captura e qual detector o convidado precisa baixar.
      </p>
      <SpikeRostos />
    </main>
  );
}
