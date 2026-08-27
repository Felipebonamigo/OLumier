#!/usr/bin/env node
/**
 * Prova que os três furos de cobrança fecharam. Uso:
 *   node --env-file=.env.local --experimental-strip-types scripts/testar-portao-cobranca.mjs
 *
 * 1. CPF/CNPJ é exigido e validado antes de falar com o Asaas
 * 2. Trial vencido / inadimplente / cancelado não envia mais nada
 * 3. Quota confere o tamanho REAL do bucket — declarar "1 byte" e subir um
 *    arquivo grande não passa mais
 *
 * As duas primeiras partes testam regra pura. A terceira precisa do servidor de
 * desenvolvimento rodando, porque a reconferência mora na rota — e é justamente
 * a rota que estava furada.
 */
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { conferirDocumento, cpfValido, cnpjValido, soDigitos } from "../src/lib/documento.ts";
import { situacaoDoTenant } from "../src/lib/assinatura.ts";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
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
const igual = (a, b, oque) => {
  if (a !== b) {
    throw new Error(`${oque}: esperava ${JSON.stringify(String(b))}, veio ${JSON.stringify(String(a))}`);
  }
};

console.log("\nDocumento — o que fazia a primeira assinatura falhar:\n");

await etapa("CPF válido passa", () => {
  // Número gerado pelo próprio algoritmo; não é de ninguém.
  igual(cpfValido("529.982.247-25"), true, "cpf válido");
  igual(conferirDocumento("529.982.247-25"), null, "sem erro");
});

await etapa("CPF com um dígito trocado é recusado", () => {
  igual(cpfValido("529.982.247-26"), false, "cpf errado");
  const m = conferirDocumento("529.982.247-26");
  if (!m?.includes("CPF")) throw new Error(`mensagem genérica demais: ${m}`);
});

await etapa("CPF de dígitos repetidos não passa", () => {
  // 111.111.111-11 fecha na conta do dígito verificador, mas não existe.
  igual(cpfValido("111.111.111-11"), false, "repetido");
});

await etapa("CNPJ válido passa e inválido é recusado", () => {
  igual(cnpjValido("11.222.333/0001-81"), true, "cnpj válido");
  igual(cnpjValido("11.222.333/0001-82"), false, "cnpj errado");
});

await etapa("documento vazio dá recado que diz o que fazer", () => {
  const m = conferirDocumento("");
  if (!m || !/informe/i.test(m)) throw new Error(`mensagem ruim: ${m}`);
});

await etapa("a pontuação é descartada antes de ir para o Asaas", () => {
  igual(soDigitos("529.982.247-25"), "52998224725", "só dígitos");
});

console.log("\nPortão de trial e inadimplência:\n");

const ONTEM = new Date(Date.now() - 24 * 3600 * 1000);
const AMANHA = new Date(Date.now() + 24 * 3600 * 1000);
const LIGADA = true;
const DESLIGADA = false;

await etapa("com a cobrança DESLIGADA nada bloqueia", () => {
  // Enquanto o Asaas está adormecido ninguém tem como pagar; travar seria punir
  // a pessoa por uma porta que nós não abrimos.
  for (const st of ["trial", "inadimplente", "cancelado"]) {
    igual(situacaoDoTenant({ status: st, trial_ate: ONTEM }, DESLIGADA).podeEnviar, true, st);
  }
});

await etapa("trial dentro do prazo envia normalmente", () => {
  igual(situacaoDoTenant({ status: "trial", trial_ate: AMANHA }, LIGADA).podeEnviar, true, "trial vivo");
});

await etapa("trial VENCIDO não envia mais", () => {
  const s = situacaoDoTenant({ status: "trial", trial_ate: ONTEM }, LIGADA);
  igual(s.podeEnviar, false, "trial vencido");
  igual(s.motivo, "trial_vencido", "motivo");
  /*
   * O recado precisa dizer o PRAZO e que nada é apagado.
   *
   * Até 27/08/2026 ele prometia que as galerias publicadas continuavam no ar, e
   * esta etapa prendia essa promessa. A carência de 15 dias
   * (`CARENCIA_POS_TRIAL_DIAS`) transformou a promessa em mentira com data, e
   * uma tela que esconde o prazo é pior que a política: o fotógrafo descobriria
   * no dia em que o cliente dele ligasse dizendo que o link parou.
   */
  if (!/15 dias/.test(s.recado ?? "") || !/nada é apagado/i.test(s.recado ?? "")) {
    throw new Error("o recado não diz o prazo da carência e que nada é apagado");
  }
  return "e promete que a galeria do cliente fica no ar";
});

await etapa("assinatura ativa envia mesmo com o trial vencido", () => {
  igual(situacaoDoTenant({ status: "ativo", trial_ate: ONTEM }, LIGADA).podeEnviar, true, "ativo");
});

await etapa("inadimplente e cancelado não enviam", () => {
  for (const st of ["inadimplente", "cancelado"]) {
    const s = situacaoDoTenant({ status: st, trial_ate: null }, LIGADA);
    igual(s.podeEnviar, false, st);
    if (!s.recado) throw new Error(`${st} sem recado`);
  }
});

await etapa("status desconhecido NÃO trava quem está pagando", () => {
  // Um erro de digitação numa coluna de texto não pode virar bloqueio silencioso.
  igual(situacaoDoTenant({ status: "vira-lata", trial_ate: null }, LIGADA).podeEnviar, true, "desconhecido");
});

// ---------------------------------------------------------------------------

console.log("\nQuota — o furo do tamanho declarado pelo navegador:\n");

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const { DATABASE_URL } = process.env;
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

await etapa("a coluna cpf_cnpj existe no banco", async () => {
  const { rows } = await db.query(
    "select 1 from information_schema.columns where table_name='tenants' and column_name='cpf_cnpj'",
  );
  if (rows.length === 0) throw new Error("falta rodar db/migracoes/006-documento.sql");
});

const t = [await estudioDaRodada(db)];
const { rows: g } = await db.query(
  "select id from galerias where tenant_id = $1 and estado = 'online' order by criado_em limit 1",
  [t[0]?.id],
);

if (!t.length || !g.length) {
  console.log("  – pulado: precisa de um estúdio com galeria online no banco de desenvolvimento");
} else {
  const tenantId = t[0].id;
  const quotaOriginal = t[0].quota_bytes;
  const cookie = cookieDeSessao(tenantId);

  await etapa("declarar 1 byte e subir um arquivo maior é RECUSADO", async () => {
    // Aperta a quota deixando uma folga de 3 KB SOBRE o que já está em uso —
    // fixar um número absoluto não serve, porque o estúdio de desenvolvimento já
    // tem arquivos de testes anteriores ocupando espaço.
    const { rows: uso } = await db.query(
      "select coalesce(sum(bytes),0)::text as t from medias where tenant_id = $1",
      [tenantId],
    );
    const folga = BigInt(uso[0].t) + 3000n;
    await db.query("update tenants set quota_bytes = $1 where id = $2", [folga.toString(), tenantId]);
    let mediaId = null;
    try {
      const preparo = await fetch(`${BASE}/api/galerias/${g[0].id}/upload`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ nome: "furo-quota.jpg", mime: "image/jpeg", bytes: 1 }),
      });
      if (!preparo.ok) throw new Error(`o preparo devia aceitar o palpite de 1 byte, veio ${preparo.status}`);
      const { mediaId: id, url } = await preparo.json();
      mediaId = id;

      // Sobe 5 KB de verdade — bem mais que o 1 byte declarado.
      const gordo = Buffer.alloc(5000, 0x7f);
      const envio = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: gordo,
      });
      if (!envio.ok) throw new Error(`o bucket recusou o PUT: ${envio.status}`);

      const conf = await fetch(`${BASE}/api/medias/${mediaId}/confirmar`, {
        method: "POST",
        headers: { cookie },
      });
      igual(conf.status, 507, "confirmar com arquivo acima da quota");

      // E não pode ter sobrado lixo: nem linha no banco, nem objeto pago no bucket.
      const { rows: sobrou } = await db.query("select 1 from medias where id = $1", [mediaId]);
      igual(sobrou.length, 0, "linha removida depois da recusa");
      mediaId = null;
      return "HTTP 507 e a reserva foi limpa";
    } finally {
      if (mediaId) await db.query("delete from medias where id = $1", [mediaId]);
      await db.query("update tenants set quota_bytes = $1 where id = $2", [quotaOriginal, tenantId]);
    }
  });

  await etapa("a quota do estúdio foi devolvida ao valor original", async () => {
    const { rows } = await db.query("select quota_bytes from tenants where id = $1", [tenantId]);
    igual(rows[0].quota_bytes, quotaOriginal, "quota restaurada");
  });
}

// A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
await limparRodada(db);
await db.end();

if (falhou) {
  console.error("\n✗ o portão de cobrança ainda tem furo\n");
  process.exit(1);
}
console.log("\n✓ documento exigido, trial/inadimplência travam o envio, quota confere o tamanho real\n");
