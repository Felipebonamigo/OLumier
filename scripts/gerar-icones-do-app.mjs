#!/usr/bin/env node
/**
 * GERA OS ÍCONES DO APP (tela de início do celular e o manifesto). Uso:
 *   node scripts/gerar-icones-do-app.mjs
 *
 * ── POR QUE EXISTE (01/10/2026) ───────────────────────────────────────────
 *
 * Felipe, com a foto da tela de início do iPhone: "o atalho não está igual o
 * logo". Era um "G" branco num quadrado preto — o iPhone INVENTA esse ícone
 * quando o site não entrega um `apple-touch-icon` em PNG. O site só tinha
 * `app/icon.svg`, que é o da aba do navegador: o iOS não usa SVG na tela de
 * início.
 *
 * O desenho é o MESMO símbolo de `components/marca-tile.tsx` — três órbitas,
 * a câmera no núcleo e o único âmbar na lente —, em versão grande, sobre o
 * fundo escuro do `icon.svg`. Mudou lá, rode isto de novo.
 *
 * Quadrado cheio, SEM cantos arredondados: o iPhone e o Android recortam o
 * ícone com a máscara deles, e canto desenhado aqui viraria uma borda dupla.
 * O "maskable" tem mais margem porque o Android pode recortar em círculo — a
 * zona segura é o círculo de 80% do lado.
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const FUNDO = "#07080b";
const TRACO = "#cfd9ea";
const LUZ = "#d9a441";

/** O símbolo no quadro 48×48 de `MarcaSimbolo`, sem animação (ícone é parado). */
function simbolo() {
  const orbitas = [30, 90, 150]
    .map(
      (g) =>
        `<ellipse cx="24" cy="24" rx="15.4" ry="6" transform="rotate(${g} 24 24)" stroke="${TRACO}" stroke-width="1.3" fill="none" opacity="${g === 90 ? 0.85 : 1}"/>`,
    )
    .join("");
  const eletrons = [
    [37.34, 31.7],
    [24, 8.6],
    [10.66, 31.7],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.35" fill="${TRACO}"/>`)
    .join("");
  return `
    <defs>
      <mask id="furo" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
        <rect width="48" height="48" fill="#fff"/>
        <circle cx="24" cy="24" r="8.3" fill="#000"/>
      </mask>
    </defs>
    <g mask="url(#furo)">${orbitas}${eletrons}</g>
    <circle cx="24" cy="24" r="7.5" fill="none" stroke="${TRACO}" stroke-width="1.6"/>
    <rect x="19.6" y="21.7" width="8.8" height="5.6" rx="1.1" fill="none" stroke="${TRACO}" stroke-width="1.25"/>
    <path d="M 22.4 21.7 L 23.1 20.4 L 24.9 20.4 L 25.6 21.7" fill="none" stroke="${TRACO}" stroke-width="1.1" stroke-linejoin="round"/>
    <circle cx="24" cy="24.5" r="1.95" fill="none" stroke="${TRACO}" stroke-width="1.1"/>
    <circle cx="24" cy="24.5" r="0.95" fill="${LUZ}"/>`;
}

/** O ícone inteiro: fundo cheio e o símbolo ocupando `ocupa` do lado. */
function icone(lado, ocupa) {
  const escala = (lado * ocupa) / 48;
  const desloca = (lado - 48 * escala) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 ${lado} ${lado}">
    <rect width="${lado}" height="${lado}" fill="${FUNDO}"/>
    <g transform="translate(${desloca} ${desloca}) scale(${escala})">${simbolo()}</g>
  </svg>`);
}

const saidas = [
  /* O do iPhone. Fica em `public/`, e não como `app/apple-icon.png`: o arquivo
     no `app/` valeria para o site INTEIRO, inclusive a galeria do cliente — e
     lá quem aparece é a marca do fotógrafo, não a nossa. Quem liga este ícone
     é `config/app-instalado.ts`, só nas páginas da plataforma. */
  { arquivo: "public/icones/apple-touch-icon.png", lado: 180, ocupa: 0.82 },
  { arquivo: "public/icones/icone-192.png", lado: 192, ocupa: 0.82 },
  { arquivo: "public/icones/icone-512.png", lado: 512, ocupa: 0.82 },
  /* Maskable: o símbolo cabe no círculo de 80% do lado. */
  { arquivo: "public/icones/icone-maskable-512.png", lado: 512, ocupa: 0.62 },
];

mkdirSync(path.join(RAIZ, "public/icones"), { recursive: true });
for (const s of saidas) {
  await sharp(icone(1024, s.ocupa), { density: 300 })
    .resize(s.lado, s.lado)
    .png({ compressionLevel: 9 })
    .toFile(path.join(RAIZ, s.arquivo));
  console.log(`  ${s.arquivo} (${s.lado}×${s.lado})`);
}
