#!/usr/bin/env node
/**
 * As contas de tráfego do painel de administração. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs scripts/testar-metricas-entrega.mjs
 *
 * Suíte PURA, no molde de `testar-metricas-admin.mjs`: as somas do mês são
 * montadas à mão, porque os casos que importam — o excedente, o VPS em uso, o
 * cache que não segura — não existem no banco de desenvolvimento.
 *
 * Felipe, 23/09/2026: "preciso ter no painel algo cuidando disso, para saber
 * se precisamos mudar algo, se o custo mudou". Então cada aviso que a tela
 * pode dar tem uma etapa que o provoca de propósito.
 */
import { resumoDeTrafego, custoServidorZipCentavos } from "../src/lib/metricas-entrega.ts";
import { relatorioDaEntrega } from "../src/lib/relatorio-semanal.ts";
import {
  FRANQUIA_SERVIDOR_ZIP_BYTES,
  FRANQUIA_VPS_BYTES,
  EXCEDENTE_B2_CENTAVOS_GB,
} from "../src/config/trafego.ts";
import { IOF, SPREAD_CARTAO } from "../src/config/custos-fixos.ts";

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};
const temAviso = (r, nivel, trecho) => {
  if (!r.avisos.some((a) => a.nivel === nivel && a.texto.includes(trecho))) {
    throw new Error(`faltou aviso ${nivel} com "${trecho}": ${r.avisos.map((a) => a.texto).join(" | ")}`);
  }
};
const semAviso = (r, trecho) => {
  if (r.avisos.some((a) => a.texto.includes(trecho))) throw new Error(`aviso indevido com "${trecho}"`);
};

const TB = 1000 ** 4;
const GB = 1000 ** 3;
const somas = (over = {}) => ({
  montadosN: 0,
  montadosBytes: 0,
  servidosServidorN: 0,
  servidosServidorBytes: 0,
  doCacheN: 0,
  doCacheBytes: 0,
  servidosVpsN: 0,
  servidosVpsBytes: 0,
  abortadosN: 0,
  abortadosBytes: 0,
  abortadosVpsBytes: 0,
  quedasN: 0,
  trechosBytes: 0,
  avulsosN: 0,
  bytesPorMedia: 5 * 1024 * 1024,
  guardaveisServidosN: 0,
  guardaveisDoCacheN: 0,
  despejosN: 0,
  despejosBytes: 0,
  remontagensN: 0,
  remontagensBytes: 0,
  conjuntoQuenteBytes: 0,
  ...over,
});
const contexto = (over = {}) => ({
  bytesGuardados: 3 * TB,
  custoDoGuardadoCentavos: 13_770,
  servidorConfigurado: true,
  ...over,
});

console.log("\ncenário real: casamento de 20 GB, 10 ZIPs, 200 avulsos");

await etapa("um ZIP montado e nove do cache: B2 conta uma montagem só", () => {
  const r = resumoDeTrafego(
    somas({
      montadosN: 1,
      montadosBytes: 20 * GB,
      servidosServidorN: 10,
      servidosServidorBytes: 200 * GB,
      doCacheN: 9,
      doCacheBytes: 180 * GB,
      guardaveisServidosN: 10,
      guardaveisDoCacheN: 9,
      avulsosN: 200,
    }),
    contexto(),
  );
  igual(r.egressB2Bytes, 20 * GB + 200 * 5 * 1024 * 1024, "egress B2 = montagem + avulsos");
  igual(r.excedenteB2Bytes, 0, "dentro da franquia de 9 TB");
  igual(r.trafegoServidorBytes, 200 * GB, "o servidor entregou os 10");
  igual(r.fracaoDoCache, 0.9, "nove de dez do cache");
  igual(r.custoTrafegoCentavos, 0, "custo zero");
  temAviso(r, "ok", "dentro do previsto");
  return `egress ${(r.egressB2Bytes / GB).toFixed(1)} GB de ${(r.franquiaB2Bytes / TB).toFixed(0)} TB grátis`;
});

await etapa("o custo por TB guardado soma armazenamento, servidor e tráfego", () => {
  const r = resumoDeTrafego(somas(), contexto());
  igual(r.custoServidorZipCentavos, custoServidorZipCentavos(), "servidor do custos-fixos");
  igual(r.custoPorTbGuardadoCentavos, Math.round((13_770 + custoServidorZipCentavos()) / 3), "por TB");
  const semNada = resumoDeTrafego(somas(), contexto({ bytesGuardados: 0 }));
  igual(semNada.custoPorTbGuardadoCentavos, null, "sem nada guardado não há por-TB");
  return `R$ ${(r.custoPorTbGuardadoCentavos / 100).toFixed(2)} por TB com 3 TB guardados`;
});

console.log("\navisos: cada um provocado de propósito");

await etapa("sem servidor configurado, o aviso manda configurar", () => {
  const r = resumoDeTrafego(somas(), contexto({ servidorConfigurado: false }));
  temAviso(r, "alerta", "não configurado");
  igual(r.custoServidorZipCentavos, 0, "sem servidor não há custo dele");
});

await etapa("ZIP saindo pelo VPS com servidor configurado é a reserva em uso", () => {
  const r = resumoDeTrafego(
    somas({ servidosVpsN: 2, servidosVpsBytes: 40 * GB, abortadosN: 1, abortadosBytes: 5 * GB, abortadosVpsBytes: 5 * GB }),
    contexto(),
  );
  temAviso(r, "alerta", "reserva está em uso");
  igual(r.trafegoVpsBytes, 45 * GB, "servidos + abortados do VPS");
  igual(r.trafegoServidorBytes, 0, "nada atribuído ao servidor");
});

await etapa("VPS acima da metade dos 8 TB é erro, com a consequência escrita", () => {
  const r = resumoDeTrafego(somas({ servidosVpsN: 1, servidosVpsBytes: FRANQUIA_VPS_BYTES * 0.6 }), contexto());
  temAviso(r, "erro", "10 Mbps");
});

await etapa("servidor a 60% avisa; a 90% é erro e nomeia o degrau 2", () => {
  const a = resumoDeTrafego(
    somas({ servidosServidorN: 1, servidosServidorBytes: FRANQUIA_SERVIDOR_ZIP_BYTES * 0.65 }),
    contexto(),
  );
  temAviso(a, "alerta", "próximo degrau");
  const b = resumoDeTrafego(
    somas({ servidosServidorN: 1, servidosServidorBytes: FRANQUIA_SERVIDOR_ZIP_BYTES * 0.95 }),
    contexto(),
  );
  temAviso(b, "erro", "degrau 2");
  igual(b.excedenteServidorBytes, 0, "ainda sem excedente");
});

await etapa("acima dos 20 TB o excedente custa € 1/TB com IOF e spread", () => {
  const r = resumoDeTrafego(
    somas({ servidosServidorN: 1, servidosServidorBytes: FRANQUIA_SERVIDOR_ZIP_BYTES + 10 * TB }),
    contexto({ bytesGuardados: 100 * TB }),
  );
  igual(r.excedenteServidorBytes, 10 * TB, "10 TB a mais");
  const esperado = Math.round(10_000 * 0.63 * (1 + IOF) * (1 + SPREAD_CARTAO));
  igual(r.custoExcedenteServidorCentavos, esperado, "R$ 6,30/TB × 10 com câmbio");
  return `R$ ${(r.custoExcedenteServidorCentavos / 100).toFixed(2)} por 10 TB excedentes`;
});

await etapa("B2: a 80% da franquia avisa; acima cobra e sugere rever o desenho", () => {
  const quase = resumoDeTrafego(somas({ montadosN: 1, montadosBytes: 7.5 * TB }), contexto());
  temAviso(quase, "alerta", "franquia de 3×");
  igual(quase.custoExcedenteB2Centavos, 0, "ainda grátis");

  const passou = resumoDeTrafego(somas({ montadosN: 1, montadosBytes: 10 * TB }), contexto());
  igual(passou.excedenteB2Bytes, 1 * TB, "1 TB a mais que 9");
  const esperado = Math.round(1000 * EXCEDENTE_B2_CENTAVOS_GB * (1 + IOF) * (1 + SPREAD_CARTAO));
  igual(passou.custoExcedenteB2Centavos, esperado, "US$ 0,01/GB com câmbio");
  temAviso(passou, "erro", "rever o desenho");
  igual(passou.custoTrafegoCentavos, esperado, "o custo do tráfego é o excedente");
  return `R$ ${(passou.custoExcedenteB2Centavos / 100).toFixed(2)} por 1 TB acima`;
});

await etapa("estúdio novo: guardado zero e download > 0 não divide por zero", () => {
  const r = resumoDeTrafego(somas({ avulsosN: 10 }), contexto({ bytesGuardados: 0 }));
  igual(Number.isFinite(r.fracaoB2), true, "fração finita");
  igual(r.excedenteB2Bytes, 10 * 5 * 1024 * 1024, "tudo é excedente");
});

console.log("\ndisco do servidor de ZIP (24/09/2026)");

await etapa("favoritas não entram na fração do cache — só os ZIPs guardáveis", () => {
  /* 20 entregas de favoritas (nunca guardadas) e 2 completos, ambos do disco:
     a fração é 100%, não 10%. */
  const r = resumoDeTrafego(
    somas({ servidosServidorN: 22, doCacheN: 2, guardaveisServidosN: 2, guardaveisDoCacheN: 2 }),
    contexto(),
  );
  igual(r.fracaoDoCache, 1, "fração só dos guardáveis");
  semAviso(r, "disco do servidor de ZIP");
});

await etapa("disco que encheu uma vez é alerta, com o tamanho sugerido", () => {
  const r = resumoDeTrafego(
    somas({ despejosN: 1, despejosBytes: 20 * GB, conjuntoQuenteBytes: 120 * GB }),
    contexto(),
  );
  temAviso(r, "alerta", "encheu este mês");
  temAviso(r, "alerta", "pelo menos 200 GB");
  igual(r.discoSugeridoGb, 200, "120 GB / 0,85 = 141 → degrau de 200");
});

await etapa("três remontagens viram erro, dizendo quanto do B2 foi à toa e o que fazer", () => {
  const r = resumoDeTrafego(
    somas({
      despejosN: 8,
      despejosBytes: 160 * GB,
      remontagensN: 5,
      remontagensBytes: 100 * GB,
      conjuntoQuenteBytes: 1000 * GB,
    }),
    contexto(),
  );
  temAviso(r, "erro", "está pequeno para o volume atual");
  temAviso(r, "erro", "100 GB do B2 à toa");
  temAviso(r, "erro", "pelo menos 1.200 GB");
  temAviso(r, "erro", "Resize");
  semAviso(r, "encheu este mês");
  return r.avisos.find((a) => a.nivel === "erro").texto.slice(0, 90) + "…";
});

await etapa("sem montagem para medir, não há tamanho sugerido nem aviso de disco", () => {
  const r = resumoDeTrafego(somas(), contexto());
  igual(r.discoSugeridoGb, null, "sugestão");
  semAviso(r, "disco do servidor de ZIP");
});

await etapa("muitos downloads caindo de verdade é avisado", () => {
  const r = resumoDeTrafego(
    somas({ servidosServidorN: 6, abortadosN: 5, quedasN: 5, abortadosBytes: GB }),
    contexto(),
  );
  temAviso(r, "alerta", "5 de 11 downloads de ZIP caíram");
});

await etapa("conexão fechada que foi retomada NÃO é queda (o print de 29/09/2026)", () => {
  /* 13 conexões fechadas antes do fim, 8 entregas: o painel dizia "13 de 21
     caíram no meio". Se todas foram retomadas ou refeitas, não há aviso. */
  const r = resumoDeTrafego(
    somas({ servidosServidorN: 8, abortadosN: 13, quedasN: 0, abortadosBytes: 2 * GB }),
    contexto(),
  );
  semAviso(r, "caíram");
  const parte = resumoDeTrafego(
    somas({ servidosServidorN: 8, abortadosN: 13, quedasN: 2, abortadosBytes: 2 * GB }),
    contexto(),
  );
  semAviso(parte, "caíram");
});

await etapa("a conexão retomada continua contando tráfego do servidor", () => {
  const r = resumoDeTrafego(
    somas({ servidosServidorN: 1, servidosServidorBytes: 3 * GB, abortadosN: 1, abortadosBytes: 2 * GB, quedasN: 0 }),
    contexto(),
  );
  igual(r.trafegoServidorBytes, 5 * GB, "entregue + o que saiu antes de cair");
});

await etapa("pedaço de Range que não chega ao fim é tráfego, não entrega", () => {
  const r = resumoDeTrafego(
    somas({ servidosServidorN: 1, servidosServidorBytes: 1 * GB, trechosBytes: 3 * GB }),
    contexto(),
  );
  igual(r.trafegoServidorBytes, 4 * GB, "os trechos entram no tráfego");
});

console.log("\ne-mail semanal");

await etapa("sem aviso de erro, não há e-mail — alerta fica só no painel", () => {
  igual(relatorioDaEntrega([{ nivel: "ok", texto: "tudo certo" }], "https://x/painel/admin"), null, "só ok");
  igual(relatorioDaEntrega([{ nivel: "alerta", texto: "acompanhar" }], "https://x/painel/admin"), null, "só alerta");
});

await etapa("com erro: o e-mail traz o aviso, os alertas à parte e o link do painel", () => {
  const r = resumoDeTrafego(
    somas({ despejosN: 6, remontagensN: 4, remontagensBytes: 80 * GB, conjuntoQuenteBytes: 400 * GB }),
    contexto({ servidorConfigurado: false }),
  );
  const e = relatorioDaEntrega(r.avisos, "https://galeriaatomo.com.br/painel/admin");
  if (!e) throw new Error("não montou o e-mail");
  igual(e.assunto, "Galeria Átomo: 1 ponto da entrega precisa de ação", "assunto");
  if (!e.texto.includes("pelo menos 500 GB")) throw new Error(`sem o tamanho sugerido: ${e.texto}`);
  if (!e.texto.includes("Para acompanhar")) throw new Error("o alerta de servidor não configurado sumiu");
  if (!e.texto.includes("https://galeriaatomo.com.br/painel/admin")) throw new Error("sem o link");
  return e.assunto;
});

process.exit(falhou ? 1 : 0);
