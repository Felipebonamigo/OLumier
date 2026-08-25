#!/usr/bin/env node
/**
 * Testa a ESCOLHA DE ARMAZÉM — de qual fornecedor cada arquivo é servido.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-armazem.mjs
 *
 * Fase 2 da obra (docs/obra-rota-b2.md). O original de galeria grande e de
 * cofre passa a morar no B2; miniatura, preview, capa e logo ficam no R2 para
 * sempre, porque é o R2 que tem borda perto do Brasil e é dele que sai tudo que
 * o navegador toca enquanto a pessoa navega.
 *
 * ── O ERRO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ───────────────────────────
 * Miniatura é opcional: vídeo sem capa gerada, HEIC antes da conversão, foto
 * recém-enviada. Onde ela falta, o código cai no ORIGINAL (`chave_thumb ??
 * chave`). Se o original já foi movido para o B2 e o fallback continuar pedindo
 * ao R2, o grid da galeria abre com buracos — e só nos itens sem derivada, que
 * são a minoria. Ou seja: passa em qualquer teste feito com a galeria de
 * exemplo, e quebra na do cliente.
 *
 * Por isso a regra não mora nos chamadores. Mora em `lib/armazem.ts`, e é aqui
 * que ela é prendida: quem escolhe a chave escolhe o armazém no mesmo lugar,
 * porque duas decisões separadas é que dessincronizam.
 *
 * Não precisa de rede nem de bucket: o que se prova é a ESCOLHA. Com as
 * ARQUIVOS_* ausentes, pedir ao B2 estoura nomeando as variáveis — e é esse
 * estouro que serve de prova de que a escolha caiu no B2.
 */
import {
  urlDoOriginal,
  urlDaDerivada,
  armazemDe,
  armazemDeNovosUploads,
  urlDeEnvioDoOriginal,
  abrirEnvioDoOriginal,
  urlDaParteDoOriginal,
  fecharEnvioDoOriginal,
  abortarEnvioDoOriginal,
  conferirOriginal,
} from "../src/lib/armazem.ts";
import { arquivosConfigurado } from "../src/lib/b2.ts";
import { armazenamentoConfigurado } from "../src/lib/r2.ts";

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
};
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

/*
 * "Foi ao B2?" sem depender de bucket existir.
 *
 * Com ARQUIVOS_* ausente o módulo do B2 estoura nomeando as variáveis; é a
 * assinatura de que a escolha chegou lá. Se por acaso ESTIVER configurado (a
 * máquina do dev com o bucket já criado), a prova passa a ser o endereço da URL
 * assinada, que carrega o nome do bucket. Os dois caminhos provam a mesma coisa,
 * e nenhum deles fica em silêncio.
 */
async function foiParaOB2(fn) {
  try {
    const url = await fn();
    if (!arquivosConfigurado) throw new Error("não estourou nem gerou URL");
    return /backblazeb2\.com|\/\/[^/]*b2/i.test(url) || url.includes(process.env.ARQUIVOS_BUCKET);
  } catch (e) {
    return e.message.includes("ARQUIVOS_");
  }
}

async function foiParaOR2(fn) {
  try {
    const url = await fn();
    if (!armazenamentoConfigurado) throw new Error("não estourou nem gerou URL");
    return !/backblazeb2\.com/i.test(url);
  } catch (e) {
    return e.message.includes("R2_");
  }
}

console.log("a regra da escolha");

await etapa("armazém do banco vira armazém válido", () => {
  igual(armazemDe("b2"), "b2", "b2");
  igual(armazemDe("r2"), "r2", "r2");
  /*
   * Valor estranho cai em r2 de propósito: é onde TODO arquivo está hoje, e
   * onde estará todo arquivo que a fase 3 ainda não moveu. Um `throw` aqui
   * transformaria dado inesperado em galeria fora do ar; o check da migração 015
   * já impede que lixo entre na coluna.
   */
  igual(armazemDe(null), "r2", "nulo");
  igual(armazemDe(undefined), "r2", "indefinido");
  igual(armazemDe("banana"), "r2", "lixo");
  return "b2 é b2; qualquer outra coisa é r2";
});

console.log("\noriginal — segue o armazém dele");

await etapa("original em r2 é servido pelo r2", async () => {
  if (!(await foiParaOR2(() => urlDoOriginal("g/1/foto.jpg", "r2")))) {
    throw new Error("não foi para o R2");
  }
});

await etapa("original em b2 é servido pelo b2", async () => {
  if (!(await foiParaOB2(() => urlDoOriginal("g/1/foto.jpg", "b2")))) {
    throw new Error("não foi para o B2");
  }
});

await etapa("nome de download sobrevive nos dois armazéns", async () => {
  /* Só prova que o parâmetro é repassado; o Content-Disposition em si é do
   * testar-r2/testar-b2, que têm rede. */
  const r2 = await foiParaOR2(() => urlDoOriginal("g/1/f.jpg", "r2", 300, "Ana & Pedro.jpg"));
  const b2 = await foiParaOB2(() => urlDoOriginal("g/1/f.jpg", "b2", 300, "Ana & Pedro.jpg"));
  if (!r2 || !b2) throw new Error("o nome de download derrubou a escolha de armazém");
});

console.log("\nderivada — sempre r2, MENOS quando não existe");

await etapa("miniatura existente vem do r2 mesmo com o original no b2", async () => {
  if (!(await foiParaOR2(() => urlDaDerivada("g/1/f.thumb.jpg", "g/1/f.jpg", "b2")))) {
    throw new Error("a miniatura foi buscar no B2 — o grid ficaria lento por nada");
  }
  return "derivada não segue o original";
});

/*
 * O caso que motivou este arquivo. Sem derivada, o fallback É o original — e
 * tem de ir aonde o original está, senão o item abre quebrado.
 */
await etapa("SEM miniatura, o fallback segue o original para o b2", async () => {
  if (!(await foiParaOB2(() => urlDaDerivada(null, "g/1/f.jpg", "b2")))) {
    throw new Error("caiu no R2 buscar um arquivo que está no B2 — item quebrado no grid");
  }
  return "fallback respeita o armazém";
});

await etapa("SEM miniatura e original no r2 segue no r2", async () => {
  if (!(await foiParaOR2(() => urlDaDerivada(null, "g/1/f.jpg", "r2")))) {
    throw new Error("não foi para o R2");
  }
});

await etapa("string vazia conta como derivada ausente", async () => {
  /* `coalesce` do Postgres devolve null, mas uma coluna text pode guardar ''.
   * Tratar '' como presente geraria URL para uma chave vazia. */
  if (!(await foiParaOB2(() => urlDaDerivada("", "g/1/f.jpg", "b2")))) {
    throw new Error("string vazia foi tratada como chave válida");
  }
});

console.log("\nnada muda enquanto ninguém foi movido");

await etapa("com tudo em r2 o comportamento é o de hoje", async () => {
  const casos = [
    () => urlDaDerivada("g/1/f.thumb.jpg", "g/1/f.jpg", "r2"),
    () => urlDaDerivada(null, "g/1/f.jpg", "r2"),
    () => urlDoOriginal("g/1/f.jpg", "r2"),
    () => urlDoOriginal("g/1/f.jpg", armazemDe("r2")),
  ];
  for (const c of casos) if (!(await foiParaOR2(c))) throw new Error("algum caso saiu do R2");
  return `${casos.length} caminhos, todos no R2`;
});

/*
 * ── FASE 3: ONDE O ARQUIVO NASCE ──────────────────────────────────────────
 *
 * Até aqui o armazém só decidia de onde LER. Agora decide onde ESCREVER: o
 * original passa a nascer direto no B2, em vez de nascer no R2 e ser movido de
 * madrugada. Só foi possível porque produção tinha ZERO mídias — não havia o
 * que migrar. Isso apagou duas fases inteiras da obra (mover noturno e limpar
 * o R2 com carência), que eram justamente as duas rotinas capazes de apagar
 * arquivo vivo de cliente.
 *
 * A chave da escolha é `armazemDeNovosUploads()`: ela olha se as ARQUIVOS_*
 * existem. Sem credencial do B2 o sistema continua gravando no R2 e nada
 * quebra — a virada acontece no dia em que a variável entra no ambiente, sem
 * deploy e sem migração. É o que permite entregar este código antes de o
 * bucket estar ligado.
 *
 * As DERIVADAS não seguem o original: continuam no R2 sempre. Medido em
 * 25/08/2026, um grid de 16 miniaturas leva 1,14 s no R2 contra 2,32 s no B2, e
 * mover as derivadas economizaria 1,7% da conta. Ver docs/obra-rota-b2.md.
 */
console.log("\nonde o arquivo nasce (fase 3)");

await etapa("sem credencial do B2, o upload continua caindo no R2", () => {
  if (arquivosConfigurado) return "pulado: ARQUIVOS_* configurado nesta máquina";
  igual(armazemDeNovosUploads(), "r2", "armazém de novos uploads");
  return "degrada para o R2 em vez de quebrar";
});

await etapa("com credencial do B2, o original nasce no B2", () => {
  if (!arquivosConfigurado) return "pulado: ARQUIVOS_* ausente nesta máquina";
  igual(armazemDeNovosUploads(), "b2", "armazém de novos uploads");
});

await etapa("a escrita do original respeita o armazém escolhido", async () => {
  if (!(await foiParaOB2(() => urlDeEnvioDoOriginal("g/1/f.jpg", "image/jpeg", "b2")))) {
    throw new Error("upload do original não foi para o B2");
  }
  if (!(await foiParaOR2(() => urlDeEnvioDoOriginal("g/1/f.jpg", "image/jpeg", "r2")))) {
    throw new Error("upload do original não respeitou r2");
  }
});

/*
 * Envio em partes é o caminho do vídeo 4K — o que mais importa não quebrar,
 * porque é o arquivo grande que o fotógrafo não quer subir duas vezes. As
 * QUATRO operações precisam ir para o mesmo lugar: abrir num fornecedor e
 * fechar no outro deixa partes órfãs ocupando espaço e cobrando.
 */
await etapa("o envio em partes inteiro respeita o armazém", async () => {
  const noB2 = [
    () => abrirEnvioDoOriginal("g/1/v.mp4", "video/mp4", "b2"),
    () => urlDaParteDoOriginal("g/1/v.mp4", "upload-id", 1, "b2"),
    () => fecharEnvioDoOriginal("g/1/v.mp4", "upload-id", [{ numero: 1, etag: "x" }], "b2"),
    () => abortarEnvioDoOriginal("g/1/v.mp4", "upload-id", "b2"),
  ];
  for (const c of noB2) if (!(await foiParaOB2(c))) throw new Error("alguma etapa do multipart saiu do B2");
  return `${noB2.length} etapas do multipart`;
});

/*
 * `conferirOriginal` não gera URL: ela vai à rede e devolve tamanho. Então os
 * detectores acima (que leem o endereço assinado) não servem, e a prova aqui é
 * pela mensagem de erro — que é o que distingue "foi ao B2 sem credencial" de
 * "foi ao R2 e o objeto não existe".
 */
await etapa("conferir o objeto olha no armazém certo", async () => {
  if (arquivosConfigurado) return "pulado: com B2 ligado os dois lados vão à rede de verdade";

  const erroB2 = await conferirOriginal("g/1/inexistente.jpg", "b2").then(
    () => null,
    (e) => e.message,
  );
  if (!erroB2?.includes("ARQUIVOS_")) {
    throw new Error(`conferência com armazem=b2 não foi ao B2 (erro: ${erroB2})`);
  }

  const erroR2 = await conferirOriginal("g/1/inexistente.jpg", "r2").then(
    () => null,
    (e) => e.message,
  );
  if (erroR2?.includes("ARQUIVOS_")) {
    throw new Error("conferência com armazem=r2 foi parar no B2");
  }
  return "b2 e r2 despachados para lados diferentes";
});

console.log(falhou ? "\n✗ escolha de armazém com problema\n" : "\n✓ escolha de armazém ok\n");
process.exit(falhou ? 1 : 0);
