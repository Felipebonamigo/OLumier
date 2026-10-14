#!/usr/bin/env node
/**
 * COPIAR FOTOS PARA OUTRA GALERIA. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-copiar-entre-galerias.mjs
 *
 * Irmão de `testar-mover-entre-galerias.mjs`. O armazém é de mentira (`Copiador`
 * e um cliente S3 falso): a suíte não toca bucket nenhum, e o que ela prende é a
 * LÓGICA — chaves novas, linhas novas, espaço, isolamento e o desfazer.
 *
 * Prende:
 *  1. a foto fica nas DUAS galerias; a cópia tem id e chave próprios — apagar uma
 *     nunca leva a outra (é o motivo de não compartilhar o objeto);
 *  2. o espaço do estúdio sobe, e a quota barra a cópia que não cabe;
 *  3. favoritas e capa não vêm; os rostos vêm só se o destino tem a busca;
 *  4. lote por peso: o que passa do limite volta em `restantes`;
 *  5. falha no armazém não deixa linha, e desfaz o que já copiou;
 *  6. galeria/capítulo/foto de outro estúdio não alcança nada;
 *  7. o cliente S3: CopyObject até 5 GB, multipart acima, origem ausente = false.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, galeriaDaRodada, limparRodada, segundoEstudioDaRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const { copiarMediasParaOutraGaleria, chaveDaCopia, LIMITE_DE_BYTES_POR_CHAMADA, MAXIMO_POR_CHAMADA } =
  await import("../src/lib/copiar-entre-galerias.ts");
const { copiarNoBalde, origemDaCopia } = await import("../src/lib/copia-no-balde.ts");

const GB = 1024 ** 3;
const QUOTA = BigInt(100 * GB);

/* Um armazém de mentira: lembra o que "copiou" e o que "apagou". */
function armazemFalso({ falharEm = null, semDerivada = false } = {}) {
  const f = { copiados: [], apagados: [] };
  return {
    f,
    copiador: {
      async original(de, para) {
        if (falharEm && de.includes(falharEm)) throw new Error("armazém fora do ar");
        f.copiados.push(para);
        return true;
      },
      async derivada(de, para) {
        if (semDerivada) return false;
        f.copiados.push(para);
        return true;
      },
      async apagar(medias) {
        for (const m of medias) for (const k of [m.chave, m.chave_thumb, m.chave_preview, m.chave_reproducao]) if (k) f.apagados.push(k);
        return { apagadas: f.apagados.length, falhou: null };
      },
    },
  };
}

try {
  const t = await estudioDaRodada(db);
  const outro = await segundoEstudioDaRodada(db);
  const origem = await galeriaDaRodada(db, { nome: "acervo", medias: 4, bytes: 2 * 1024 * 1024 });
  const destino = await galeriaDaRodada(db, { nome: "cliente", medias: 1 });
  const alheia = await galeriaDaRodada(db, { nome: "alheia", dono: outro, medias: 1 });
  const ids = origem.midias.map((m) => m.id);
  const copiar = (extra = {}, falso = armazemFalso()) =>
    copiarMediasParaOutraGaleria({
      tenantId: t.id,
      origemId: origem.id,
      destinoId: destino.id,
      secaoDestinoId: null,
      ids,
      quotaBytes: QUOTA,
      copiador: falso.copiador,
      ...extra,
    });
  const uso = async () =>
    (await db.query("select coalesce(sum(bytes),0)::bigint as n from medias where tenant_id = $1 and pronto", [t.id])).rows[0].n;
  const contar = async (g) =>
    Number((await db.query("select count(*)::int as n from medias where galeria_id = $1", [g])).rows[0].n);

  console.log("Copiar para outra galeria:\n");

  await etapa("as chaves da cópia mantêm o sufixo de cada arquivo", () => {
    const base = "t/g/abc";
    igual(chaveDaCopia("t/g/abc.jpg", "t/g/abc_thumb.webp", "N/N/x"), "N/N/x_thumb.webp", "thumb");
    igual(chaveDaCopia("t/g/abc.mov", "t/g/abc_leve.mp4", "N/N/x"), "N/N/x_leve.mp4", "leve");
    igual(chaveDaCopia("t/g/abc.jpg", "outro/lugar/q_thumb.webp", "N/N/x"), null, "fora do padrão");
    igual(chaveDaCopia(`${base}.jpg`, null, "N/N/x"), null, "nula");
  });

  await etapa("copia: a foto fica nas duas, com id e chave próprios", async () => {
    const antes = await uso();
    const falso = armazemFalso();
    const r = await copiar({}, falso);
    igual(r.ok, true, "ok");
    igual([r.copiadas, r.restantes], [4, []], "copiadas");
    igual(await contar(origem.id), 4, "origem intacta");
    igual(await contar(destino.id), 5, "destino ganhou 4");
    const { rows } = await db.query(
      `select m.chave, m.chave_thumb, m.nome_original, m.ordem, m.pronto, m.id from medias m where m.galeria_id = $1 and m.nome_original like 'acervo-%' order by ordem`,
      [destino.id],
    );
    igual(rows.length, 4, "linhas");
    igual(rows.every((m) => m.pronto), true, "prontas");
    const chavesOrigem = new Set(origem.midias.map((m) => m.chave));
    igual(rows.every((m) => !chavesOrigem.has(m.chave) && m.chave.includes(`/${destino.id}/`)), true, "chave nova no destino");
    igual(rows.every((m) => m.chave_thumb?.includes(`/${destino.id}/`)), true, "thumb nova");
    igual(rows.map((m) => m.nome_original), origem.midias.map((m) => m.nome_original), "mesma ordem");
    igual(falso.f.copiados.length, 12, "original + 2 derivadas por foto");
    igual(String(BigInt(await uso()) - BigInt(antes)), String(4 * 2 * 1024 * 1024), "espaço sobe");
    igual(r.bytesCopiados, 4 * 2 * 1024 * 1024, "bytesCopiados");
  });

  await etapa("apagar a cópia não toca o original (linhas independentes)", async () => {
    await db.query("delete from medias where galeria_id = $1 and nome_original like 'acervo-%'", [destino.id]);
    igual(await contar(origem.id), 4, "origem ainda tem tudo");
  });

  await etapa("capítulo de destino e posição no fim", async () => {
    const { rows: [s] } = await db.query("insert into secoes (galeria_id, nome, ordem) values ($1, 'Analógicas', 0) returning id", [destino.id]);
    const r = await copiar({ secaoDestinoId: s.id, ids: ids.slice(0, 2) });
    igual(r.copiadas, 2, "copiadas");
    const { rows } = await db.query("select secao_id, ordem from medias where galeria_id = $1 and nome_original like 'acervo-%' order by ordem", [destino.id]);
    igual(rows.every((m) => m.secao_id === s.id), true, "no capítulo");
    igual(rows[0].ordem, 1, "depois da foto que já havia");
    await db.query("delete from medias where galeria_id = $1 and nome_original like 'acervo-%'", [destino.id]);
  });

  await etapa("favoritas e capa não vêm", async () => {
    await db.query("update galerias set capa_media_id = $2 where id = $1", [origem.id, ids[0]]);
    await db.query("insert into favoritas (galeria_id, media_id, visitante) values ($1, $2, 'v1')", [origem.id, ids[0]]).catch(() => {});
    await copiar({ ids: [ids[0]] });
    const { rows: [g] } = await db.query("select capa_media_id from galerias where id = $1", [destino.id]);
    igual(g.capa_media_id, null, "capa do destino");
    const { rows: [{ n }] } = await db.query("select count(*)::int as n from favoritas where galeria_id = $1", [destino.id]);
    igual(n, 0, "favoritas no destino");
    const { rows: [o] } = await db.query("select capa_media_id from galerias where id = $1", [origem.id]);
    igual(o.capa_media_id, ids[0], "a origem mantém a capa");
    await db.query("delete from medias where galeria_id = $1 and nome_original like 'acervo-%'", [destino.id]);
  });

  await etapa("rostos só vão para destino com a busca ligada", async () => {
    const vetor = `{${Array.from({ length: 128 }, () => "0.1").join(",")}}`;
    await db.query("insert into rostos (media_id, galeria_id, tenant_id, caixa, px, vetor) values ($1,$2,$3,'{}',10,$4)", [ids[0], origem.id, t.id, vetor]);
    await copiar({ ids: [ids[0]] });
    igual((await db.query("select count(*)::int as n from rostos where galeria_id = $1", [destino.id])).rows[0].n, 0, "busca desligada");
    await db.query("delete from medias where galeria_id = $1 and nome_original like 'acervo-%'", [destino.id]);
    await db.query("update galerias set rostos_ativos = true where id = $1", [destino.id]);
    await copiar({ ids: [ids[0]] });
    igual((await db.query("select count(*)::int as n from rostos where galeria_id = $1", [destino.id])).rows[0].n, 1, "busca ligada");
    igual((await db.query("select count(*)::int as n from rostos where galeria_id = $1", [origem.id])).rows[0].n, 1, "origem mantém");
    await db.query("update galerias set rostos_ativos = false where id = $1", [destino.id]);
    await db.query("delete from medias where galeria_id = $1 and nome_original like 'acervo-%'", [destino.id]);
  });

  await etapa("derivada que nunca existiu no armazém não vira chave morta", async () => {
    const r = await copiar({ ids: [ids[0]] }, armazemFalso({ semDerivada: true }));
    igual(r.ok, true, "ok");
    const { rows: [m] } = await db.query("select chave_thumb, chave_preview from medias where galeria_id = $1 and nome_original like 'acervo-%'", [destino.id]);
    igual([m.chave_thumb, m.chave_preview], [null, null], "sem derivadas");
    await db.query("delete from medias where galeria_id = $1 and nome_original like 'acervo-%'", [destino.id]);
  });

  await etapa("a quota barra a cópia que não cabe — sem copiar nada", async () => {
    const falso = armazemFalso();
    const usado = BigInt(await uso());
    const r = await copiar({ quotaBytes: usado + BigInt(1024) }, falso);
    igual(r.ok, false, "recusou");
    igual(falso.f.copiados.length, 0, "não copiou arquivo");
    igual(await contar(destino.id), 1, "destino igual");
  });

  await etapa("lote por peso: o resto volta em `restantes`", async () => {
    await db.query("update medias set bytes = $2 where galeria_id = $1", [origem.id, String(Math.floor(LIMITE_DE_BYTES_POR_CHAMADA * 0.4))]);
    const r = await copiar({}, armazemFalso());
    igual(r.ok, true, "ok");
    igual([r.copiadas, r.restantes.length], [2, 2], "2 por chamada");
    const r2 = await copiar({ ids: r.restantes }, armazemFalso());
    igual([r2.copiadas, r2.restantes.length], [2, 0], "o resto");
    await db.query("delete from medias where galeria_id = $1 and nome_original like 'acervo-%'", [destino.id]);
    await db.query("update medias set bytes = 2097152 where galeria_id = $1", [origem.id]);
    if (MAXIMO_POR_CHAMADA < 1) throw new Error("máximo inválido");
  });

  await etapa("falha no armazém: nenhuma linha, e o que já copiou é desfeito", async () => {
    const falso = armazemFalso({ falharEm: origem.midias[2].chave });
    const r = await copiar({}, falso);
    igual(r.ok, false, "falhou");
    igual(await contar(destino.id), 1, "nenhuma linha");
    const copiados = new Set(falso.f.copiados);
    igual([...copiados].every((c) => falso.f.apagados.includes(c)), true, "tudo que copiou foi apagado");
  });

  await etapa("outro estúdio não alcança nada", async () => {
    const falso = armazemFalso();
    const deles = await copiarMediasParaOutraGaleria({ tenantId: outro.id, origemId: origem.id, destinoId: alheia.id, secaoDestinoId: null, ids, quotaBytes: QUOTA, copiador: falso.copiador });
    igual(deles.ok, false, "origem alheia");
    const paraLa = await copiar({ destinoId: alheia.id }, falso);
    igual(paraLa.ok, false, "destino alheio");
    const secaoAlheia = await db.query("insert into secoes (galeria_id, nome, ordem) values ($1, 'x', 0) returning id", [alheia.id]);
    const comSecao = await copiar({ secaoDestinoId: secaoAlheia.rows[0].id }, falso);
    igual(comSecao.ok, false, "capítulo de outra galeria");
    const fotoAlheia = await copiar({ ids: [alheia.midias[0].id] }, falso);
    igual([fotoAlheia.ok, fotoAlheia.ok && fotoAlheia.copiadas], [true, 0], "foto de outra galeria não entra");
    igual(falso.f.copiados.length, 0, "nada foi copiado");
    igual((await copiar({ destinoId: origem.id }, falso)).ok, false, "para a mesma galeria");
  });

  await etapa("galeria no cofre ou na lixeira não recebe", async () => {
    for (const estado of ["arquivada", "lixeira"]) {
      await db.query("update galerias set estado = $2 where id = $1", [destino.id, estado]);
      igual((await copiar()).ok, false, estado);
    }
    await db.query("update galerias set estado = 'online' where id = $1", [destino.id]);
  });

  /* ── o cliente S3 ─────────────────────────────────────────────────────── */
  const clienteFalso = (tamanho, { semOrigem = false } = {}) => {
    const chamadas = [];
    return {
      chamadas,
      async send(cmd) {
        const nome = cmd.constructor.name;
        chamadas.push([nome, cmd.input]);
        if (nome === "HeadObjectCommand") {
          if (semOrigem) throw Object.assign(new Error("nf"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
          return { ContentLength: tamanho, ContentType: "video/mp4" };
        }
        if (nome === "CreateMultipartUploadCommand") return { UploadId: "u1" };
        if (nome === "UploadPartCopyCommand") return { CopyPartResult: { ETag: `"e${cmd.input.PartNumber}"` } };
        return {};
      },
    };
  };

  await etapa("S3: até 5 GB é um CopyObject só", async () => {
    const c = clienteFalso(3 * GB);
    igual(await copiarNoBalde(c, "bk", "a/b c/é.jpg", "a/b/n.jpg"), true, "copiou");
    igual(c.chamadas.map((x) => x[0]), ["HeadObjectCommand", "CopyObjectCommand"], "chamadas");
    igual(c.chamadas[1][1].CopySource, "bk/a/b%20c/%C3%A9.jpg", "origem codificada");
    igual(origemDaCopia("bk", "x/y.jpg"), "bk/x/y.jpg", "origem simples");
  });

  await etapa("S3: acima de 5 GB vira multipart no armazém, em partes de 512 MB", async () => {
    const c = clienteFalso(7 * GB);
    igual(await copiarNoBalde(c, "bk", "a.mov", "b.mov"), true, "copiou");
    const nomes = c.chamadas.map((x) => x[0]);
    igual(nomes[0], "HeadObjectCommand", "head");
    igual(nomes[1], "CreateMultipartUploadCommand", "abre");
    igual(nomes.filter((n) => n === "UploadPartCopyCommand").length, 14, "7 GB / 512 MB = 14 partes");
    igual(nomes.at(-1), "CompleteMultipartUploadCommand", "fecha");
    const ultima = c.chamadas.filter((x) => x[0] === "UploadPartCopyCommand").at(-1)[1];
    igual(ultima.CopySourceRange, `bytes=${13 * 512 * 1024 ** 2}-${7 * GB - 1}`, "faixa da última parte");
  });

  await etapa("S3: origem que não existe devolve false; falha no meio aborta", async () => {
    igual(await copiarNoBalde(clienteFalso(1, { semOrigem: true }), "bk", "a", "b"), false, "sem origem");
    const c = clienteFalso(6 * GB);
    const send = c.send.bind(c);
    c.send = async (cmd) => {
      if (cmd.constructor.name === "UploadPartCopyCommand" && cmd.input.PartNumber === 3) throw new Error("rede");
      return send(cmd);
    };
    let erro = null;
    await copiarNoBalde(c, "bk", "a", "b").catch((e) => (erro = e));
    igual(erro?.message, "rede", "lançou");
    igual(c.chamadas.at(-1)[0], "AbortMultipartUploadCommand", "abortou");
  });

  await etapa("a tela e a ação estão ligadas", async () => {
    const { readFileSync } = await import("node:fs");
    const lido = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    const grade = lido("src/components/grade-medias.tsx");
    if (!grade.includes("Copiar selecionadas para outra galeria")) throw new Error("o menu não oferece copiar");
    const acao = lido("src/app/painel/actions.ts");
    for (const t2 of ["situacaoDoTenant(tenant, asaasConfigurado())", "precisaConfirmarEmail(tenant)", "quotaEfetivaBytes(tenant)"]) {
      if (!acao.slice(acao.indexOf("copiarParaOutraGaleriaAction")).includes(t2)) throw new Error(`a ação não confere ${t2}`);
    }
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ copiar entre galerias tem problema" : "\n✓ copiar entre galerias ok");
process.exitCode = falhou ? 1 : 0;
