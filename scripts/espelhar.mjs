#!/usr/bin/env node
/**
 * Espelha os arquivos que ainda estão com uma cópia só.
 *
 *   ... scripts/espelhar.mjs              → mostra o que falta (não copia nada)
 *   ... scripts/espelhar.mjs --aplicar    → copia
 *   ... scripts/espelhar.mjs --aplicar --limite=200
 *
 * Roda pelo temporizador do servidor, de madrugada. Por que temporizador e não
 * no momento do upload: espelhar durante o envio faria o fotógrafo esperar a
 * cópia de um vídeo de 30 GB para ver "pronto" na tela, e uma queda do B2
 * viraria falha de upload. Assim o caminho do usuário não depende do backup —
 * arquivo novo nasce na fila e sai dela sozinho.
 *
 * A janela de exposição é o preço: um arquivo enviado às 10h da manhã fica com
 * cópia única até a passada da madrugada. É aceitável porque o risco coberto
 * (perder a CONTA inteira) não é um evento que escolhe a hora — e cortar a
 * janela para zero custaria o upload travado, que é pior todo dia.
 */
import pg from "pg";
import {
  espelhoConfigurado,
  espelharObjeto,
  objetoEspelhadoExiste,
  conferirEspelho,
  DEVE_ESPELHAR,
  ORIGINAIS_SEM_COPIA,
  contarCopiaUnica,
} from "../src/lib/espelho.ts";

const APLICAR = process.argv.includes("--aplicar");
const limiteArg = process.argv.find((a) => a.startsWith("--limite="));
const LIMITE = limiteArg ? Number(limiteArg.split("=")[1]) : 500;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

if (!espelhoConfigurado) {
  console.error("✗ espelho não configurado — faltam ESPELHO_ENDPOINT, ESPELHO_ACCESS_KEY_ID,");
  console.error("  ESPELHO_SECRET_ACCESS_KEY e ESPELHO_BUCKET no arquivo de ambiente.");
  console.error("  Ver docs/backup.md → 'Ligar o espelho'.");
  process.exit(1);
}

const saude = await conferirEspelho();
if (!saude.ok) {
  console.error(`✗ o espelho não respondeu: ${saude.erro}`);
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  /* A fila vem de `lib/espelho.ts` e cobre mídias E logos — a logo é arquivo
   * enviado pelo fotógrafo, não se regenera, e ficou fora do espelho até
   * 25/08/2026. Ver ORIGINAIS_SEM_COPIA. */
  const { rows } = await db.query(ORIGINAIS_SEM_COPIA);

  /* Miniatura e preview não entram (ver DEVE_ESPELHAR): são geradas no
   * navegador e a galeria cai para o original se sumirem. */
  const candidatos = rows.filter((r) => DEVE_ESPELHAR(r.chave));
  const pulados = rows.length - candidatos.length;
  const fila = candidatos.slice(0, LIMITE);

  const { rows: totais } = await db.query(
    `select count(*) filter (where espelhado_em is not null) as espelhados,
            count(*) filter (where pronto and espelhado_em is null) as pendentes
       from medias`,
  );
  const t = totais[0];
  const logos = candidatos.filter((r) => r.origem === "logo").length;

  console.log(`espelhados: ${t.espelhados} · mídias na fila: ${t.pendentes} · logos: ${logos}`);
  if (pulados > 0) console.log(`(${pulados} derivada(s) fora do espelho, por desenho)`);

  /*
   * O número que não pode ficar escondido. Desde 25/08/2026 o original nasce no
   * B2, e o espelho não tem para onde copiá-lo — ele fica com CÓPIA ÚNICA até o
   * espelho frio (Hetzner) existir. É decisão tomada, não defeito; mas decisão
   * que some do log vira surpresa meses depois, quando ninguém lembra dela.
   */
  const so1 = await contarCopiaUnica();
  if (so1.arquivos > 0) {
    const gb = (Number(so1.bytes) / 1024 ** 3).toFixed(2);
    console.log(
      `\n⚠ ${so1.arquivos} arquivo(s) (${gb} GB) estão com CÓPIA ÚNICA no B2 — sem segundo\n` +
        `  fornecedor, a promessa de "duas empresas" não vale para eles. Some quando o\n` +
        `  espelho frio entrar (fase 4, docs/obra-rota-b2.md).`,
    );
  }

  if (fila.length === 0) {
    console.log("✓ nada a espelhar");
    process.exit(0);
  }

  const totalBytes = fila.reduce((s, r) => s + Number(r.bytes ?? 0), 0);
  console.log(
    `${fila.length} arquivo(s) nesta passada, ${(totalBytes / 1024 ** 3).toFixed(2)} GB`,
  );

  if (!APLICAR) {
    console.log("\nNada foi copiado. Para copiar: --aplicar");
    process.exit(0);
  }

  let copiados = 0;
  let jaEstavam = 0;
  const falhas = [];

  for (const m of fila) {
    /* Já estar lá acontece quando uma passada morreu no meio: o objeto subiu e
     * o banco não chegou a ser marcado. Conferir antes é uma chamada barata que
     * evita repetir a cópia de um vídeo inteiro. */
    if (await objetoEspelhadoExiste(m.chave)) {
      /* A logo não tem coluna de controle — ela volta na fila toda noite e sai
       * dela por esta conferência, que custa um HEAD por estúdio. Só a mídia
       * tem `espelhado_em` para marcar. */
      if (m.id) await db.query("update medias set espelhado_em = now() where id = $1", [m.id]);
      jaEstavam++;
      continue;
    }

    const r = await espelharObjeto(m.chave);
    if (r.ok) {
      /* Marcar SÓ depois do envio terminar. Marcar antes deixaria um arquivo
       * sem cópia parecendo protegido — a mentira mais cara que este script
       * poderia contar. (A logo não tem o que marcar: ver acima.) */
      if (m.id) await db.query("update medias set espelhado_em = now() where id = $1", [m.id]);
      copiados++;
    } else {
      falhas.push({ chave: m.chave, erro: r.erro });
    }
  }

  console.log(`\n✓ ${copiados} copiado(s)${jaEstavam ? `, ${jaEstavam} já estava(m) lá` : ""}`);

  if (falhas.length > 0) {
    console.error(`✗ ${falhas.length} falharam (continuam na fila para a próxima passada):`);
    for (const f of falhas.slice(0, 10)) console.error(`    ${f.chave}: ${f.erro}`);
    if (falhas.length > 10) console.error(`    … e mais ${falhas.length - 10}`);
    /* Código 1 para o temporizador registrar como falha e o e-mail sair. A fila
     * não some — arquivo que falhou continua com espelhado_em nulo. */
    process.exit(1);
  }
} finally {
  await db.end();
}
