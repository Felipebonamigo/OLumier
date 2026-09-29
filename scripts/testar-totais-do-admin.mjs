#!/usr/bin/env node
/**
 * A LINHA DE TOTAL DA TABELA DE ESTÚDIOS. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-totais-do-admin.mjs
 *
 * Suíte PURA: sem banco, sem servidor, sem rede — como `testar-metricas-admin`,
 * e pelo mesmo motivo. O caso que interessa (o estúdio sem limite, o que nunca
 * foi aberto, o cancelado que ainda ocupa disco) quase nunca está todo junto no
 * banco de desenvolvimento, e um total que só é conferido contra o banco de hoje
 * não é conferido contra nada.
 *
 * ── O PEDIDO (29/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe, olhando a tabela de 16 estúdios: "tenha uma linha com o 'total' de
 * cada coluna, último acesso, última alteração também".
 *
 * A tabela mostrava dezesseis linhas e nenhuma soma. Os totais de dinheiro
 * existiam lá em cima, no bloco "Dinheiro", mas separados da tabela que os
 * origina — e nenhum deles respondia "quanto disso é o espaço de todo mundo
 * junto" nem "quando alguém mexeu nisto pela última vez".
 *
 * ── POR QUE O TOTAL DE "PAGA" TEM DE BATER COM A RECEITA DO TOPO ─────────
 *
 * Porque a mesma página passaria a dizer dois números para a mesma coisa. Se um
 * dia divergirem, quem lê não tem como saber qual está certo — e é dinheiro.
 * A última etapa deste arquivo prende os dois juntos.
 */
import {
  totaisDosEstudios,
  receitaMensalCentavos,
  custoMensalDoEstudioCentavos,
} from "../src/lib/metricas-admin.ts";
import { GB } from "../src/config/planos.ts";
import { SEM_LIMITE_BYTES } from "../src/config/trial.ts";

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const detalhe = fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.error(`  ✗ ${nome} — ${e.message}`);
  }
};
const igual = (a, b, oque) => {
  if (a !== b) throw new Error(`${oque}: esperava ${b}, veio ${a}`);
};

const dia = (iso) => new Date(iso);

/** Uma linha do panorama, com o mínimo que os totais leem. */
const linha = (over = {}) => ({
  id: over.id ?? "x",
  nome_estudio: "Estúdio",
  email: "e@x.com",
  slug: "e",
  plano_id: "foto-500",
  ciclo_cobranca: "mensal",
  status: "ativo",
  trial_ate: null,
  criado_em: dia("2026-01-01"),
  cpf_cnpj: "1",
  tem_assinatura: true,
  quota_bytes: String(500n * BigInt(GB)),
  bytes_no_ar: "0",
  bytes_no_cofre: "0",
  galerias: 0,
  publicadas: 0,
  na_lixeira: 0,
  medias: 0,
  fotos: 0,
  videos: 0,
  acessos_30d: 0,
  favoritas: 0,
  ultimo_acesso: null,
  ultima_alteracao: null,
  ...over,
});

console.log("Totais da tabela de estúdios\n");

etapa("tabela vazia soma zero, e não quebra", () => {
  const t = totaisDosEstudios([]);
  igual(t.estudios, 0, "estúdios");
  igual(t.pagaCentavos, 0, "paga");
  igual(t.usadoBytes, 0n, "usado");
  igual(t.ultimoAcesso, null, "último acesso");
  igual(t.ultimaAlteracao, null, "última alteração");
  return "zeros";
});

etapa("soma bytes como BigInt, e não como número", () => {
  /*
   * Os bytes chegam do Postgres como TEXTO justamente porque não cabem em
   * Number sem perder precisão. Somar com `+` faria dois estúdios de 8 EB
   * darem um total errado em silêncio — e o `espacoSemLimite` usa 2^62, que
   * está bem acima do inteiro seguro do JavaScript.
   */
  const grande = String(2n ** 61n);
  const t = totaisDosEstudios([
    linha({ id: "a", bytes_no_ar: grande }),
    linha({ id: "b", bytes_no_ar: grande }),
  ]);
  igual(t.usadoBytes, 2n ** 62n, "soma dos bytes");
  return "2^62 exato";
});

etapa("quota some do total quando o estúdio é sem limite", () => {
  /*
   * Cortesia dos sócios tem `quota_bytes` = SEM_LIMITE_BYTES (2^62). Somar isso
   * à quota vendida daria um "total vendido" de exabytes — um número que não
   * quer dizer nada e que faria a barra de ocupação da página inteira ir a zero.
   * O total conta quantos são, à parte.
   */
  const t = totaisDosEstudios([
    linha({ id: "a", quota_bytes: String(500n * BigInt(GB)) }),
    linha({ id: "b", quota_bytes: String(SEM_LIMITE_BYTES), status: "cortesia" }),
  ]);
  igual(t.quotaBytes, 500n * BigInt(GB), "quota somada");
  igual(t.semLimite, 1, "quantos sem limite");
  return "500 GB + 1 sem limite";
});

etapa("só quem está ativo entra no total que a plataforma recebe", () => {
  const linhas = [
    linha({ id: "a", status: "ativo" }),
    linha({ id: "b", status: "trial" }),
    linha({ id: "c", status: "cancelado" }),
    linha({ id: "d", status: "cortesia" }),
  ];
  const t = totaisDosEstudios(linhas);
  igual(t.pagaCentavos, receitaMensalCentavos(linhas), "paga = receita do topo");
  igual(t.porStatus.ativo, 1, "ativos");
  igual(t.porStatus.cortesia, 1, "cortesias");
  return `${t.pagaCentavos} centavos de 1 ativo`;
});

etapa("o custo soma TODO MUNDO, inclusive quem cancelou", () => {
  /*
   * O Backblaze cobra por byte guardado, não por situação — é o que a
   * explicação do bloco "Dinheiro" já diz. Um total de custo que pulasse o
   * cancelado contaria uma história melhor do que a real.
   */
  const linhas = [
    linha({ id: "a", status: "ativo", bytes_no_ar: String(100n * BigInt(GB)) }),
    linha({ id: "b", status: "cancelado", bytes_no_ar: String(100n * BigInt(GB)) }),
  ];
  const t = totaisDosEstudios(linhas);
  const naMao = linhas.reduce((s, l) => s + custoMensalDoEstudioCentavos(l), 0);
  igual(t.custaCentavos, naMao, "custo somado");
  if (t.custaCentavos === 0) throw new Error("custo zero com 200 GB guardados");
  return `${t.custaCentavos} centavos`;
});

etapa("conteúdo e entrega somam as colunas inteiras", () => {
  const t = totaisDosEstudios([
    linha({ id: "a", galerias: 3, publicadas: 2, fotos: 100, videos: 1, acessos_30d: 40 }),
    linha({ id: "b", galerias: 1, publicadas: 0, fotos: 50, videos: 0, acessos_30d: 5 }),
  ]);
  igual(t.galerias, 4, "galerias");
  igual(t.publicadas, 2, "publicadas");
  igual(t.fotos, 150, "fotos");
  igual(t.videos, 1, "vídeos");
  igual(t.acessos30d, 45, "acessos");
  return "4 galerias · 150 fotos · 45 acessos";
});

etapa("último acesso e última alteração são o MAIS RECENTE, não a soma", () => {
  const t = totaisDosEstudios([
    linha({ id: "a", ultimo_acesso: dia("2026-09-01"), ultima_alteracao: dia("2026-09-20") }),
    linha({ id: "b", ultimo_acesso: dia("2026-09-28"), ultima_alteracao: dia("2026-09-10") }),
    linha({ id: "c", ultimo_acesso: null, ultima_alteracao: null }),
  ]);
  igual(t.ultimoAcesso?.toISOString().slice(0, 10), "2026-09-28", "último acesso");
  igual(t.ultimaAlteracao?.toISOString().slice(0, 10), "2026-09-20", "última alteração");
  return "28/09 e 20/09";
});

etapa("linha sem data nenhuma não vira 1970", () => {
  /* `Math.max` sobre datas nulas devolve 0, que vira 01/01/1970 — a data errada
     mais fácil de deixar passar, porque a tela desenha uma data de verdade. */
  const t = totaisDosEstudios([linha({ id: "a" }), linha({ id: "b" })]);
  igual(t.ultimoAcesso, null, "último acesso");
  igual(t.ultimaAlteracao, null, "última alteração");
  return "nulo continua nulo";
});

console.log(falhou ? "\n✗ os totais não fecham" : "\n✓ totais do admin ok");
process.exit(falhou ? 1 : 0);
