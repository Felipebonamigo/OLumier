#!/usr/bin/env node
/**
 * Testa a TROCA DE DOCUMENTO (`scripts/trocar-documento.mjs`) contra um Asaas
 * de mentira: o cliente da Galeria tem o documento trocado; o de outro produto
 * (o do Atomatiza, na mesma conta) é recusado sem escrita nenhuma — trocar o
 * documento dele mudaria a outra plataforma por uma decisão tomada aqui.
 *
 * Uso: node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-trocar-documento.mjs
 */
import { createServer } from "node:http";

process.env.ASAAS_API_KEY = "chave-de-mentira";
delete process.env.ASAAS_AMBIENTE;

const clientes = [
  { id: "cus_nosso", cpfCnpj: "02460261039", externalReference: "olumier:t-1" },
  { id: "cus_atz", cpfCnpj: "45041663000192", externalReference: "atz:sub:st-1" },
];
const escritas = [];

const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (p) => (corpo += p));
  req.on("end", () => {
    const m = /^\/customers\/([^/?]+)$/.exec(new URL(req.url, "http://x").pathname);
    const c = m && clientes.find((x) => x.id === m[1]);
    res.writeHead(c ? 200 : 404, { "Content-Type": "application/json" });
    if (c && req.method === "POST") {
      escritas.push({ id: c.id, corpo: JSON.parse(corpo) });
      Object.assign(c, JSON.parse(corpo));
    }
    res.end(JSON.stringify(c ?? { errors: [{ description: "não achei" }] }));
  });
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
process.env.ASAAS_API = `http://127.0.0.1:${servidor.address().port}`;

const { trocarDocumentoDoCliente } = await import("../src/lib/asaas.ts");

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

console.log("\nTroca de documento:\n");

await etapa("o cliente da Galeria recebe o documento novo, só com dígitos", async () => {
  await trocarDocumentoDoCliente("cus_nosso", "45.041.663/0001-92");
  const e = escritas.at(-1);
  if (e?.id !== "cus_nosso" || e.corpo.cpfCnpj !== "45041663000192") throw new Error(JSON.stringify(escritas));
});

await etapa("o cliente de outro produto é recusado, sem escrever nada", async () => {
  const antes = escritas.length;
  let erro = null;
  try {
    await trocarDocumentoDoCliente("cus_atz", "02460261039");
  } catch (e) {
    erro = e.message;
  }
  if (!erro?.includes("não é da Galeria")) throw new Error(`esperava recusa, veio ${erro}`);
  if (escritas.length !== antes) throw new Error("escreveu no cliente do Atomatiza");
});

servidor.close();
if (falhou) process.exit(1);
console.log("\n✓ Troca de documento conferida.");
