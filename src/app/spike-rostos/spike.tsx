"use client";

import { useState } from "react";

/*
 * ── O QUE ESTE SPIKE AINDA PRECISA DECIDIR ────────────────────────────────
 *
 * Já está medido: o SSD detecta bem, custa ~1 s por foto com WebGL, e o vetor
 * do mesmo rosto sobrevive à redução da foto. Também está medido que rostos
 * pequenos produzem vetores que COLIDEM: 11 de 36 pares de pessoas diferentes
 * ficaram abaixo do limiar de 0,6, e dez deles envolviam rosto de ≤31 px.
 *
 * Sobraram três perguntas, e cada uma muda uma decisão de produto:
 *
 *   A. Onde exatamente fica o corte de tamanho? Medir isso comparando rostos de
 *      pessoas diferentes confunde duas coisas — pode ser o tamanho ou pode ser
 *      a pessoa. Aqui a MESMA foto é reduzida em degraus, então a identidade é
 *      constante e só o número de pixels muda. O que sobra na conta é o efeito
 *      do tamanho, limpo.
 *
 *   B. Duas fotos diferentes da mesma pessoa casam? É a pergunta que decide o
 *      recurso inteiro e que eu ainda não tinha respondido. Se as fotos da home
 *      forem do mesmo ensaio, cada par abaixo de 0,6 é um acerto real; se forem
 *      de casamentos diferentes, cada par abaixo de 0,6 é um FALSO positivo
 *      entre estranhos. Os dois casos são informação — e só olhando os recortes
 *      dá para saber qual é qual, por isso eles são gravados em disco.
 *
 *   C. O convidado precisa baixar o detector grande? O SSD tem 5,6 MB; o
 *      `tiny` tem 0,19 MB. Na selfie o rosto ocupa a tela inteira, que é o caso
 *      fácil. Se o `tiny` achar o rosto e gerar o mesmo vetor, o download do
 *      convidado cai de 12,4 MB para 7,0 MB.
 *
 * ── O QUE CONTINUA SEM PROVA ──────────────────────────────────────────────
 *
 * Nada aqui simula outro dia, outra luz, barba ou maquiagem. Mesmo o item B usa
 * fotos do mesmo evento, com a mesma luz e o mesmo cabelo. O número real de um
 * convidado tirando selfie meses depois é pior que qualquer coisa medida aqui.
 */

const FOTOS = [
  "/home/noivos-beijo.jpg",
  "/home/festa-mesa.jpg",
  "/home/noiva-retrato.jpg",
  "/home/cerimonia-arco.jpg",
  "/home/hero-casamento.jpg",
  "/home/madrinhas.jpg",
  "/home/vestido.jpg",
];

const LIMIAR = 0.6;
const LADO_PREVIA = 2048;
const ESCALAS = [0.85, 0.7, 0.55, 0.45, 0.35, 0.28, 0.22, 0.17];
const LADO_SELFIE = 320;

interface Linha {
  rotulo: string;
  px: number;
  distancia: number;
  ok: boolean;
  nota: string;
}

function Tabela({ titulo, linhas }: { titulo: string; linhas: Linha[] }) {
  if (linhas.length === 0) return null;
  return (
    <div className="mt-6">
      <p className="font-mono text-[11px] uppercase tracking-widest text-texto-faint">{titulo}</p>
      <table className="mt-2 w-full font-mono text-xs">
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className="border-t border-linha">
              <td className="py-1 pr-4">{l.rotulo}</td>
              <td className="py-1 pr-4 text-right tabular-nums">{l.px} px</td>
              <td className="py-1 pr-4 text-right tabular-nums">
                {Number.isNaN(l.distancia) ? "—" : l.distancia.toFixed(3)}
              </td>
              <td className={`py-1 ${l.ok ? "text-ok" : "text-erro"}`}>{l.nota}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SpikeRostos() {
  const [diag, setDiag] = useState<string[]>([]);
  const [curva, setCurva] = useState<Linha[]>([]);
  const [cruzado, setCruzado] = useState<Linha[]>([]);
  const [pequeno, setPequeno] = useState<Linha[]>([]);
  const [captura, setCaptura] = useState<Linha[]>([]);
  const [estado, setEstado] = useState("");

  /*
   * O estado do React não serve para acompanhar isto de fora: enquanto o tfjs
   * ocupa a thread nada re-renderiza. Cada passo também vai para `window.__spike`.
   */
  function marcar(texto: string) {
    const w = window as unknown as { __spike?: string[] };
    w.__spike = w.__spike ?? [];
    w.__spike.push(texto);
    setEstado(texto);
  }

  async function rodar() {
    try {
      await medir();
    } catch (e) {
      marcar(`ERRO: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function medir() {
    marcar("carregando…");
    setDiag([]);
    setCurva([]);
    setCruzado([]);
    setPequeno([]);
    setCaptura([]);

    const faceapi = await import("@vladmandic/face-api");
    const tf = faceapi.tf as unknown as {
      setBackend: (n: string) => Promise<boolean>;
      ready: () => Promise<void>;
      getBackend: () => string;
    };

    for (const nome of ["webgl", "wasm", "cpu"]) {
      try {
        if (await tf.setBackend(nome)) {
          await tf.ready();
          if (tf.getBackend() === nome) break;
        }
      } catch {
        /* segue para o próximo */
      }
    }

    const notas = [`backend: ${tf.getBackend()}`, `limiar: ${LIMIAR}`];
    setDiag([...notas]);

    marcar("baixando modelos…");
    await faceapi.nets.ssdMobilenetv1.loadFromUri("/modelos-rosto");
    await faceapi.nets.tinyFaceDetector.loadFromUri("/modelos-rosto");
    await faceapi.nets.faceLandmark68Net.loadFromUri("/modelos-rosto");
    await faceapi.nets.faceRecognitionNet.loadFromUri("/modelos-rosto");

    const dist = (a: Float32Array, b: Float32Array) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
      return Math.sqrt(s);
    };

    /*
     * `new Image()` + `decode()` não serve: num renderizador sem janela visível
     * a promessa nunca resolve e o teste morre em silêncio. `createImageBitmap`
     * decodifica fora do pipeline de pintura.
     */
    const bitmaps = new Map<string, ImageBitmap>();
    async function bitmapDe(url: string) {
      let b = bitmaps.get(url);
      if (!b) {
        b = await createImageBitmap(await (await fetch(url)).blob());
        bitmaps.set(url, b);
      }
      return b;
    }

    function desenhar(bmp: ImageBitmap, lado: number) {
      const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * escala);
      c.height = Math.round(bmp.height * escala);
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      return c;
    }

    const comSsd = (alvo: HTMLCanvasElement, confianca: number) =>
      faceapi
        .detectAllFaces(alvo, new faceapi.SsdMobilenetv1Options({ minConfidence: confianca }))
        .withFaceLandmarks()
        .withFaceDescriptors();

    const comTiny = (alvo: HTMLCanvasElement) =>
      faceapi
        .detectAllFaces(
          alvo,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }),
        )
        .withFaceLandmarks()
        .withFaceDescriptors();

    async function salvar(nome: string, canvas: HTMLCanvasElement) {
      await fetch("/api/spike-salvar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome, dataUrl: canvas.toDataURL("image/jpeg", 0.85) }),
      });
    }

    /*
     * O recorte do rosto, com folga de 60%: o detector precisa de testa, queixo e
     * orelha para assentar os 68 pontos. Recorte colado no rosto derruba a
     * detecção e passaria a medir outra coisa.
     */
    function recortar(
      origem: HTMLCanvasElement,
      caixa: { x: number; y: number; width: number; height: number },
      lado: number,
    ) {
      const folga = 0.6;
      const x = Math.max(0, caixa.x - caixa.width * folga);
      const y = Math.max(0, caixa.y - caixa.height * folga);
      const w = Math.min(origem.width - x, caixa.width * (1 + folga * 2));
      const h = Math.min(origem.height - y, caixa.height * (1 + folga * 2));
      const escala = lado / Math.max(w, h);
      const c = document.createElement("canvas");
      c.width = Math.round(w * escala);
      c.height = Math.round(h * escala);
      c.getContext("2d")!.drawImage(origem, x, y, w, h, 0, 0, c.width, c.height);
      return c;
    }

    // ── inventário: todo rosto de todas as fotos, no tamanho da prévia ───────
    interface Rosto {
      foto: string;
      i: number;
      px: number;
      caixa: { x: number; y: number; width: number; height: number };
      vetor: Float32Array;
      tela: HTMLCanvasElement;
    }
    const rostos: Rosto[] = [];

    for (const url of FOTOS) {
      const nome = url.split("/").pop()!.replace(".jpg", "");
      marcar(`${nome}: detectando…`);
      const tela = desenhar(await bitmapDe(url), LADO_PREVIA);
      const achados = await comSsd(tela, 0.4);
      notas.push(`${nome} ${tela.width}x${tela.height}: ${achados.length} rostos`);
      setDiag([...notas]);

      for (let i = 0; i < achados.length; i++) {
        const caixa = achados[i].detection.box;
        rostos.push({
          foto: nome,
          i: i + 1,
          px: Math.round(caixa.width),
          caixa,
          vetor: achados[i].descriptor,
          tela,
        });
        // Gravado em disco para eu conferir identidade com os olhos, não com fé.
        await salvar(`${nome}-${i + 1}-${Math.round(caixa.width)}px.jpg`, recortar(tela, caixa, 200));
      }
    }
    marcar(`${rostos.length} rostos no total`);

    // ── A. curva tamanho × qualidade, com a identidade fixa ──────────────────
    marcar("A: curva de tamanho…");
    const maior = rostos.reduce((a, b) => (b.px > a.px ? b : a));
    notas.push(`curva medida em ${maior.foto} #${maior.i} (${maior.px}px de referência)`);
    setDiag([...notas]);

    const linhasCurva: Linha[] = [];
    const bmpCurva = await bitmapDe(`/home/${maior.foto}.jpg`);
    for (const escala of ESCALAS) {
      const menor = desenhar(bmpCurva, Math.round(LADO_PREVIA * escala));
      const fator = maior.tela.width / menor.width;
      const nesteLado = await comSsd(menor, 0.4);

      const alvoX = maior.caixa.x + maior.caixa.width / 2;
      const alvoY = maior.caixa.y + maior.caixa.height / 2;
      let melhor: (typeof nesteLado)[number] | null = null;
      let melhorDist = Infinity;
      for (const c of nesteLado) {
        const cx = (c.detection.box.x + c.detection.box.width / 2) * fator;
        const cy = (c.detection.box.y + c.detection.box.height / 2) * fator;
        const p = Math.hypot(cx - alvoX, cy - alvoY);
        if (p < melhorDist) {
          melhorDist = p;
          melhor = c;
        }
      }

      const achou = melhor !== null && melhorDist < maior.caixa.width * 0.5;
      const px = achou ? Math.round(melhor!.detection.box.width) : Math.round(maior.px / fator);
      const d = achou ? dist(maior.vetor, melhor!.descriptor) : NaN;
      linhasCurva.push({
        rotulo: `${Math.round(escala * 100)}% da prévia`,
        px,
        distancia: d,
        ok: achou && d < LIMIAR,
        nota: achou ? (d < LIMIAR ? "casou" : "NÃO casou") : "não detectou",
      });
      setCurva([...linhasCurva]);
    }

    // ── B. mesma pessoa entre fotos diferentes? ──────────────────────────────
    marcar("B: cruzando fotos…");
    const linhasCruzado: Linha[] = [];
    for (let a = 0; a < rostos.length; a++) {
      for (let b = a + 1; b < rostos.length; b++) {
        if (rostos[a].foto === rostos[b].foto) continue; // par dentro da foto já foi medido
        const d = dist(rostos[a].vetor, rostos[b].vetor);
        if (d > 0.75) continue; // longe de todo jeito, não informa nada
        linhasCruzado.push({
          rotulo: `${rostos[a].foto}#${rostos[a].i} × ${rostos[b].foto}#${rostos[b].i}`,
          px: Math.min(rostos[a].px, rostos[b].px),
          distancia: d,
          ok: d > LIMIAR,
          nota: d < LIMIAR ? "APONTA MESMA PESSOA" : "separou",
        });
      }
    }
    linhasCruzado.sort((x, y) => x.distancia - y.distancia);
    setCruzado(linhasCruzado);

    // ── C. o detector pequeno basta para a selfie do convidado? ──────────────
    marcar("C: detector pequeno…");
    const linhasPequeno: Linha[] = [];
    for (const r of rostos) {
      if (r.px < 40) continue; // rosto pequeno já foi reprovado por outro motivo
      const selfie = recortar(r.tela, r.caixa, LADO_SELFIE);
      const t = await comTiny(selfie);
      const d = t[0] ? dist(r.vetor, t[0].descriptor) : NaN;
      linhasPequeno.push({
        rotulo: `${r.foto} #${r.i}`,
        px: r.px,
        distancia: d,
        ok: Boolean(t[0]) && d < LIMIAR,
        nota: t[0] ? (d < LIMIAR ? "tiny serve" : "tiny diverge") : "tiny não achou",
      });
      setPequeno([...linhasPequeno]);
    }

    /*
     * ── D. o que a CAPTURA faz com o vetor ──────────────────────────────────
     *
     * O teste que faltava não é de tamanho, é de deformação. A selfie do
     * convidado difere da foto do casamento por coisas que dá para medir agora:
     *
     *   espelho — câmera frontal de celular grava espelhado por padrão. Se o
     *     vetor não sobreviver a isso, TODA selfie falha, e nenhum ajuste de
     *     limiar salva;
     *   brilho — sala escura contra sol da cerimônia;
     *   JPEG 40% — o que sobra depois de a foto passar pelo WhatsApp;
     *   rotação — ninguém segura o celular no prumo.
     *
     * Aqui o recorte fica no tamanho NATIVO e a referência é o próprio recorte
     * sem deformação. Assim a única diferença entre os dois vetores é a
     * deformação — não o enquadramento, não a escala.
     */
    marcar("D: deformações de captura…");
    const linhasCaptura: Linha[] = [];

    function transformar(
      origem: HTMLCanvasElement,
      como: (ctx: CanvasRenderingContext2D, c: HTMLCanvasElement) => void,
    ) {
      const c = document.createElement("canvas");
      c.width = origem.width;
      c.height = origem.height;
      const ctx = c.getContext("2d")!;
      como(ctx, c);
      ctx.drawImage(origem, 0, 0);
      return c;
    }

    const DEFORMACOES: Array<[string, (o: HTMLCanvasElement) => HTMLCanvasElement]> = [
      ["espelho", (o) => transformar(o, (ctx, c) => { ctx.translate(c.width, 0); ctx.scale(-1, 1); })],
      ["mais claro", (o) => transformar(o, (ctx) => { ctx.filter = "brightness(1.35)"; })],
      ["mais escuro", (o) => transformar(o, (ctx) => { ctx.filter = "brightness(0.65)"; })],
      ["girado 8°", (o) => transformar(o, (ctx, c) => {
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate((8 * Math.PI) / 180);
        ctx.translate(-c.width / 2, -c.height / 2);
      })],
    ];

    for (const r of rostos) {
      if (r.px < 50) continue;
      /*
       * Recorte no tamanho nativo: ampliar introduziria borrão e mediria isso.
       * O lado pedido é a ALTURA da caixa com folga, não a largura — rosto é mais
       * alto que largo, e pedir pela largura encolheria o recorte em vez de o
       * manter nativo.
       */
      const nativo = recortar(r.tela, r.caixa, Math.round(r.caixa.height * 2.2));
      marcar(`D ${r.foto}#${r.i}: recorte ${nativo.width}x${nativo.height}`);
      const base = await comSsd(nativo, 0.3);
      if (!base[0]) {
        marcar(`D ${r.foto}#${r.i}: base não detectou, pulando`);
        continue;
      }

      for (const [nome, deformar] of DEFORMACOES) {
        marcar(`D ${r.foto}#${r.i}: ${nome}…`);
        const alterado = await comSsd(deformar(nativo), 0.3);
        const d = alterado[0] ? dist(base[0].descriptor, alterado[0].descriptor) : NaN;
        linhasCaptura.push({
          rotulo: `${r.foto}#${r.i} · ${nome}`,
          px: r.px,
          distancia: d,
          ok: Boolean(alterado[0]) && d < LIMIAR,
          nota: alterado[0] ? (d < LIMIAR ? "sobreviveu" : "QUEBROU") : "sumiu",
        });
      }

      /*
       * JPEG a 40% precisa passar por arquivo de verdade, não por filtro.
       * `toBlob` em vez de `fetch(dataURL)`: buscar uma URL `data:` é mais um
       * caminho que depende do pipeline de rede da aba e pode simplesmente não
       * responder num renderizador sem janela — o mesmo tropeço do `decode()`.
       */
      marcar(`D ${r.foto}#${r.i}: JPEG…`);
      const url = nativo.toDataURL("image/jpeg", 0.4);
      const bruto = atob(url.slice(url.indexOf(",") + 1));
      const bytes = new Uint8Array(bruto.length);
      for (let k = 0; k < bruto.length; k++) bytes[k] = bruto.charCodeAt(k);
      const jpeg = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      const telaJpeg = document.createElement("canvas");
      telaJpeg.width = jpeg.width;
      telaJpeg.height = jpeg.height;
      telaJpeg.getContext("2d")!.drawImage(jpeg, 0, 0);
      const apos = await comSsd(telaJpeg, 0.3);
      const dj = apos[0] ? dist(base[0].descriptor, apos[0].descriptor) : NaN;
      linhasCaptura.push({
        rotulo: `${r.foto}#${r.i} · JPEG 40%`,
        px: r.px,
        distancia: dj,
        ok: Boolean(apos[0]) && dj < LIMIAR,
        nota: apos[0] ? (dj < LIMIAR ? "sobreviveu" : "QUEBROU") : "sumiu",
      });
      setCaptura([...linhasCaptura]);
    }

    for (const l of linhasCaptura)
      marcar(`D ${l.rotulo} ${l.px}px ${l.distancia.toFixed(3)} ${l.nota}`);
    for (const l of linhasCurva) marcar(`A ${l.rotulo} ${l.px}px ${l.distancia.toFixed(3)} ${l.nota}`);
    for (const l of linhasCruzado)
      marcar(`B ${l.rotulo} ${l.px}px ${l.distancia.toFixed(3)} ${l.nota}`);
    for (const l of linhasPequeno)
      marcar(`C ${l.rotulo} ${l.px}px ${l.distancia.toFixed(3)} ${l.nota}`);
    marcar("pronto");
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={rodar}
        className="rounded-lg bg-acento px-5 py-2.5 text-sm font-semibold text-void"
      >
        Medir
      </button>
      <p className="mt-3 font-mono text-xs text-texto-soft">{estado}</p>

      {diag.length > 0 && (
        <pre className="mt-4 overflow-x-auto rounded-lg border border-linha bg-void p-4 font-mono text-[11px] leading-relaxed text-texto-soft">
          {diag.join("\n")}
        </pre>
      )}

      <Tabela titulo="A · mesmo rosto encolhendo — onde o vetor quebra" linhas={curva} />
      <Tabela titulo="B · rostos de fotos diferentes que ficaram perto" linhas={cruzado} />
      <Tabela titulo="C · detector pequeno na selfie (economiza 5,4 MB)" linhas={pequeno} />
      <Tabela titulo="D · deformações de captura — espelho, luz, JPEG, rotação" linhas={captura} />
    </div>
  );
}
