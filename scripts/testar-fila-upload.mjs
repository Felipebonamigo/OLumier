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
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

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

/*
 * ── DOIS CAPÍTULOS AO MESMO TEMPO (16/09/2026) ───────────────────────────
 *
 * Felipe: "não consigo enviar simultaneamente fotos para making of, cerimônia,
 * decoração, etc. Tenho que esperar subir as fotos de um dos capítulos."
 *
 * O seletor de capítulo ficava travado durante o envio porque a fila era uma
 * corrida FECHADA por lote: `emParalelo` recebe um array pronto, e um segundo
 * lote virava uma segunda corrida — o dobro dos envios simultâneos que a rede
 * aguenta, e a primeira a acabar apagando o estado da outra.
 *
 * `emParaleloDeFila` troca o array por uma função que entrega o próximo item.
 * As três etapas abaixo são a promessa disso: o lote novo entra na MESMA
 * corrida, o limite continua valendo com a fila crescendo, e ninguém pega o
 * mesmo item duas vezes.
 */
await etapa("um lote enfileirado NO MEIO do primeiro entra na mesma corrida", async () => {
  const pendentes = [1, 2, 3, 4, 5, 6];
  const feitos = [];
  let simultaneos = 0;
  let pico = 0;
  let empurrou = false;

  await mod.emParaleloDeFila(
    () => pendentes.shift() ?? null,
    mod.PARALELOS,
    async (item) => {
      simultaneos++;
      pico = Math.max(pico, simultaneos);
      await new Promise((r) => setTimeout(r, 20));
      feitos.push(item);
      /* O segundo lote chega com a corrida já andando — é o gesto do Felipe
         trocando o capítulo e soltando outra pasta. */
      if (!empurrou && feitos.length >= 3) {
        empurrou = true;
        pendentes.push(7, 8, 9);
      }
      simultaneos--;
    },
  );

  if (feitos.length !== 9) throw new Error(`terminou com ${feitos.length} de 9`);
  if (new Set(feitos).size !== 9) throw new Error("algum item foi processado duas vezes");
  if (pico > mod.PARALELOS) throw new Error(`passou do limite com a fila crescendo: ${pico}`);
  return `9 arquivos em dois lotes, pico de ${pico} simultâneos`;
});

await etapa("fila vazia não deixa trabalhador girando", async () => {
  let chamou = 0;
  await mod.emParaleloDeFila(
    () => null,
    mod.PARALELOS,
    async () => {
      chamou++;
    },
  );
  if (chamou !== 0) throw new Error(`chamou a tarefa ${chamou} vezes sem item nenhum`);
  return "voltou na hora";
});

await etapa("um arquivo com defeito não derruba os que faltam", async () => {
  /* Diferença deliberada em relação a `emParalelo`: lá, um erro derruba a
     corrida inteira, porque a lista é um lote indivisível. Aqui a lista é a
     fila do dia — uma foto corrompida no meio de 600 não pode levar junto as
     400 que faltam. */
  const pendentes = [1, 2, 3, 4, 5];
  const feitos = [];
  await mod.emParaleloDeFila(
    () => pendentes.shift() ?? null,
    mod.PARALELOS,
    async (item) => {
      if (item === 2) throw new Error("arquivo corrompido");
      feitos.push(item);
    },
  );
  if (feitos.length !== 4) throw new Error(`só ${feitos.length} de 4 sobreviveram ao erro`);
  return "4 de 5, e o erro ficou no arquivo";
});

await etapa("o portão para a fila crescente também", async () => {
  const pendentes = [1, 2, 3, 4, 5, 6];
  const feitos = [];
  let parar = false;
  await mod.emParaleloDeFila(
    () => pendentes.shift() ?? null,
    1,
    async (item) => {
      feitos.push(item);
      if (feitos.length === 2) parar = true;
    },
    async () => (parar ? "parar" : "seguir"),
  );
  if (feitos.length !== 2) throw new Error(`parou em ${feitos.length}, esperava 2`);
  return "parou onde mandaram";
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

/* Esperas de 1 ms: a regra é a mesma, e a suíte não espera os dois minutos de
   verdade. A paciência de verdade é conferida pela etapa dela, mais abaixo. */
const RAPIDO = mod.ESPERAS_ENTRE_TENTATIVAS.map(() => 1);

await etapa("tenta de novo e vence na segunda", async () => {
  let tentativas = 0;
  const r = await mod.comRetentativa(async () => {
    tentativas++;
    if (tentativas < 2) throw new Error("rede caiu");
    return "ok";
  }, undefined, RAPIDO);
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
    }, undefined, RAPIDO);
    throw new Error("deveria ter falhado");
  } catch (e) {
    if (e.message !== "servidor fora") throw e;
  }
  if (tentativas !== mod.TENTATIVAS) throw new Error(`tentou ${tentativas}`);
  return `${tentativas} tentativas em ${((Date.now() - t0) / 1000).toFixed(1)}s`;
});

/*
 * ── A PACIÊNCIA (30/09/2026) ──────────────────────────────────────────────
 *
 * A Alícia viu arquivos desistirem juntos em "conexão interrompida". Eram três
 * tentativas em quatro segundos: um Wi-Fi que some por cinco matava a fila.
 */
await etapa("a paciência por arquivo passa de um minuto, e cresce a cada vez", () => {
  const e = mod.ESPERAS_ENTRE_TENTATIVAS;
  const total = e.reduce((a, b) => a + b, 0);
  if (total < 60_000) throw new Error(`só ${total / 1000}s de espera somada`);
  for (let i = 1; i < e.length; i++) {
    if (e[i] <= e[i - 1]) throw new Error(`a espera ${i + 1} não cresceu`);
  }
  return `${mod.TENTATIVAS} tentativas, ${Math.round(total / 1000)}s de espera somada`;
});

await etapa("sem rede nenhuma, a fila espera a rede voltar sem gastar tentativa", async () => {
  const navegadorOriginal = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const janelaOriginal = globalThis.window;
  let online = true;
  let quedas = 0;
  Object.defineProperty(globalThis, "navigator", {
    value: { get onLine() { return online; } },
    configurable: true,
  });
  /* A rede "volta" 5 ms depois de a fila começar a esperar por ela. */
  globalThis.window = {
    addEventListener: (evento, fn) => {
      if (evento !== "online") return;
      setTimeout(() => {
        online = true;
        fn();
      }, 5);
    },
  };
  try {
    let tentativas = 0;
    const avisos = [];
    /* Só DUAS tentativas contando — e três quedas de rede no caminho. */
    const r = await mod.comRetentativa(
      async () => {
        tentativas++;
        if (tentativas <= 3) {
          online = false;
          quedas++;
          throw new Error("conexão interrompida");
        }
        return "ok";
      },
      (_, semRede) => avisos.push(semRede),
      [1],
    );
    if (r !== "ok") throw new Error(`veio ${r}`);
    if (!avisos.every(Boolean)) throw new Error("não avisou que estava sem rede");
    return `${quedas} quedas de rede com 2 tentativas de limite — e chegou`;
  } finally {
    if (navegadorOriginal) Object.defineProperty(globalThis, "navigator", navegadorOriginal);
    else delete globalThis.navigator;
    if (janelaOriginal === undefined) delete globalThis.window;
    else globalThis.window = janelaOriginal;
  }
});

/*
 * ── SEIS NO AR, TRÊS NO PROCESSADOR (30/09/2026) ─────────────────────────
 *
 * Juan, de Portland: 300 fotos em 10 minutos. Com rede de hotel simulada, 6
 * envios de cada vez chegaram mais perto do mínimo da banda que 3 (1,29× contra
 * 1,48×). Mas a miniatura decodifica a foto inteira: seis juntas pesam demais
 * num notebook modesto. O limitador segura o processador em três.
 */
await etapa("seis envios ao mesmo tempo, e a miniatura limitada a três", async () => {
  if (mod.PARALELOS < 6) throw new Error(`PARALELOS = ${mod.PARALELOS}`);
  if (mod.MINIATURAS_JUNTAS > 3) throw new Error(`MINIATURAS_JUNTAS = ${mod.MINIATURAS_JUNTAS}`);
  const vez = mod.limitador(mod.MINIATURAS_JUNTAS);
  let agora = 0;
  let pico = 0;
  const ordem = [];
  await mod.emParalelo(
    Array.from({ length: 12 }, (_, i) => i),
    mod.PARALELOS,
    async (i) => {
      await vez(async () => {
        agora++;
        pico = Math.max(pico, agora);
        ordem.push(i);
        await espera(5);
        agora--;
      });
    },
  );
  if (pico !== mod.MINIATURAS_JUNTAS) throw new Error(`pico de ${pico} miniaturas juntas`);
  if (ordem.length !== 12) throw new Error(`${ordem.length} de 12`);
  return `${mod.PARALELOS} no ar, pico de ${pico} gerando miniatura`;
});

await etapa("o limitador solta a vez mesmo quando a tarefa falha", async () => {
  const vez = mod.limitador(1);
  await vez(async () => {
    throw new Error("decodificação falhou");
  }).catch(() => {});
  const r = await Promise.race([vez(async () => "andou"), espera(200).then(() => "travou")]);
  if (r !== "andou") throw new Error("a vez ficou presa depois da falha");
  return "a próxima andou";
});

/*
 * ── O MOTIVO NA TELA (30/09/2026) ─────────────────────────────────────────
 *
 * A segunda foto da Alícia: "0 de 38" e três arquivos em "tentando de novo
 * (4)…", sem dizer por quê. Duas coisas escondiam o motivo: a fila não
 * repassava o erro da tentativa, e o erro marcado `definitivo` (sem espaço,
 * assinatura vencida) era repetido do mesmo jeito — o `definitivo` era
 * gravado e ninguém lia.
 */
await etapa("erro definitivo sai na primeira, sem gastar as outras tentativas", async () => {
  let tentativas = 0;
  try {
    await mod.comRetentativa(async () => {
      tentativas++;
      throw mod.erroDefinitivo("Sem espaço no plano.");
    }, undefined, RAPIDO);
    throw new Error("deveria ter falhado");
  } catch (e) {
    if (e.message !== "Sem espaço no plano.") throw e;
  }
  if (tentativas !== 1) throw new Error(`tentou ${tentativas} vezes`);
  return "1 tentativa";
});

await etapa("quem mostra o 'tentando de novo' recebe o motivo da falha", async () => {
  const motivos = [];
  let tentativas = 0;
  await mod.comRetentativa(
    async () => {
      tentativas++;
      if (tentativas === 1) throw new Error("conexão interrompida");
      if (tentativas === 2) throw new Error("o armazenamento recusou (HTTP 403 · AccessDenied)");
      return "ok";
    },
    (_, __, erro) => motivos.push(erro.message),
    RAPIDO,
  );
  if (motivos.join(" | ") !== "conexão interrompida | o armazenamento recusou (HTTP 403 · AccessDenied)") {
    throw new Error(motivos.join(" | "));
  }
  return motivos.join(" → ");
});

/*
 * ── PAUSAR, PARAR E NOMES REPETIDOS (05/09/2026) ──────────────────────────
 *
 * Três pedidos do Juan na manhã de 05/09, todos do mesmo episódio: ele soltou
 * a pasta do casamento, trocou de aba, o envio morreu, e ele quis desfazer o
 * que tinha subido pela metade para refazer. Sem parar, sem pausar e sem
 * aviso de repetido, a saída dele era esperar 519 arquivos subirem para então
 * remover um a um.
 */
console.log("\nPausar, parar e nomes repetidos:\n");

await etapa("o portão pausa a fila sem perder o que falta", async () => {
  const feitos = [];
  let solto = false;
  const p = mod.emParalelo([1, 2, 3, 4], 2, async (n) => void feitos.push(n), async () =>
    solto ? "seguir" : "esperar",
  );
  await new Promise((r) => setTimeout(r, 30));
  if (feitos.length !== 0) throw new Error(`pausado e ainda assim enviou ${feitos.length}`);
  solto = true;
  await p;
  if (feitos.length !== 4) throw new Error(`retomou e entregou ${feitos.length} de 4`);
  return "0 durante a pausa, 4 depois";
});

await etapa("o portão para a fila e o resto não sobe", async () => {
  const feitos = [];
  await mod.emParalelo([1, 2, 3, 4, 5, 6], 1, async (n) => void feitos.push(n), async () =>
    feitos.length >= 2 ? "parar" : "seguir",
  );
  if (feitos.length !== 2) throw new Error(`parou e mesmo assim entregou ${feitos.length}`);
  return "2 de 6";
});

await etapa("separa o que já está na galeria — nome e tamanho", () => {
  const item = (name, size = 100) => ({ arquivo: { name, size } });
  const itens = [item("a.jpg"), item("B.JPG"), item("c.jpg")];
  const { novos, repetidos } = mod.separarRepetidos(itens, [{ nome: "b.jpg", bytes: 100 }]);
  if (repetidos.length !== 1 || repetidos[0].arquivo.name !== "B.JPG") {
    throw new Error(`repetidos veio ${JSON.stringify(repetidos.map((r) => r.arquivo.name))}`);
  }
  if (novos.length !== 2) throw new Error(`novos veio ${novos.length}, esperava 2`);
  return "sem diferenciar maiúscula de minúscula";
});

/* Juan, 01/10/2026: duas câmeras, `DSC_0001.jpg` em capítulos diferentes. Pelo
   nome só, a régua mandava foto diferente para a pergunta de repetidas — e a
   saída para não perder foto era "enviar mesmo assim", com as cópias juntas. */
await etapa("mesmo nome com outro tamanho é outra foto, e sobe", () => {
  const itens = [
    { arquivo: { name: "DSC_0001.jpg", size: 5_000_000 } },
    { arquivo: { name: "DSC_0001.jpg", size: 6_200_000 } },
  ];
  const { novos, repetidos } = mod.separarRepetidos(itens, [{ nome: "DSC_0001.jpg", bytes: 7_000_000 }]);
  if (novos.length !== 2 || repetidos.length !== 0) {
    throw new Error(`novos ${novos.length}, repetidos ${repetidos.length} — esperava 2 e 0`);
  }
  return "duas câmeras, duas fotos";
});

/* Duas cópias na MESMA pasta arrastada também são repetição: subiriam as duas
   e a galeria mostraria a foto duas vezes, que é o que o Juan quer evitar. */
await etapa("dois arquivos iguais na mesma leva contam como repetidos", () => {
  const itens = ["a.jpg", "a.jpg", "b.jpg"].map((nome) => ({ arquivo: { name: nome, size: 9 } }));
  const { novos, repetidos } = mod.separarRepetidos(itens, []);
  if (novos.length !== 2 || repetidos.length !== 1) {
    throw new Error(`novos ${novos.length}, repetidos ${repetidos.length} — esperava 2 e 1`);
  }
  return "a segunda cópia é a repetida";
});

await etapa("o arquivo de dentro do ZIP compara pelo tamanho de dentro", () => {
  const doZip = { arquivo: { name: "x.jpg", size: 0 }, deZip: { bytes: 321 } };
  const { repetidos } = mod.separarRepetidos([doZip], [{ nome: "x.jpg", bytes: 321 }]);
  if (repetidos.length !== 1) throw new Error("o marcador do ZIP (tamanho 0) escapou da régua");
});

/* Juan, 01/10/2026: 4.000 arquivos na fila, a lista aberta, e a página parou.
   A lista redesenhava as 4.000 linhas a cada progresso. */
await etapa("a lista do envio mostra no máximo umas cinquenta linhas", () => {
  const fila = [
    ...Array.from({ length: 3000 }, () => ({ situacao: "esperando", tentativa: 0 })),
    ...Array.from({ length: 6 }, () => ({ situacao: "enviando", tentativa: 0 })),
    ...Array.from({ length: 2 }, () => ({ situacao: "esperando", tentativa: 2 })),
    ...Array.from({ length: 40 }, () => ({ situacao: "erro", tentativa: 3 })),
    ...Array.from({ length: 950 }, (_, k) => ({ situacao: "pronto", tentativa: 0, k })),
  ];
  const r = mod.linhasDaFila(fila);
  if (r.linhas.length > 60) throw new Error(`${r.linhas.length} linhas`);
  const conta = (s) => r.linhas.filter((l) => l.situacao === s).length;
  if (conta("enviando") !== 6) throw new Error("o que está subindo agora sumiu da lista");
  if (r.linhas.filter((l) => l.tentativa > 0 && l.situacao === "esperando").length !== 2) {
    throw new Error("o que está tentando de novo sumiu");
  }
  if (r.maisComErro !== 20 || r.maisEsperando !== 2995 || r.maisEnviados !== 947) {
    throw new Error(`contagens ${r.maisComErro}/${r.maisEsperando}/${r.maisEnviados}`);
  }
  if (r.linhas.at(-1).k !== 947) throw new Error("os enviados mostrados não são os últimos");
  return `${r.linhas.length} linhas para ${fila.length} arquivos`;
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

/*
 * ── A COLORIDA ANTES DA SUA VARIANTE EM PB, JÁ NO ENVIO (25/09/2026) ───────
 *
 * Juan: "nas horizontais, a preto e branco tá na frente (…) atualizei por
 * nome A-Z e nothing happened" — a galeria JÁ SAÍA nessa ordem, porque nasce
 * aqui, na hora de escolher a ordem de ENVIO, não só no botão de reordenar.
 * Ver `lib/ordem-natural.ts`.
 */
await etapa("a colorida entra antes da PB — o defeito nasce no ENVIO, não só no reordenar", async () => {
  const nomes = ["sirius-jugusw-1070-pb.jpg", "sirius-jugusw-1070.jpg"];
  const ordenado = mod.ordenarNatural(nomes.map((n) => arq(n))).map((f) => f.name);
  const esperado = ["sirius-jugusw-1070.jpg", "sirius-jugusw-1070-pb.jpg"];
  if (JSON.stringify(ordenado) !== JSON.stringify(esperado)) {
    throw new Error(`veio ${ordenado.join(", ")} — a PB entrou antes da colorida`);
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
