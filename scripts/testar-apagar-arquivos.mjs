#!/usr/bin/env node
/**
 * APAGAR FOTO TIRA O ARQUIVO DO ARMAZÉM — do armazém CERTO, e em poucas idas.
 * Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-apagar-arquivos.mjs
 *
 * ── DE ONDE VEIO (18/09/2026) ─────────────────────────────────────────────
 *
 * Ana Carolina, com a foto do aviso do navegador: "Não foi possível apagar
 * agora. Tente de novo." — "as fotos não subiram em ordem e to tentando apagar
 * elas da galeria e da erro".
 *
 * Procurando a causa, dois defeitos apareceram na leitura das duas rotas de
 * apagar, e este arquivo prende os dois:
 *
 *   1. UMA REQUISIÇÃO POR CHAVE. O "apagar todas" disparava um `DeleteObject`
 *      por chave, todos de uma vez — 858 numa galeria de 286 fotos. O
 *      `DeleteObjects`, que leva até 1000 chaves por chamada, já existia em
 *      `r2.apagarObjetos` com essa conta escrita no comentário, e a rota não o
 *      usava. Basta uma requisição pendurada para o lote inteiro esperar.
 *
 *   2. O ORIGINAL NO B2 NÃO ERA APAGADO. As duas rotas chamavam
 *      `r2.apagarObjeto` para TODAS as chaves. Desde a fase 3 da obra o
 *      original pode morar no B2 — e ali a chamada erra de balde, some no
 *      `.catch(() => {})` e deixa arquivo PAGO para trás, sem linha no banco
 *      que o mencione. Ninguém veria: a galeria fica certa, só a fatura cresce.
 *
 * O segundo é o que este teste prova de forma decisiva; o primeiro se mede em
 * requisições, e está no commit.
 */
import { randomUUID } from "node:crypto";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { apagarArquivosDasMedias } from "../src/lib/armazem.ts";
import { apagarObjeto, objetoExiste, urlDeUpload } from "../src/lib/r2.ts";
import { arquivosConfigurado, urlDeUploadArquivo, arquivoExiste, apagarArquivo } from "../src/lib/b2.ts";

exigirBancoDeTeste();

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

const MARCA = `teste-apagar-${randomUUID().slice(0, 8)}`;
const porR2 = async (chave) => {
  const r = await fetch(await urlDeUpload(chave, "image/jpeg"), {
    method: "PUT",
    body: Buffer.from("x"),
    headers: { "content-type": "image/jpeg" },
  });
  if (!r.ok) throw new Error(`não consegui pôr ${chave} no R2 (HTTP ${r.status})`);
};
const porB2 = async (chave) => {
  const r = await fetch(await urlDeUploadArquivo(chave, "image/jpeg"), {
    method: "PUT",
    body: Buffer.from("x"),
    headers: { "content-type": "image/jpeg" },
  });
  if (!r.ok) throw new Error(`não consegui pôr ${chave} no B2 (HTTP ${r.status})`);
};

const criadas = { r2: [], b2: [] };

try {
  await etapa("o despachante apaga original e derivadas do R2", async () => {
    const m = {
      chave: `${MARCA}/r2/original.jpg`,
      chave_thumb: `${MARCA}/r2/thumb.webp`,
      chave_preview: `${MARCA}/r2/prev.webp`,
      armazem: "r2",
    };
    for (const c of [m.chave, m.chave_thumb, m.chave_preview]) {
      await porR2(c);
      criadas.r2.push(c);
    }
    const r = await apagarArquivosDasMedias([m]);
    if (r.falhou) throw new Error(r.falhou);
    for (const c of [m.chave, m.chave_thumb, m.chave_preview]) {
      if (await objetoExiste(c)) throw new Error(`${c} continua no balde`);
    }
    return "3 chaves, nenhuma sobrou";
  });

  /*
   * O CASO QUE VAZAVA DINHEIRO.
   *
   * Sem B2 configurado nesta bancada a etapa não se aplica — e dizer isso é
   * melhor que passar em verde sobre nada.
   */
  if (!arquivosConfigurado) {
    console.log("  · o original no B2 (não se aplica: esta bancada não tem ARQUIVOS_* configurado)");
  } else {
    await etapa("o original que mora no B2 é apagado LÁ, e não no R2", async () => {
      const m = {
        chave: `${MARCA}/b2/original.jpg`,
        chave_thumb: `${MARCA}/b2/thumb.webp`,
        chave_preview: null,
        armazem: "b2",
      };
      await porB2(m.chave);
      criadas.b2.push(m.chave);
      await porR2(m.chave_thumb);
      criadas.r2.push(m.chave_thumb);

      /* Como era antes: `apagarObjeto` do R2 para TODAS as chaves. */
      await apagarObjeto(m.chave).catch(() => {});
      if (!(await arquivoExiste(m.chave))) {
        throw new Error("o balde do B2 aceitou um apagar endereçado ao R2 — a bancada não representa produção");
      }

      /* Como ficou. */
      const r = await apagarArquivosDasMedias([m]);
      if (r.falhou) throw new Error(r.falhou);
      if (await arquivoExiste(m.chave)) throw new Error("o original continua no B2 — o arquivo pago ficou para trás");
      if (await objetoExiste(m.chave_thumb)) throw new Error("a derivada continua no R2");
      return "o original saiu do B2, a derivada saiu do R2";
    });
  }

  await etapa("chave que já não existe não vira erro", async () => {
    const r = await apagarArquivosDasMedias([
      { chave: `${MARCA}/fantasma.jpg`, chave_thumb: null, chave_preview: null, armazem: "r2" },
    ]);
    if (r.falhou) throw new Error(r.falhou);
    return "apagar o que não está lá é o resultado desejado";
  });

  await etapa("lista vazia não fala com armazém nenhum", async () => {
    const r = await apagarArquivosDasMedias([]);
    if (r.apagadas !== 0 || r.falhou) throw new Error(JSON.stringify(r));
    return "0 chaves";
  });

  /*
   * A CONTA QUE O DEFEITO ERA. Não dá para medir requisições daqui sem um proxy,
   * mas dá para prender o TAMANHO do lote: uma chamada por 1000 chaves, e não
   * uma por chave. 1200 chaves = 2 chamadas.
   */
  await etapa("1200 chaves cabem em poucos lotes, e todas somem", async () => {
    const medias = Array.from({ length: 400 }, (_, i) => ({
      chave: `${MARCA}/lote/${i}.jpg`,
      chave_thumb: `${MARCA}/lote/${i}_t.webp`,
      chave_preview: `${MARCA}/lote/${i}_p.webp`,
      armazem: "r2",
    }));
    /* Só três de verdade no balde: o que se mede aqui é que nada ESTOURA com
       1200 chaves e que o que existia saiu. Pôr 1200 objetos custaria minutos
       de bancada para provar a mesma coisa. */
    const reais = [medias[0].chave, medias[200].chave_thumb, medias[399].chave_preview];
    for (const c of reais) {
      await porR2(c);
      criadas.r2.push(c);
    }
    const r = await apagarArquivosDasMedias(medias);
    if (r.falhou) throw new Error(r.falhou);
    if (r.apagadas !== 1200) throw new Error(`disse ter apagado ${r.apagadas}`);
    for (const c of reais) if (await objetoExiste(c)) throw new Error(`${c} sobrou`);
    return "1200 chaves, as 3 que existiam saíram";
  });
} finally {
  /* O que este teste pôs no balde e alguma etapa não apagou. */
  for (const c of criadas.r2) await apagarObjeto(c).catch(() => {});
  for (const c of criadas.b2) await apagarArquivo(c).catch(() => {});
}

if (falhou) {
  console.error("\n✗ apagar arquivo do armazém tem problema");
  process.exit(1);
}
console.log("\n✓ apagar foto tira o arquivo do armazém certo, em poucas idas");
