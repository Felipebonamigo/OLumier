#!/usr/bin/env node
/**
 * Copia os pesos do reconhecimento facial para `public/modelos-rosto/`.
 *
 * Roda sozinho no `postinstall`, então dev e produção ganham os arquivos no
 * mesmo `npm ci` que traz o pacote — e o git fica sem 13 MB de binário que é
 * cópia exata de algo que já está em `node_modules`.
 *
 * Só os QUATRO modelos que o produto usa. O pacote traz também idade, gênero,
 * expressão e o landmark "tiny": nada disso entra, e não é por espaço — é por
 * não colocar em produção um modelo que estima gênero e idade de convidado sem
 * ninguém ter pedido.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ORIGEM = path.join(RAIZ, "node_modules", "@vladmandic", "face-api", "model");
const DESTINO = path.join(RAIZ, "public", "modelos-rosto");

const MODELOS = [
  "ssd_mobilenetv1_model", // detector do fotógrafo (acha rosto pequeno)
  "tiny_face_detector_model", // detector do convidado (selfie: rosto grande)
  "face_landmark_68_model", // os 68 pontos que alinham o rosto
  "face_recognition_model", // o vetor de 128 números
];

if (!existsSync(ORIGEM)) {
  // `npm ci --omit=dev` ou pacote ausente: não é erro deste script.
  console.log("modelos-rosto: pacote @vladmandic/face-api ausente, nada copiado");
  process.exit(0);
}

mkdirSync(DESTINO, { recursive: true });

let copiados = 0;
for (const arquivo of readdirSync(ORIGEM)) {
  if (!MODELOS.some((m) => arquivo.startsWith(m))) continue;
  copyFileSync(path.join(ORIGEM, arquivo), path.join(DESTINO, arquivo));
  copiados++;
}
console.log(`modelos-rosto: ${copiados} arquivo(s) em public/modelos-rosto/`);
