#!/usr/bin/env node
/**
 * A URL de leitura assinada sem o `getSignedUrl` é a MESMA de antes. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-assinatura-de-leitura.mjs
 *
 * ── POR QUE EXISTE (26/09/2026) ───────────────────────────────────────────
 *
 * "A galeria parece lenta para abrir." Numa galeria de 600 fotos, 600 chamadas
 * a `getSignedUrl` custavam ~200 ms de CPU no servidor — mais que todo o resto
 * da página. `urlDeLeitura` passou a usar o assinador do SDK direto, criado uma
 * vez, montando à mão o pedido que ele assina. Ver o cabeçalho em
 * `src/lib/r2.ts`.
 *
 * Montar o pedido à mão é onde mora o risco: um caractere escapado diferente, a
 * porta que some do host, o bucket no lugar errado — e toda miniatura de toda
 * galeria responde 403. Nenhum teste com galeria de exemplo pegaria, porque as
 * chaves que o app gera são só letras, números e hífen.
 *
 * Então a exigência aqui não é "uma URL que funcione": é a URL IDÊNTICA à do
 * `getSignedUrl`, byte a byte, no mesmo instante. Se for igual, o armazém não
 * tem como distinguir as duas.
 *
 * ── CADA ENDEREÇO NUM PROCESSO PRÓPRIO ────────────────────────────────────
 *
 * `r2.ts` lê o ambiente quando é importado, e os três jeitos de endereço — o
 * do R2 em produção, o do MinIO do CI, e um endereço próprio com porta — só
 * existem com ambientes diferentes. Cada um roda num processo filho com o
 * ambiente escrito AQUI, e não herdado: o `.env.local` de quem roda não pode
 * decidir qual caso foi testado.
 */
import { spawnSync } from "node:child_process";

const CENARIOS = {
  "R2 de produção (bucket no host)": {
    R2_ACCOUNT_ID: "e9c4a117bdcb25c2c1974d2a526aff31",
  },
  "MinIO do CI (bucket no caminho, http e porta)": {
    R2_ACCOUNT_ID: "conta-de-mentira",
    R2_ENDPOINT: "http://127.0.0.1:9000",
    ARMAZEM_CAMINHO_NO_ENDERECO: "1",
  },
  "endereço próprio com porta, bucket no host": {
    R2_ACCOUNT_ID: "conta-de-mentira",
    R2_ENDPOINT: "https://armazem.exemplo.com.br:8443",
    R2_REGIAO: "sa-east-1",
  },
};

if (process.env.ASSINATURA_CENARIO) {
  await compararNesteProcesso();
} else {
  let falhou = false;
  for (const [nome, ambiente] of Object.entries(CENARIOS)) {
    const r = spawnSync(
      process.execPath,
      /* As mesmas flags deste processo, menos o `--env-file`: o ambiente do
         filho é só o do cenário. */
      [...process.execArgv.filter((a) => !a.startsWith("--env-file")), import.meta.filename],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          ASSINATURA_CENARIO: nome,
          R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
          R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
          R2_BUCKET: "galerias",
          ...ambiente,
        },
      },
    );
    const saida = (r.stdout ?? "").trim().split("\n").pop() ?? "";
    let res;
    try {
      res = JSON.parse(saida);
    } catch {
      falhou = true;
      console.error(`  ✗ ${nome}: o processo do cenário não respondeu\n${r.stdout}${r.stderr}`);
      continue;
    }
    console.log(`\n${nome}`);
    if (res.divergencias.length === 0) {
      console.log(`  ✓ ${res.total} URLs idênticas às do getSignedUrl`);
    } else {
      falhou = true;
      for (const d of res.divergencias.slice(0, 5)) {
        console.error(`  ✗ ${d.caso}\n      sdk:  ${d.sdk}\n      nossa: ${d.nossa}`);
      }
      if (res.divergencias.length > 5) console.error(`  ✗ … e mais ${res.divergencias.length - 5}`);
    }
    /*
     * A velocidade é o motivo de a função existir, então ela também é
     * conferida — com folga larga: medido, o caminho novo é ~6× mais rápido, e
     * a exigência é só metade do tempo. Voltar ao `getSignedUrl` por descuido
     * reprova aqui; uma máquina ocupada no meio da medição, não.
     */
    if (res.msNossa * 2 <= res.msSdk) {
      console.log(
        `  ✓ ${res.lote} assinaturas em ${res.msNossa.toFixed(0)} ms (o getSignedUrl levou ${res.msSdk.toFixed(0)} ms)`,
      );
    } else {
      falhou = true;
      console.error(
        `  ✗ ${res.lote} assinaturas em ${res.msNossa.toFixed(0)} ms, contra ${res.msSdk.toFixed(0)} ms do getSignedUrl — ` +
          `a assinatura voltou a passar pelo SDK inteiro?`,
      );
    }
  }
  if (falhou) {
    console.error("\n✗ a URL de leitura mudou");
    process.exit(1);
  }
  console.log("\n✓ a URL de leitura continua a mesma, só mais barata");
}

async function compararNesteProcesso() {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const { urlDeLeituraAssinadaEm, OPCOES_DO_CLIENTE, BUCKET } = await import("../src/lib/r2.ts");
  const { dispositionSegura } = await import("../src/lib/disposition.ts");

  /* O cliente de referência é montado como `r2.ts` monta o dele — é a URL que
     o app gerava até hoje. */
  const sdk = new S3Client({
    ...OPCOES_DO_CLIENTE,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const pelaReferencia = (quando, chave, expira, nome) =>
    getSignedUrl(
      sdk,
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: chave,
        ...(nome ? { ResponseContentDisposition: dispositionSegura(nome) } : {}),
      }),
      { expiresIn: expira, signingDate: quando },
    );

  const t = "6f1c2a9e-3b7d-4e21-9c4a-0d5e8f7a1b2c";
  const g = "a3d9b0c4-58e1-4f7a-b2c6-19e0d4f3a8b7";
  const chaves = [
    /* As que o app gera (`montarChaves`, `chaveDaLogo`)… */
    `${t}/${g}/0b9e2f1a-7c3d-4a58-9e6b-2d1f0c8a7b3e_thumb.webp`,
    `${t}/${g}/0b9e2f1a-7c3d-4a58-9e6b-2d1f0c8a7b3e_prev.avif`,
    `${t}/${g}/0b9e2f1a-7c3d-4a58-9e6b-2d1f0c8a7b3e.jpg`,
    `${t}/marca/5e4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c.png`,
    /* …e as que nenhuma galeria de exemplo tem, onde a codificação erra. */
    "pasta com espaço/foto+mais (1).jpg",
    "ç/ã/é/Cerimônia & Festa.jpg",
    "símbolos/!'()*~._-.jpg",
    "por-cento/%41%2F.jpg",
    "emoji/😀💍.heic",
    "nome;com=coisas?e#mais@aqui,.jpg",
  ];
  const nomes = [undefined, "Ana & Pedro — Cerimônia.jpg", 'aspas "duplas" e \\barra.jpg'];
  const validades = [120, 3600, 6 * 3600];
  /* Duas datas: uma qualquer, e uma virada de dia em UTC — a data entra no
     escopo da credencial, e o dia errado é um defeito clássico de assinatura. */
  const datas = [new Date("2026-09-26T12:34:56Z"), new Date("2026-12-31T23:59:59Z")];

  const divergencias = [];
  let total = 0;
  for (const quando of datas) {
    for (const chave of chaves) {
      for (const nome of nomes) {
        for (const expira of validades) {
          total++;
          const [ref, nossa] = await Promise.all([
            pelaReferencia(quando, chave, expira, nome),
            urlDeLeituraAssinadaEm(quando, chave, expira, nome),
          ]);
          if (ref !== nossa) {
            divergencias.push({
              caso: `${JSON.stringify(chave)} · ${nome ?? "sem nome"} · ${expira}s · ${quando.toISOString()}`,
              sdk: ref,
              nossa,
            });
          }
        }
      }
    }
  }

  /* A medida: um lote do tamanho de uma galeria, depois de aquecer os dois. */
  const LOTE = 300;
  const lote = Array.from({ length: LOTE }, (_, i) => `${t}/${g}/${i}-foto_thumb.webp`);
  const agora = new Date();
  const medir = async (fn) => {
    const t0 = performance.now();
    for (const c of lote) await fn(agora, c, 6 * 3600);
    return performance.now() - t0;
  };
  await medir(pelaReferencia);
  await medir(urlDeLeituraAssinadaEm);
  const msSdk = await medir(pelaReferencia);
  const msNossa = await medir(urlDeLeituraAssinadaEm);

  console.log(JSON.stringify({ total, divergencias, lote: LOTE, msSdk, msNossa }));
}
