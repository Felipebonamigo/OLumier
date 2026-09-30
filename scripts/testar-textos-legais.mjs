#!/usr/bin/env node
/**
 * Os textos legais dizem a mesma coisa que o sistema faz. Uso:
 *
 *   node --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-textos-legais.mjs
 *
 * Não precisa de servidor nem de banco: lê o código-fonte das páginas e das
 * rotinas que gravam no registro de auditoria.
 *
 * ── O QUE ISTO FECHA (30/09/2026) ─────────────────────────────────────────
 *
 * Uma revisão dos riscos de processo achou quatro contradições entre o que os
 * textos prometiam e o que o código fazia:
 *
 * 1. A Privacidade prometia "segunda cópia de todos os arquivos num provedor
 *    diferente" — um mês depois de o espelho ter sido cancelado. Termos e
 *    /seguranca já diziam "uma cópia". Numa disputa por arquivo perdido, é a
 *    frase errada que o outro lado cita.
 * 2. A Privacidade dizia que o registro de atividade não guarda e-mail, e
 *    `conta.criada` e o aviso de limpeza gravavam o e-mail cru — numa tabela
 *    que recusa delete, ou seja, sem como atender um pedido de exclusão.
 * 3. O cadastro dizia "ao criar a conta você aceita os Termos" e não guardava
 *    QUAL versão foi aceita.
 * 4. A Privacidade mandava pedir "pelo e-mail acima", e não havia e-mail
 *    nenhum acima; os Termos mandavam cancelar pelo WhatsApp, e o painel tem
 *    botão de cancelar.
 *
 * `testar-termos.mjs` confere a página renderizada; este confere a coerência
 * entre os textos e o código, que é o que envelheceu das quatro vezes.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ler = (rel) => readFileSync(path.join(RAIZ, rel), "utf8");

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

const PAGINAS = {
  termos: "src/app/(institucional)/termos/page.tsx",
  privacidade: "src/app/(institucional)/privacidade/page.tsx",
  seguranca: "src/app/(institucional)/seguranca/page.tsx",
};

/** O texto da página sem os comentários — o que conta é o que a pessoa lê. */
const semComentarios = (fonte) =>
  fonte
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\{" "\}/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");

const texto = Object.fromEntries(
  Object.entries(PAGINAS).map(([k, rel]) => [k, semComentarios(ler(rel))]),
);

console.log("Textos legais x sistema:\n");

/* ── 1. a cópia dos originais ────────────────────────────────────────────── */

await etapa("nenhuma página promete segunda cópia dos originais", () => {
  /* O espelho foi cancelado em 27/08/2026 (`testar-sem-espelho.mjs`). Se ele
   * voltar, apague esta etapa no mesmo commit que o traz de volta. */
  const promessas = [
    /segunda c[óo]pia (de todos|dos arquivos|de cada)/i,
    /guarda a segunda c[óo]pia/i,
    /tr[êe]s camadas/i,
    /perder um n[ãa]o pode significar perder os dois/i,
  ];
  for (const [pagina, t] of Object.entries(texto)) {
    for (const p of promessas) {
      const m = t.match(p);
      if (m) throw new Error(`/${pagina} ainda diz "${m[0]}"`);
    }
  }
});

await etapa('as três páginas dizem que os originais têm UMA cópia', () => {
  for (const [pagina, t] of Object.entries(texto)) {
    if (!/(t[êe]m (uma|UMA) c[óo]pia|uma c[óo]pia s[óo]|n[ãa]o mantemos uma segunda c[óo]pia)/i.test(t)) {
      throw new Error(`/${pagina} não diz que os originais têm uma cópia só`);
    }
  }
});

/* ── 2. o registro de auditoria não guarda e-mail cru ────────────────────── */

await etapa("nenhum evento de auditoria grava e-mail cru", () => {
  /* O registro é imutável (migração 014): e-mail cru ali não tem como ser
   * apagado a pedido do titular. Vai em `hashDeEmail`, ou não vai. */
  const arquivos = [];
  const varrer = (dir) => {
    for (const item of readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const rel = `${dir}/${item.name}`;
      if (item.isDirectory()) varrer(rel);
      else if (/\.(ts|tsx)$/.test(item.name)) arquivos.push(rel);
    }
  };
  varrer("src");

  const culpados = [];
  let chamadas = 0;
  for (const rel of arquivos) {
    const fonte = ler(rel);
    for (const m of fonte.matchAll(/registrarEvento\(\{[\s\S]*?\n\s*\}\);/g)) {
      chamadas++;
      const bloco = m[0]
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/hashDeEmail\([^)]*\)/g, "HASH");
      if (/\bemail\b\s*[,}]|:\s*[\w.?]*\.email\b|\bemail\s*:/.test(bloco)) culpados.push(rel);
    }
  }
  if (chamadas < 10) throw new Error(`só ${chamadas} chamadas achadas — o padrão de busca quebrou`);
  if (culpados.length) throw new Error(`e-mail cru em: ${[...new Set(culpados)].join(", ")}`);
  return `${chamadas} chamadas conferidas`;
});

await etapa("a Privacidade diz a verdade sobre o que o registro guarda", () => {
  const t = texto.privacidade;
  if (/n[ãa]o guardamos ali nome, e-mail/i.test(t)) {
    throw new Error("voltou a dizer que o registro não guarda nome — ele guarda o do estúdio");
  }
  if (!/nome do est[úu]dio/i.test(t)) throw new Error("não diz que guarda o nome do estúdio");
  if (!/e-mail[\s\S]{0,200}hash/i.test(t)) throw new Error("não diz que o e-mail entra em hash");
});

await etapa("o hash do e-mail ignora maiúsculas e espaços, e não colide com o do IP", async () => {
  process.env.SESSION_SECRET ||= "x".repeat(40);
  const { hashDeEmail, hashDeIp } = await import("../src/lib/ip.ts");
  if (hashDeEmail(" Oi@Sirius.com.br ") !== hashDeEmail("oi@sirius.com.br")) {
    throw new Error("o mesmo endereço dá hashes diferentes — a prova não confere");
  }
  if (hashDeEmail("a@b.c") === hashDeIp("a@b.c")) throw new Error("e-mail e IP no mesmo espaço");
  if (hashDeEmail("a@b.c").includes("a@b.c")) throw new Error("o hash contém o endereço");
});

/* ── 3. o aceite grava a versão ──────────────────────────────────────────── */

await etapa("o cadastro grava QUAIS versões dos Termos e da Privacidade foram aceitas", () => {
  const fonte = ler("src/app/(auth)/actions.ts");
  const bloco = fonte.match(/acao: ACOES\.CONTA_CRIADA[\s\S]*?\n\s*\}\);/)?.[0] ?? "";
  if (!bloco) throw new Error("não achei o evento conta.criada");
  if (!/aceitou:\s*\{[^}]*VERSOES_LEGAIS\.termos[^}]*VERSOES_LEGAIS\.privacidade/.test(bloco)) {
    throw new Error("o evento de criação de conta não grava as versões aceitas");
  }
});

await etapa("as páginas mostram a mesma versão que o cadastro grava", async () => {
  /* Data escrita à mão na página e outra na configuração: a página diria uma
   * versão e o registro, outra. */
  for (const pagina of ["termos", "privacidade"]) {
    const fonte = ler(PAGINAS[pagina]);
    if (!fonte.includes(`VERSOES_LEGAIS.${pagina}`)) {
      throw new Error(`/${pagina} não tira a data de config/documentos-legais.ts`);
    }
    if (/const ATUALIZAD[OA]_EM = "/.test(fonte)) throw new Error(`/${pagina} voltou a ter data à mão`);
  }
  const { VERSOES_LEGAIS, dataPorExtenso } = await import("../src/config/documentos-legais.ts");
  for (const [k, v] of Object.entries(VERSOES_LEGAIS)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`versão de ${k} fora do formato: ${v}`);
  }
  const extenso = dataPorExtenso("2026-09-01");
  if (extenso !== "1 de setembro de 2026") throw new Error(`data por extenso errada: ${extenso}`);
});

/* ── 4. os contatos e o cancelamento ─────────────────────────────────────── */

await etapa('nenhuma página manda escrever para um e-mail que ela não mostra', () => {
  for (const [pagina, t] of Object.entries(texto)) {
    if (/e-mail acima/i.test(t)) throw new Error(`/${pagina} fala de "e-mail acima"`);
  }
});

await etapa("os Termos dizem que o cancelamento é pelo painel, que tem o botão", () => {
  if (!/cancela[\s\S]{0,80}em Conta/i.test(texto.termos)) {
    throw new Error("os Termos não dizem que cancelar é em Conta, no painel");
  }
  if (!ler("src/components/plano-conta.tsx").includes("cancelarAssinaturaAction")) {
    throw new Error("a tela de Conta não tem mais o botão de cancelar — os Termos mentem");
  }
});

/* ── 5. devolução, prazo da conta encerrada e operador ───────────────────── */

await etapa("Termos, Privacidade e home tiram os números da mesma regra que o código usa", () => {
  /* Número escrito à mão num texto e outro na configuração é a contradição
   * que vira processo: o texto promete 3 meses e a rotina apaga em 60 dias. */
  const termos = ler(PAGINAS.termos);
  for (const nome of ["DIAS_DE_ARREPENDIMENTO", "PRAZO_DA_DEVOLUCAO", "RETENCAO_POR_EXTENSO", "TOTAL_DE_AVISOS"]) {
    if (!termos.includes(`{${nome}}`)) throw new Error(`os Termos não usam ${nome}`);
  }
  if (!ler(PAGINAS.privacidade).includes("{RETENCAO_POR_EXTENSO}")) {
    throw new Error("a Privacidade não diz o prazo da conta encerrada pela configuração");
  }
  if (!ler("src/app/page.tsx").includes("{RETENCAO_POR_EXTENSO}")) {
    throw new Error("a FAQ da home não diz o prazo da conta encerrada pela configuração");
  }
});

await etapa("nenhuma tela promete que cancelar não apaga nada", () => {
  /* Era a frase da confirmação de cancelar até 30/09/2026 — e deixou de ser
   * verdade quando a conta encerrada ganhou prazo. */
  for (const rel of ["src/components/plano-conta.tsx", "src/app/page.tsx", "src/lib/assinatura.ts"]) {
    const t = semComentarios(ler(rel));
    if (/cancel[\s\S]{0,160}nada (é|e) apagado/i.test(t)) throw new Error(`${rel} ainda promete que nada é apagado`);
  }
});

await etapa("o operador tem CNPJ no formato certo, ou nenhum", async () => {
  const { OPERADOR, operadorPorExtenso } = await import("../src/config/documentos-legais.ts");
  if (OPERADOR.cnpj !== null && !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(OPERADOR.cnpj)) {
    throw new Error(`CNPJ fora do formato: ${OPERADOR.cnpj}`);
  }
  for (const pagina of ["termos", "privacidade"]) {
    if (!ler(PAGINAS[pagina]).includes("operadorPorExtenso()")) {
      throw new Error(`/${pagina} escreve o operador à mão`);
    }
  }
  return operadorPorExtenso();
});

console.log(falhou ? "\n✗ os textos legais contradizem o sistema" : "\n✓ textos legais coerentes");
process.exitCode = falhou ? 1 : 0;
