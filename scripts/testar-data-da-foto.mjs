#!/usr/bin/env node
/**
 * O LEITOR DE EXIF — a data em que a foto foi tirada. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *        scripts/testar-data-da-foto.mjs
 *
 * ── POR QUE ESTE TESTE MONTA OS ARQUIVOS EM VEZ DE GUARDAR UM .jpg ────────
 *
 * Porque o que precisa ser exercitado são os CASOS, e cada caso é um
 * cabeçalho diferente: little-endian e big-endian (Canon escreve II, Nikon
 * costuma escrever MM), data no IFD do Exif e data só no IFD0, arquivo sem
 * EXIF nenhum, arquivo truncado, relógio zerado. Guardar seis JPEGs binários
 * no repositório esconderia justamente o byte que importa.
 *
 * O leitor é `lib/exif-client.ts`. Ele não estoura nunca: tudo que não dá para
 * ler vira `null`, e quem ordena cai na data de envio.
 */
const { dataDaFoto } = await import("../src/lib/exif-client.ts");

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

/**
 * Monta um JPEG com um APP1/Exif de verdade.
 *
 * @param texto     o que vai na tag de data ("2026:09:14 18:32:07")
 * @param le        little-endian ("II") ou big ("MM")
 * @param noExifIfd true = DateTimeOriginal no IFD do Exif; false = DateTime no IFD0
 */
function jpegComExif(texto, { le = true, noExifIfd = true } = {}) {
  const tiff = [];
  const u16 = (n) => (le ? [n & 0xff, (n >> 8) & 0xff] : [(n >> 8) & 0xff, n & 0xff]);
  const u32 = (n) =>
    le
      ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
      : [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

  /* Cabeçalho TIFF: ordem, 42, deslocamento do IFD0 (logo depois, em 8). */
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));

  const data = [...Buffer.from(texto, "ascii"), 0]; // ASCII com o \0 do EXIF
  const campo = (tag, tipo, quantas, valor) => [...u16(tag), ...u16(tipo), ...u32(quantas), ...valor];

  if (noExifIfd) {
    /* IFD0 com um campo só: o ponteiro para o IFD do Exif.
       8 (cabeçalho) + 2 (contagem) + 12 (campo) + 4 (próximo IFD) = 26. */
    const ifdExif = 26;
    tiff.push(...u16(1), ...campo(0x8769, 4, 1, u32(ifdExif)), ...u32(0));
    /* IFD do Exif: um campo, a data, cujo valor mora logo depois do IFD.
       26 + 2 + 12 + 4 = 44. */
    tiff.push(...u16(1), ...campo(0x9003, 2, data.length, u32(44)), ...u32(0), ...data);
  } else {
    /* Só o IFD0, com DateTime (0x0132). Valor em 26. */
    tiff.push(...u16(1), ...campo(0x0132, 2, data.length, u32(26)), ...u32(0), ...data);
  }

  const app1 = [...Buffer.from("Exif", "ascii"), 0, 0, ...tiff];
  const tamanho = app1.length + 2;
  return new File(
    [
      Buffer.from([
        0xff, 0xd8, // SOI
        0xff, 0xe1, (tamanho >> 8) & 0xff, tamanho & 0xff, // APP1
        ...app1,
        0xff, 0xda, 0x00, 0x02, // SOS: daqui em diante são pixels
      ]),
    ],
    "foto.jpg",
    { type: "image/jpeg" },
  );
}

console.log("\nA data em que a foto foi tirada:\n");

await etapa("lê DateTimeOriginal de um JPEG little-endian (Canon, Sony)", async () => {
  const d = await dataDaFoto(jpegComExif("2026:09:14 18:32:07"));
  if (!d) throw new Error("não leu");
  if (d.getFullYear() !== 2026 || d.getMonth() !== 8 || d.getDate() !== 14) {
    throw new Error(`leu ${d.toISOString()}`);
  }
  if (d.getHours() !== 18 || d.getMinutes() !== 32) throw new Error(`hora ${d.toTimeString()}`);
  return d.toLocaleString("pt-BR");
});

await etapa("lê o mesmo arquivo em big-endian (Nikon)", async () => {
  const d = await dataDaFoto(jpegComExif("2026:09:14 18:32:07", { le: false }));
  if (!d) throw new Error("não leu o big-endian");
  if (d.getHours() !== 18 || d.getDate() !== 14) throw new Error(`leu ${d.toISOString()}`);
  return "MM lido igual ao II";
});

await etapa("sem DateTimeOriginal, cai no DateTime do IFD0", async () => {
  const d = await dataDaFoto(jpegComExif("2026:03:21 09:05:00", { noExifIfd: false }));
  if (!d) throw new Error("não leu a reserva");
  if (d.getMonth() !== 2 || d.getDate() !== 21) throw new Error(`leu ${d.toISOString()}`);
  return "reserva usada";
});

await etapa("relógio zerado da câmera é RECUSADO", async () => {
  /* Câmera sem bateria de relógio grava 1980. Aceitar isso joga a foto para o
     começo da galeria e estraga a sequência inteira — pior que não saber. */
  const d = await dataDaFoto(jpegComExif("1980:01:01 00:00:00"));
  if (d) throw new Error(`aceitou ${d.toISOString()}`);
  return "null, e a ordenação cai no envio";
});

await etapa("data no futuro é recusada", async () => {
  const ano = new Date().getFullYear() + 3;
  const d = await dataDaFoto(jpegComExif(`${ano}:01:01 12:00:00`));
  if (d) throw new Error(`aceitou ${d.toISOString()}`);
  return "null";
});

await etapa("JPEG sem EXIF nenhum devolve null, sem estourar", async () => {
  const f = new File([Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])], "x.jpg", {
    type: "image/jpeg",
  });
  if (await dataDaFoto(f)) throw new Error("inventou uma data");
  return "null";
});

await etapa("arquivo truncado no meio do EXIF devolve null", async () => {
  const inteiro = jpegComExif("2026:09:14 18:32:07");
  const cortado = new File([(await inteiro.arrayBuffer()).slice(0, 20)], "x.jpg", {
    type: "image/jpeg",
  });
  if (await dataDaFoto(cortado)) throw new Error("leu um arquivo cortado");
  return "null";
});

await etapa("vídeo e PNG nem são abertos", async () => {
  for (const tipo of ["video/mp4", "image/png", "image/heic"]) {
    const f = new File([Buffer.from([1, 2, 3, 4])], "x", { type: tipo });
    if (await dataDaFoto(f)) throw new Error(`${tipo} devolveu data`);
  }
  return "3 tipos ignorados";
});

console.log(falhou ? "\n✗ o leitor de EXIF tem problema" : "\n✓ data da foto ok");
process.exit(falhou ? 1 : 0);
