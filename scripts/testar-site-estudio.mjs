#!/usr/bin/env node
/**
 * Testa as regras do site do estúdio — a vitrine em `/e/<slug>`.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-site-estudio.mjs
 *
 * Por que existe: até agora `/e/<slug>` era só a lista de galerias públicas. O
 * fotógrafo não tinha onde escrever quem é, o que fotografa nem como falar com
 * ele — e é exatamente isso que o site do concorrente (Pixieset) entrega. O
 * conteúdo passa a vir do banco, escrito pelo próprio fotógrafo, e conteúdo
 * escrito por usuário que vira HTML é onde mora o problema.
 *
 * Suíte PURA de propósito: nada de banco, servidor ou bucket. Regra que só é
 * conferida com o ambiente inteiro no ar é regra que ninguém roda.
 */
import {
  SITE_PADRAO,
  LIMITES,
  MAX_DEPOIMENTOS,
  lerSite,
  normalizarWhatsapp,
  normalizarInstagram,
  urlDoWhatsapp,
  urlDoInstagram,
  secoesComConteudo,
} from "../src/lib/site-estudio.ts";

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

console.log("leitura tolerante");

/*
 * O mesmo contrato de `lerAparencia`: o que está no banco pode ser de uma versão
 * anterior do formato, ou lixo. A vitrine é PÚBLICA — cair aqui é o site do
 * fotógrafo fora do ar para os clientes dele, não uma tela de painel quebrada.
 */
await etapa("banco vazio devolve o padrão", () => {
  igual(lerSite({}).frase, SITE_PADRAO.frase, "frase");
  igual(lerSite(null).ligado, false, "site nasce desligado");
  igual(lerSite(undefined).depoimentos.length, 0, "sem depoimentos");
});

await etapa("tipo errado em qualquer campo não derruba", () => {
  const s = lerSite({ frase: 42, sobre: [], depoimentos: "nao é lista", ligado: "sim" });
  igual(typeof s.frase, "string", "frase");
  igual(typeof s.sobre, "string", "sobre");
  igual(Array.isArray(s.depoimentos), true, "depoimentos");
  igual(s.ligado, true, "ligado truthy vira true");
});

await etapa("texto longo é cortado, não recusado", () => {
  const s = lerSite({ frase: "a".repeat(5000), sobre: "b".repeat(50000) });
  igual(s.frase.length, LIMITES.frase, "frase cortada no limite");
  igual(s.sobre.length, LIMITES.sobre, "sobre cortado no limite");
});

/*
 * Depoimento sem texto não é depoimento: renderizaria um bloco de aspas vazio
 * na página. Some na leitura em vez de virar buraco visual.
 */
await etapa("depoimento sem texto é descartado", () => {
  const s = lerSite({
    depoimentos: [
      { texto: "Ficou lindo!", autor: "Ana & Pedro" },
      { texto: "   ", autor: "Ninguém" },
      { autor: "Só autor" },
    ],
  });
  igual(s.depoimentos.length, 1, "sobrou só o que tem texto");
  igual(s.depoimentos[0].autor, "Ana & Pedro", "autor preservado");
});

await etapa("lista de depoimentos tem teto", () => {
  const muitos = Array.from({ length: MAX_DEPOIMENTOS + 30 }, (_, i) => ({
    texto: `depoimento ${i}`,
    autor: `autor ${i}`,
  }));
  igual(lerSite({ depoimentos: muitos }).depoimentos.length, MAX_DEPOIMENTOS, "cortado no teto");
});

console.log("\ncontato — onde o texto do usuário vira endereço");

/*
 * AQUI É O PONTO PERIGOSO DA OBRA.
 *
 * Todo o resto do site é texto dentro de um nó do React, que escapa sozinho. O
 * WhatsApp e o Instagram não: viram `href`. Um valor como `javascript:...` num
 * href é execução de script no domínio do estúdio, escolhida por quem preencheu
 * o campo. Por isso o campo NÃO guarda um endereço — guarda dígitos e um
 * usuário, e quem monta o endereço é o código.
 */
await etapa("whatsapp guarda só dígitos", () => {
  igual(normalizarWhatsapp("(54) 99999-8888"), "5554999998888", "celular com DDD");
  igual(normalizarWhatsapp("+55 54 99999-8888"), "5554999998888", "já com país");
  igual(normalizarWhatsapp("5499998888"), "555499998888", "fixo de 10 dígitos");
});

await etapa("whatsapp inválido vira null, não texto solto", () => {
  igual(normalizarWhatsapp("javascript:alert(1)"), null, "script");
  igual(normalizarWhatsapp("123"), null, "curto demais");
  igual(normalizarWhatsapp(""), null, "vazio");
  igual(normalizarWhatsapp("9".repeat(40)), null, "longo demais");
});

await etapa("instagram guarda só o usuário", () => {
  igual(normalizarInstagram("@sirius.fotografia"), "sirius.fotografia", "com arroba");
  igual(normalizarInstagram("https://instagram.com/sirius.fotografia/"), "sirius.fotografia", "url inteira");
  igual(normalizarInstagram("  Sirius_Foto  "), "Sirius_Foto", "espaço e maiúscula");
});

await etapa("instagram inválido vira null", () => {
  igual(normalizarInstagram("javascript:alert(1)"), null, "script");
  igual(normalizarInstagram("a/b"), null, "barra no meio");
  igual(normalizarInstagram(""), null, "vazio");
});

/*
 * A prova final: o endereço é MONTADO, nunca ecoado. Se um dia alguém guardar
 * um valor torto direto no banco (psql na mão), o href continua sendo um
 * endereço do WhatsApp ou do Instagram — ou não existe.
 */
await etapa("endereço montado nunca sai do domínio esperado", () => {
  igual(urlDoWhatsapp("5554999998888"), "https://wa.me/5554999998888", "whatsapp");
  igual(urlDoInstagram("sirius.fotografia"), "https://instagram.com/sirius.fotografia", "instagram");
  igual(urlDoWhatsapp("javascript:alert(1)"), null, "lixo não vira href");
  igual(urlDoInstagram("javascript:alert(1)"), null, "lixo não vira href");
});

/*
 * O site guardado passa pela MESMA peneira na leitura. Sem isto, a normalização
 * ficaria só no formulário e um valor gravado por outro caminho (importação,
 * psql, uma action futura que esqueça de chamar) chegaria cru no href.
 */
await etapa("a leitura repete a peneira do formulário", () => {
  const s = lerSite({ whatsapp: "javascript:alert(1)", instagram: "javascript:alert(1)" });
  igual(s.whatsapp, "", "whatsapp torto some na leitura");
  igual(s.instagram, "", "instagram torto some na leitura");
});

console.log("\nquais seções a página desenha");

/*
 * Seção vazia não pode virar título com nada embaixo — é o defeito clássico de
 * gerador de site, e some a régua entre "não preencheu" e "está quebrado".
 */
await etapa("seção sem conteúdo não aparece", () => {
  const vazio = secoesComConteudo(lerSite({}));
  igual(vazio.includes("sobre"), false, "sobre vazio fora");
  igual(vazio.includes("depoimentos"), false, "depoimentos vazio fora");
  igual(vazio.includes("contato"), false, "contato vazio fora");
});

await etapa("seção preenchida aparece", () => {
  const cheio = secoesComConteudo(
    lerSite({
      sobre: "Fotografamos casamentos desde 2014.",
      depoimentos: [{ texto: "Perfeito!", autor: "Ana" }],
      whatsapp: "54999998888",
    }),
  );
  igual(cheio.includes("sobre"), true, "sobre");
  igual(cheio.includes("depoimentos"), true, "depoimentos");
  igual(cheio.includes("contato"), true, "contato");
});

/*
 * "Galerias" é a seção que o concorrente não tem: o portfólio dele é escolhido
 * à mão e envelhece. O nosso lê as galerias publicadas, então existe sempre —
 * mesmo com o site inteiro em branco, a vitrine tem o que mostrar.
 */
await etapa("galerias aparecem mesmo com o site em branco", () => {
  igual(secoesComConteudo(lerSite({})).includes("galerias"), true, "galerias sempre");
});

console.log(falhou ? "\n✗ o site do estúdio tem problema\n" : "\n✓ site do estúdio ok\n");
process.exit(falhou ? 1 : 0);
