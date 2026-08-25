#!/usr/bin/env node
/**
 * Testa o espelho — a segunda cópia das fotos e vídeos.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-espelho.mjs
 *
 * Por que existe: até agora o banco tinha backup e os ARQUIVOS não. As fotos
 * viviam só no R2 — uma cópia, num fornecedor só. Disco não é o risco (a
 * Cloudflare declara durabilidade de onze noves); o risco é a CONTA: suspensão,
 * cartão recusado, chave vazada com permissão de apagar, engano humano. Qualquer
 * um desses leva as entregas de todos os clientes de uma vez, e o backup do
 * banco restaurado apontaria para arquivos que não existem mais.
 *
 * O espelho copia cada original para um segundo fornecedor. Este teste prende as
 * três coisas que fazem ele valer alguma coisa:
 *   1. o conteúdo que chega do outro lado é BYTE A BYTE o mesmo;
 *   2. arquivo já espelhado não é copiado de novo (senão a fatura sobe sozinha);
 *   3. falha no espelho não derruba nada — é cópia, não caminho crítico.
 *
 * Sem ESPELHO_* configurado as etapas de rede são PULADAS em vez de vermelhas:
 * "não rodou" e "quebrou" não podem ter a mesma cor.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  espelhoConfigurado,
  chaveDoEspelho,
  espelharObjeto,
  objetoEspelhadoExiste,
  apagarDoEspelho,
  conferirEspelho,
  DEVE_ESPELHAR,
  ORIGINAIS_SEM_COPIA,
} from "../src/lib/espelho.ts";
import { urlDeUpload } from "../src/lib/r2.ts";

let falhou = false;
let pulados = 0;

async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
async function etapaDeRede(nome, fn) {
  if (!espelhoConfigurado) {
    pulados++;
    console.log(`  – ${nome} (pulado: ESPELHO_* não configurado)`);
    return;
  }
  await etapa(nome, fn);
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

console.log("regras puras");

/*
 * Miniatura e preview NÃO são espelhados de propósito: são geradas no navegador
 * durante o upload e, se sumirem, a galeria cai para o original sozinha (a
 * coluna é anulável justamente para isso). Espelhar o que se recupera sozinho é
 * pagar duas vezes pela mesma coisa.
 */
await etapa("só o original entra no espelho", () => {
  igual(DEVE_ESPELHAR("estudio/galeria/abc.jpg"), true, "original");
  igual(DEVE_ESPELHAR("estudio/galeria/abc.thumb.jpg"), false, "miniatura");
  igual(DEVE_ESPELHAR("estudio/galeria/abc.preview.jpg"), false, "preview");
});

/*
 * A chave do espelho tem de ser DERIVADA da chave de origem, nunca sorteada:
 * na hora de restaurar, o banco vai ter só a chave original em mãos, e uma
 * correspondência que dependa de um índice à parte é uma correspondência que
 * pode se perder justamente no dia do desastre.
 */
await etapa("chave do espelho é derivada da origem", () => {
  const origem = "estudio/galeria/abc.jpg";
  igual(chaveDoEspelho(origem), chaveDoEspelho(origem), "estável entre chamadas");
  if (!chaveDoEspelho(origem).includes("abc.jpg")) {
    throw new Error("a chave do espelho perdeu o nome do objeto de origem");
  }
});

/*
 * A LOGO É ORIGINAL, NÃO DERIVADA.
 *
 * Ela entrou no sistema pelo upload do fotógrafo, não é gerada de nada e não se
 * regenera — se sumir, só pedindo o arquivo de novo. Mesmo assim ficou fora do
 * espelho até 25/08/2026, porque a varredura lia só a tabela `medias` e a logo
 * mora em `tenants.logo_chave`. Era a única perda DEFINITIVA de arquivo de
 * cliente no desenho inteiro, e passou despercebida porque a página /seguranca
 * diz "cada arquivo em duas empresas" e ninguém foi conferir o "cada".
 *
 * Este teste prende a consulta que alimenta o espelho: se alguém voltar a olhar
 * só para `medias`, ele fica vermelho antes de a promessa virar mentira.
 */
await etapa("a varredura do espelho cobre a logo, não só as mídias", () => {
  const sql = ORIGINAIS_SEM_COPIA.toLowerCase();
  if (!sql.includes("medias")) throw new Error("a varredura deixou de cobrir as mídias");
  if (!sql.includes("logo_chave")) {
    throw new Error("a logo do estúdio ficou de fora — é original e não se regenera");
  }
});

console.log("\ncópia de verdade");

const chaveTeste = `espelho-teste/${randomUUID()}.bin`;
/* Conteúdo grande o bastante para não caber num pedaço só e exercitar o
 * caminho de upload em partes, que é o que os vídeos vão usar. */
const conteudo = Buffer.from(
  Array.from({ length: 40000 }, (_, i) => `linha ${i} do arquivo de teste do espelho\n`).join(""),
);
const somaOrigem = createHash("sha256").update(conteudo).digest("hex");

await etapaDeRede("o espelho responde", async () => {
  const r = await conferirEspelho();
  if (!r.ok) throw new Error(r.erro ?? "sem detalhe");
  return "credenciais aceitas";
});

await etapaDeRede("copia e o conteúdo chega idêntico", async () => {
  /* Põe o objeto na origem pela mesma porta que o navegador usa. */
  const url = await urlDeUpload(chaveTeste, "application/octet-stream");
  const envio = await fetch(url, {
    method: "PUT",
    body: conteudo,
    headers: { "content-type": "application/octet-stream" },
  });
  if (!envio.ok) throw new Error(`não consegui pôr o objeto de origem: HTTP ${envio.status}`);

  const r = await espelharObjeto(chaveTeste);
  if (!r.ok) throw new Error(r.erro ?? "espelharObjeto falhou");

  const baixado = await r.conferirConteudo();
  const somaDestino = createHash("sha256").update(baixado).digest("hex");
  igual(somaDestino, somaOrigem, "sha256 do que chegou no espelho");
  return `${(conteudo.length / 1024).toFixed(0)} KB conferidos byte a byte`;
});

await etapaDeRede("objeto espelhado é reconhecido como já copiado", async () => {
  igual(await objetoEspelhadoExiste(chaveTeste), true, "deveria existir no espelho");
  igual(
    await objetoEspelhadoExiste(`espelho-teste/${randomUUID()}.bin`),
    false,
    "objeto que nunca existiu",
  );
});

/*
 * Falha de espelho não pode derrubar upload nem galeria. O contrato é devolver
 * {ok:false}, nunca lançar: quem chama roda no caminho do usuário.
 */
await etapaDeRede("origem inexistente devolve erro em vez de explodir", async () => {
  const r = await espelharObjeto(`nao-existe/${randomUUID()}.jpg`);
  igual(r.ok, false, "deveria falhar");
  if (!r.erro) throw new Error("falhou sem dizer o motivo");
  return "erro tratado";
});

await etapaDeRede("limpeza do que o teste criou", async () => {
  await apagarDoEspelho(chaveTeste);
  igual(await objetoEspelhadoExiste(chaveTeste), false, "deveria ter sumido do espelho");
  const { apagarObjeto } = await import("../src/lib/r2.ts");
  await apagarObjeto(chaveTeste);
  return "origem e espelho limpos";
});

if (pulados > 0) {
  console.log(
    `\n⚠ ${pulados} etapa(s) de rede pulada(s) — preencha ESPELHO_* no .env.local para cobrir tudo`,
  );
}
console.log(falhou ? "\n✗ o espelho tem problema\n" : "\n✓ espelho ok\n");
process.exit(falhou ? 1 : 0);
