#!/usr/bin/env node
/**
 * O FORMATO DA ENTREGA — galeria, pastas ou stream (30/09/2026). Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-formato-da-entrega.mjs
 *
 * Sem banco e sem servidor: prende as regras que decidem o que o cliente vê,
 * que são as que quebrariam uma entrega sem ninguém perceber.
 *
 *   1. QUE TELA ABRE. Pastas com um grupo só e stream sem vídeo caem na
 *      galeria — o fotógrafo escolhe o formato antes de subir o casamento, e
 *      a entrega não pode ficar vazia no meio do caminho. Capítulo aberto,
 *      busca por rosto e "ver as fotos" sempre abrem a galeria.
 *
 *   2. O FORMATO NÃO ANDA COM O ESTILO. Aplicar um estilo pronto numa entrega
 *      em Stream troca a cara e deixa o Stream. E uma galeria com a cara do
 *      padrão do estúdio continua "no padrão" em qualquer formato.
 *
 *   3. GALERIA ENTREGUE NÃO MUDA. Aparência gravada antes do eixo lê como
 *      `galeria`, e valor estranho no JSON também.
 *
 *   4. O QUE O CARTÃO DO EPISÓDIO ESCREVE: título a partir do arquivo,
 *      duração legível e o ponto de retomada.
 */
const f = await import("../src/lib/formato-da-entrega.ts");
const ap = await import("../src/config/aparencia.ts");

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const extra = fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};
const igual = (a, b, oque) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`${oque}: esperado ${y}, veio ${x}`);
};

const nada = { capituloAberto: false, recorte: false, verGaleria: false };
const casamento = { grupos: 5, videos: 3 };

console.log("Formato da entrega:\n");

/* ── 1. que tela abre ───────────────────────────────────────────────────── */

etapa("galeria é sempre galeria", () => {
  igual(f.telaDaEntrega("galeria", casamento, nada), "galeria", "galeria");
});

etapa("pastas com dois ou mais grupos abre as pastas", () => {
  igual(f.telaDaEntrega("pastas", { grupos: 2, videos: 0 }, nada), "pastas", "dois grupos");
});

etapa("pastas com um grupo só cai na galeria", () => {
  igual(f.telaDaEntrega("pastas", { grupos: 1, videos: 0 }, nada), "galeria", "um grupo");
  igual(f.telaDaEntrega("pastas", { grupos: 0, videos: 0 }, nada), "galeria", "vazia");
});

etapa("dentro de uma pasta é a galeria, com a volta para as pastas", () => {
  const dentro = { ...nada, capituloAberto: true };
  igual(f.telaDaEntrega("pastas", casamento, dentro), "galeria", "tela");
  igual(f.voltaDaGaleria("pastas", casamento, dentro), "pastas", "volta");
});

etapa("stream com vídeo abre o stream; sem vídeo, a galeria", () => {
  igual(f.telaDaEntrega("stream", { grupos: 1, videos: 1 }, nada), "stream", "com vídeo");
  igual(f.telaDaEntrega("stream", { grupos: 3, videos: 0 }, nada), "galeria", "sem vídeo");
});

etapa("o 'ver as fotos' do stream abre a galeria, com a volta aos vídeos", () => {
  const fotos = { ...nada, verGaleria: true };
  igual(f.telaDaEntrega("stream", casamento, fotos), "galeria", "tela");
  igual(f.voltaDaGaleria("stream", casamento, fotos), "stream", "volta");
});

etapa("busca por rosto abre a galeria em qualquer formato, sem volta", () => {
  const rosto = { ...nada, recorte: true };
  for (const formato of ["galeria", "pastas", "stream"]) {
    igual(f.telaDaEntrega(formato, casamento, rosto), "galeria", formato);
    igual(f.voltaDaGaleria(formato, casamento, rosto), null, `volta de ${formato}`);
  }
});

etapa("sem tela de onde voltar, não há volta", () => {
  igual(f.voltaDaGaleria("galeria", casamento, { ...nada, capituloAberto: true }), null, "galeria");
  igual(
    f.voltaDaGaleria("pastas", { grupos: 1, videos: 0 }, { ...nada, capituloAberto: true }),
    null,
    "pastas de um grupo",
  );
  igual(f.voltaDaGaleria("stream", { grupos: 2, videos: 0 }, { ...nada, verGaleria: true }), null, "stream sem vídeo");
});

/* ── 2 e 3. o eixo na aparência ─────────────────────────────────────────── */

etapa("aparência antiga e valor estranho leem como galeria", () => {
  igual(ap.lerAparencia({}).formato, "galeria", "vazia");
  igual(ap.lerAparencia({ capa: "jornal" }).formato, "galeria", "gravada antes do eixo");
  igual(ap.lerAparencia({ formato: "netflix" }).formato, "galeria", "valor fora da lista");
  igual(ap.lerAparencia({ formato: "stream" }).formato, "stream", "stream gravado");
  igual(ap.lerAparencia({ formato: "pastas" }).formato, "pastas", "pastas gravado");
});

etapa("aplicar um estilo pronto mantém o formato da entrega", () => {
  const atual = ap.lerAparencia({ formato: "stream", tema: "claro" });
  const revista = ap.presetPorId("revista").aparencia;
  const depois = ap.comFormatoDe(revista, atual);
  igual(depois.formato, "stream", "formato");
  igual(depois.capa, revista.capa, "a cara é a do estilo");
});

etapa("formato não tira a galeria do estilo nem do padrão", () => {
  const revista = ap.presetPorId("revista").aparencia;
  igual(ap.presetEquivalente({ ...revista, formato: "pastas" }), "revista", "preset reconhecido");
  if (!ap.mesmaAparencia({ ...revista, formato: "stream" }, revista)) {
    throw new Error("mesma cara em formato diferente deixou de ser 'a mesma aparência'");
  }
  if (ap.mesmaAparencia({ ...revista, tema: "noite" }, revista)) {
    throw new Error("a comparação passou a ignorar mais que o formato");
  }
});

etapa("todo estilo pronto nasce em galeria", () => {
  const fora = ap.PRESETS.filter((p) => p.aparencia.formato !== "galeria").map((p) => p.id);
  igual(fora, [], "presets com outro formato");
});

/* ── 3b. o formato escolhido na criação da galeria ──────────────────────── */

etapa("criação sem estilo e em Galeria não grava nada (o '{}' de sempre)", () => {
  igual(ap.aparenciaComFormato(null, "galeria"), null, "galeria sem estilo");
  igual(ap.aparenciaComFormato(null, ""), null, "sem pedido");
});

etapa("criação sem estilo em Stream nasce em Stream, com o resto no padrão", () => {
  const gravada = ap.aparenciaComFormato(null, "stream");
  igual(ap.lerAparencia(gravada).formato, "stream", "formato");
  igual(ap.lerAparencia(gravada).capa, ap.APARENCIA_PADRAO.capa, "o resto é o padrão");
});

etapa("o formato escolhido agora vence o que veio no padrão do estúdio", () => {
  const padrao = { ...ap.presetPorId("revista").aparencia, formato: "stream" };
  const gravada = ap.lerAparencia(ap.aparenciaComFormato(padrao, "pastas"));
  igual(gravada.formato, "pastas", "formato");
  igual(gravada.capa, "jornal", "o estilo do padrão fica");
});

etapa("formato fora da lista não mexe no estilo escolhido", () => {
  const revista = ap.presetPorId("revista").aparencia;
  igual(ap.aparenciaComFormato(revista, "netflix"), revista, "estilo intacto");
  igual(ap.aparenciaComFormato(null, "netflix"), null, "sem estilo, nada");
});

/* ── 4. o cartão do episódio ────────────────────────────────────────────── */

etapa("título do episódio sai do nome do arquivo", () => {
  igual(f.tituloDoEpisodio("02_Filme_Casamento_Ana_e_Pedro.mp4"), "Filme Casamento Ana e Pedro", "numerado");
  igual(f.tituloDoEpisodio("Teaser.MOV"), "Teaser", "simples");
  igual(f.tituloDoEpisodio("2026 Casamento.mp4"), "2026 Casamento", "ano na frente fica");
  igual(f.tituloDoEpisodio("01.mp4"), "01", "só número");
});

etapa("duração legível, e nada quando não se sabe", () => {
  igual(f.duracaoLegivel(45), "45s", "segundos");
  igual(f.duracaoLegivel(8 * 60 + 10), "8min", "minutos");
  igual(f.duracaoLegivel(72 * 60), "1h 12min", "hora e minutos");
  igual(f.duracaoLegivel(3600), "1h", "hora cheia");
  igual(f.duracaoLegivel(null), null, "sem duração");
  igual(f.duracaoLegivel(0), null, "zero");
});

etapa("relógio do player", () => {
  igual(f.relogio(247), "4:07", "minutos");
  igual(f.relogio(3753), "1:02:33", "horas");
});

etapa("retomada: nem no começo, nem nos créditos", () => {
  igual(f.pontoDeRetomada(5, 600), 0, "abriu e fechou");
  igual(f.pontoDeRetomada(300, 600), 300, "no meio");
  igual(f.pontoDeRetomada(590, 600), 0, "nos créditos");
  igual(f.pontoDeRetomada(NaN, 600), 0, "lixo no armazenamento");
});

console.log(falhou ? "\n✗ formato da entrega com falha" : "\n✓ formato da entrega ok");
process.exit(falhou ? 1 : 0);
