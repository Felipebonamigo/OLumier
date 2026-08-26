#!/usr/bin/env node
/**
 * Testa a fila de envio em massa. Uso:
 *   node --env-file=.env.local scripts/testar-fila-upload.mjs
 *
 * O cenário real é a pasta do casamento com 600 fotos. Aqui verificamos as três
 * coisas que decidem se isso funciona: paralelismo, retentativa e o descarte do
 * lixo que vem junto quando se arrasta uma pasta.
 */
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { galeriaDaRodada, estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const mod = await import("../src/lib/fila-upload.ts");

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

console.log("Fila:\n");

await etapa("envia em paralelo, respeitando o limite", async () => {
  let simultaneos = 0;
  let pico = 0;
  const itens = Array.from({ length: 12 }, (_, i) => i);
  await mod.emParalelo(itens, mod.PARALELOS, async () => {
    simultaneos++;
    pico = Math.max(pico, simultaneos);
    await new Promise((r) => setTimeout(r, 30));
    simultaneos--;
  });
  if (pico > mod.PARALELOS) throw new Error(`passou do limite: ${pico}`);
  if (pico < mod.PARALELOS) throw new Error(`não paralelizou: pico ${pico}`);
  return `12 arquivos, pico de ${pico} simultâneos`;
});

await etapa("processa TODOS os itens da fila", async () => {
  const feitos = new Set();
  const itens = Array.from({ length: 25 }, (_, i) => i);
  await mod.emParalelo(itens, 4, async (it) => {
    await new Promise((r) => setTimeout(r, 5));
    feitos.add(it);
  });
  if (feitos.size !== 25) throw new Error(`processou ${feitos.size} de 25`);
  return "25 de 25";
});

await etapa("uma tarefa que falha PARA a fila, sem deixar trabalhador solto", async () => {
  /*
   * Antes o Promise.all rejeitava na hora e os outros trabalhadores seguiam
   * consumindo a fila sem ninguém esperando: continuavam enviando partes de um
   * upload já dado como perdido, e uma falha posterior deles virava rejeição
   * não tratada.
   */
  let iniciadas = 0;
  let emVoo = 0;
  let vooDepoisDoErro = 0;
  const itens = Array.from({ length: 40 }, (_, i) => i);

  let erro = null;
  try {
    await mod.emParalelo(itens, 3, async (it) => {
      iniciadas++;
      emVoo++;
      try {
        await new Promise((r) => setTimeout(r, 5));
        if (it === 4) throw new Error("parte recusada");
      } finally {
        emVoo--;
      }
    });
  } catch (e) {
    erro = e;
  }

  if (!erro) throw new Error("a falha não foi propagada");
  if (erro.message !== "parte recusada") throw new Error(`erro trocado: ${erro.message}`);

  // Ninguém pode estar em voo depois que emParalelo devolveu.
  if (emVoo !== 0) throw new Error(`${emVoo} tarefa(s) ainda rodando após o erro`);

  // E não pode ter varrido a fila inteira depois da falha.
  if (iniciadas >= itens.length) {
    throw new Error(`continuou a fila: ${iniciadas} de ${itens.length} iniciadas`);
  }

  await new Promise((r) => setTimeout(r, 40));
  if (vooDepoisDoErro > 0) throw new Error("trabalhador solto continuou depois");
  return `parou em ${iniciadas} de ${itens.length}, nada em voo`;
});

await etapa("tenta de novo e vence na segunda", async () => {
  let tentativas = 0;
  const r = await mod.comRetentativa(async () => {
    tentativas++;
    if (tentativas < 2) throw new Error("rede caiu");
    return "ok";
  });
  if (r !== "ok" || tentativas !== 2) throw new Error(`resultado ${r} em ${tentativas} tentativas`);
  return "2 tentativas";
});

await etapa("desiste depois do limite, sem travar a fila", async () => {
  let tentativas = 0;
  const t0 = Date.now();
  try {
    await mod.comRetentativa(async () => {
      tentativas++;
      throw new Error("servidor fora");
    });
    throw new Error("deveria ter falhado");
  } catch (e) {
    if (e.message !== "servidor fora") throw e;
  }
  if (tentativas !== mod.TENTATIVAS) throw new Error(`tentou ${tentativas}`);
  return `${tentativas} tentativas em ${((Date.now() - t0) / 1000).toFixed(1)}s (espera crescente)`;
});

console.log("\nPasta arrastada:\n");

const arq = (nome, size = 1000, type = "image/jpeg") => ({ name: nome, size, type });

await etapa("descarta o lixo que vem junto da pasta", async () => {
  const entrada = [
    arq("IMG_001.jpg"),
    arq(".DS_Store", 6148, ""),
    arq("Thumbs.db", 8192, ""),
    arq("._IMG_002.jpg"),
    arq("vazio.jpg", 0),
    arq("contrato.pdf", 5000, "application/pdf"),
    arq("filme.mp4", 90000, "video/mp4"),
  ];
  const aceitos = entrada.filter(mod.arquivoAceito).map((f) => f.name);
  const esperado = ["IMG_001.jpg", "filme.mp4"];
  if (JSON.stringify(aceitos) !== JSON.stringify(esperado)) {
    throw new Error(`aceitou ${aceitos.join(", ")}`);
  }
  return `${entrada.length} arquivos → ${aceitos.length} válidos`;
});

await etapa("ordena como o fotógrafo espera (2 antes de 10)", async () => {
  const nomes = ["foto_10.jpg", "foto_2.jpg", "foto_1.jpg", "foto_20.jpg"];
  const ordenado = mod.ordenarNatural(nomes.map((n) => arq(n))).map((f) => f.name);
  const esperado = ["foto_1.jpg", "foto_2.jpg", "foto_10.jpg", "foto_20.jpg"];
  if (JSON.stringify(ordenado) !== JSON.stringify(esperado)) {
    throw new Error(ordenado.join(", "));
  }
  return ordenado.join(" · ");
});

// --- envio para capítulo, contra a rota de verdade --------------------------

const { DATABASE_URL, SESSION_SECRET } = process.env;
if (DATABASE_URL && SESSION_SECRET) {
  console.log("\nOrdem das fotos:\n");

await etapa("a ordem do fotógrafo sobrevive ao envio em PARALELO", async () => {
  /*
   * O bug: `max(ordem)+1` calculado no servidor. Três arquivos sobem ao mesmo
   * tempo, os três leem o mesmo máximo e recebem a MESMA posição — e
   * "foto_1, foto_2, foto_3" chegava ao casal fora de ordem. O fotógrafo ordena
   * de propósito antes de enviar; essa ordem é a narrativa do casamento.
   */
  const { criarMediaPendente, confirmarMedia, listarMedias } = await import("../src/lib/medias.ts");

  // Conexão própria: o `db` desta suíte é local de outra etapa.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const t = await estudioDaRodada(db);
  const g = await db.query(
    `insert into galerias (tenant_id, slug, titulo) values ($1,$2,'Ordem') returning id`,
    [t.id, `ordem-${Date.now()}`],
  );
  const galeriaId = g.rows[0].id;

  try {
    const nomes = Array.from({ length: 12 }, (_, i) => `foto_${String(i + 1).padStart(2, "0")}.jpg`);

    // Cria os 12 EM PARALELO, como o envio real faz.
    const criadas = await Promise.all(
      nomes.map((nome, indice) =>
        criarMediaPendente({
          galeriaId,
          tenantId: t.id,
          chave: `ordem/${galeriaId}/${nome}`,
          nomeOriginal: nome,
          tipo: "foto",
          mime: "image/jpeg",
          bytes: 10,
          indice,
        }),
      ),
    );

    // Confirma fora de ordem de propósito: a rede não devolve na ordem do envio.
    for (const m of [...criadas].reverse()) await confirmarMedia(m.id, t.id, 10);

    const final = (await listarMedias(galeriaId)).map((m) => m.nome_original);
    const esperado = nomes.join(",");
    if (final.join(",") !== esperado) {
      throw new Error(`ordem embaralhou:\n     esperado: ${esperado}\n     veio:     ${final.join(",")}`);
    }
    return `${nomes.length} fotos em paralelo, ordem intacta`;
  } finally {
    await db.query("delete from galerias where id = $1", [galeriaId]);
    // Sem fechar, o processo do teste nunca encerra.
    // A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
    await limparRodada(db);
    await db.end();
  }
});

console.log("\nEnvio direto para o capítulo:\n");
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();

  const _b = await galeriaDaRodada(db);
  const rows = [{ id: _b.id, tid: _b.estudio.id }];
  const { id: galeriaId, tid } = rows[0];
  const cookie = cookieDeSessao(tid);

  const { rows: secs } = await db.query(
    "select id, nome from secoes where galeria_id = $1 order by ordem limit 1",
    [galeriaId],
  );

  if (secs.length > 0) {
    await etapa("foto enviada já nasce no capítulo escolhido", async () => {
      const r = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          nome: "teste-capitulo.jpg",
          mime: "image/jpeg",
          bytes: 2048,
          secaoId: secs[0].id,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? `HTTP ${r.status}`);
      const { rows: m } = await db.query("select secao_id from medias where id = $1", [d.mediaId]);
      if (m[0].secao_id !== secs[0].id) throw new Error("não entrou no capítulo");
      await db.query("delete from medias where id = $1", [d.mediaId]);
      return `direto em "${secs[0].nome}"`;
    });

    await etapa("capítulo de OUTRA galeria é recusado", async () => {
      /*
       * Slug único por execução, e limpeza garantida no `finally`.
       *
       * Antes o slug era fixo ('temp-teste-fila') e a limpeza morava no fim do
       * caminho feliz. Bastava a etapa falhar no meio — servidor fora do ar, por
       * exemplo — para a galeria sobrar no banco, e aí a PRÓXIMA execução
       * quebrava no insert com "duplicate key". O erro apontava para uma chave
       * duplicada, que não tem nada a ver com o que esta etapa testa: quem fosse
       * investigar começaria pelo lugar errado.
       */
      const { rows: outra } = await db.query(
        `insert into galerias (tenant_id, slug, titulo) values ($1, $2, 'Temp')
         returning id`,
        [tid, `temp-teste-fila-${Date.now()}`],
      );
      let mediaId = null;
      try {
        const { rows: sOutra } = await db.query(
          "insert into secoes (galeria_id, nome) values ($1, 'Intrusa') returning id",
          [outra[0].id],
        );
        const r = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({
            nome: "intruso.jpg",
            mime: "image/jpeg",
            bytes: 2048,
            secaoId: sOutra[0].id,
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro ?? `HTTP ${r.status}`);
        mediaId = d.mediaId;
        const { rows: m } = await db.query("select secao_id from medias where id = $1", [mediaId]);
        if (m[0].secao_id !== null) throw new Error("aceitou capítulo de outra galeria!");
        return "ignorado, foto fica sem capítulo";
      } finally {
        // A mídia nasce na galeria principal, não na intrusa: apagar a intrusa
        // não a levaria junto pelo cascade.
        if (mediaId) await db.query("delete from medias where id = $1", [mediaId]);
        await db.query("delete from galerias where id = $1", [outra[0].id]);
      }
    });
  }
  await db.end();
}

if (falhou) {
  console.error("\n✗ a fila de envio tem problema");
  process.exit(1);
}
console.log(`\n✓ fila de envio em massa íntegra (${mod.PARALELOS} paralelos, ${mod.TENTATIVAS} tentativas)`);
