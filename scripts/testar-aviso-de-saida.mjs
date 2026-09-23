#!/usr/bin/env node
/**
 * Quando sair custa alguma coisa — e quando não custa. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-aviso-de-saida.mjs
 *
 * ── POR QUE ISTO EXISTE (17/09/2026) ──────────────────────────────────────
 *
 * Felipe: "adicionar opção de poder modificar a capa enquanto as fotos da
 * galeria tão subindo". Ele clicava em Design com o envio rodando e recebia
 * "se sair agora, os arquivos que faltam não sobem".
 *
 * Não era verdade. Desde 05/09/2026 a fila mora no provedor do LAYOUT da
 * galeria, e o App Router não remonta layout ao trocar entre as abas filhas —
 * o envio seguia. A capacidade existia; o aviso é que não sabia disso.
 *
 * ── O QUE UM AVISO FALSO CUSTA ────────────────────────────────────────────
 *
 * Mais caro que aviso nenhum. Ele ENSINA que não se pode fazer uma coisa que
 * se pode, e quem acredita espera 600 fotos subirem antes de mexer na capa. E
 * quem descobre que era mentira para de ler o próximo aviso — inclusive o que
 * for verdade.
 *
 * ── POR QUE A REGRA MORA FORA DO GANCHO ───────────────────────────────────
 *
 * São quatro casos que se confundem, e nenhum deles se testa clicando. Dentro
 * do `useEffect` a decisão só seria conferida à mão, uma vez, por quem
 * escreveu. Separada, ela responde aqui.
 */
import { ehSaida } from "../src/lib/aviso-de-saida.ts";

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const d = fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

console.log("O aviso de saída sabe o que é sair\n");

const GALERIA = "/painel/galerias/abc-123/";
const FOTOS = "/painel/galerias/abc-123/fotos";

/* Os quatro destinos que existem de verdade a partir da aba Fotos, e o que
   cada um custa quando há 600 fotos subindo. Escritos à mão de propósito: uma
   lista lida da própria fonte concordaria com qualquer mudança. */
const CASOS = [
  ["/painel/galerias/abc-123/design", false, "o Design da MESMA galeria — a fila vive no layout"],
  ["/painel/galerias/abc-123/entrega", false, "a Entrega da mesma galeria"],
  ["/painel/galerias/abc-123/atividade", false, "a Atividade da mesma galeria"],
  ["/painel", true, '"← Galerias" desmonta o layout e mata a fila'],
  ["/painel/galerias/outra-999/fotos", true, "outra galeria é outro layout"],
  ["/painel/conta", true, "fora da galeria"],
];

for (const [destino, esperado, porque] of CASOS) {
  etapa(`de Fotos para ${destino}: ${esperado ? "avisa" : "não avisa"}`, () => {
    const deu = ehSaida(FOTOS, destino, GALERIA);
    if (deu !== esperado) {
      throw new Error(`devolveu ${deu} — ${porque}`);
    }
    return porque;
  });
}

etapa("âncora para a mesma página não é saída", () => {
  if (ehSaida(FOTOS, FOTOS, GALERIA)) throw new Error("perguntou para quem não saiu do lugar");
  return "#fotos continua sendo aqui";
});

/*
 * A área segura vale nos DOIS lados, e cada metade sozinha erra de um jeito
 * diferente. Estas duas etapas são as que pegam a meia-implementação.
 */
etapa("estar FORA e ir para dentro continua sendo navegação guardada", () => {
  if (!ehSaida("/painel", FOTOS, GALERIA)) {
    throw new Error(
      "tratou como seguro um link que ENTRA na área: quem está em /painel com algo a perder " +
        "perderia do mesmo jeito",
    );
  }
  return "só conferir o destino não basta";
});

etapa("estar dentro e SAIR continua avisando", () => {
  if (!ehSaida(FOTOS, "/painel", GALERIA)) {
    throw new Error('o "← Galerias" passou batido — é o clique que matava a fila em silêncio');
  }
  return "só conferir a origem não basta";
});

/*
 * Sem área segura, TODA navegação pergunta — é o que o editor de aparência usa,
 * porque o rascunho dele não sobrevive a troca de aba nenhuma.
 */
etapa("sem área segura, qualquer caminho diferente avisa", () => {
  const destinos = ["/painel/galerias/abc-123/design", "/painel", "/painel/conta"];
  const passou = destinos.filter((d) => !ehSaida(FOTOS, d));
  if (passou.length) {
    throw new Error(`${passou.join(", ")} não avisou sem área segura declarada`);
  }
  return `${destinos.length} destinos, todos guardados`;
});

/*
 * A GUARDA DA GUARDA: quem escreve o `dentroDe` precisa terminá-lo em barra.
 * Sem ela, `/painel/galerias/abc-123` casa por prefixo com
 * `/painel/galerias/abc-1234/fotos` — outra galeria, tratada como segura, e a
 * fila morreria calada. O erro é de digitação e o efeito é perda de dado.
 */
etapa("prefixo sem barra final não engana a conferência", () => {
  const semBarra = "/painel/galerias/abc-123";
  if (!ehSaida(FOTOS, "/painel/galerias/abc-1234/fotos", `${semBarra}/`)) {
    throw new Error("uma galeria de id parecido passou por segura");
  }
  return "abc-1234 não é abc-123";
});

console.log(falhou ? "\n✗ o aviso de saída está errado\n" : "\n✓ o aviso avisa só quando custa\n");
process.exit(falhou ? 1 : 0);
