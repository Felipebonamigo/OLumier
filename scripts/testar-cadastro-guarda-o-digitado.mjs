#!/usr/bin/env node
/**
 * O erro do cadastro não apaga o que a pessoa digitou (29/09/2026).
 *
 * Com `<form action>`, o React 19 limpa o formulário ao fim de toda ação,
 * inclusive a que volta com erro. Visto no navegador: depois de "Muitas contas
 * foram criadas desta conexão hoje", o nome, o e-mail e as duas senhas
 * estavam em branco — só o CPF, que é campo controlado, sobreviveu.
 *
 * O erro usado aqui é o do e-mail já cadastrado: é o mais comum na vida real
 * (a pessoa já tinha conta) e não cria conta nenhuma, então a suíte não gasta
 * o limite de cadastros por IP da bancada.
 */
import { createRequire } from "node:module";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

/* O Playwright não é dependência do projeto (a publicação não o instala): esta
   suíte roda onde ele existir — `NODE_PATH=$(npm root -g)`. */
let chromium = null;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.log("  – pulado: Playwright não está instalado aqui");
}

/** Um CPF válido e novo a cada rodada: o documento é único no banco. */
function cpfNovo() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (d) => ((d.reduce((a, x, i) => a + x * (d.length + 1 - i), 0) * 10) % 11) % 10;
  n.push(dv(n));
  n.push(dv(n));
  return n.join("");
}
const cpf = cpfNovo();
const cpfNaTela = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");

const existente = await estudioDaRodada(db);
const navegador = chromium ? await chromium.launch() : null;
try {
  if (navegador) {
    const pagina = await navegador.newPage();
    const digitado = {
      nome_estudio: "Estúdio Que Já Tinha Conta",
      email: existente.email,
      documento: cpfNaTela,
      senha: "uma-senha-bem-longa-2026",
      senha_confirmacao: "uma-senha-bem-longa-2026",
    };

    await etapa("com o e-mail já cadastrado, o erro aparece", async () => {
      await pagina.goto(`${BASE}/cadastrar`, { waitUntil: "networkidle" });
      for (const [campo, valor] of Object.entries(digitado)) {
        await pagina.fill(`input[name="${campo}"]`, valor);
      }
      await pagina.locator('form:has(input[name="email"]) button[type="submit"]').click();
      await pagina.getByText("Já existe uma conta com esse e-mail").waitFor({ timeout: 30000 });
    });

    await etapa("e tudo o que foi digitado continua nos campos", async () => {
      const faltando = [];
      for (const [campo, valor] of Object.entries(digitado)) {
        const agora = await pagina.inputValue(`input[name="${campo}"]`);
        if (agora !== valor) faltando.push(`${campo}=${JSON.stringify(agora)}`);
      }
      if (faltando.length) throw new Error(`apagados: ${faltando.join(", ")}`);
      return `${Object.keys(digitado).length} campos intactos`;
    });

    await etapa("corrigir só o e-mail e enviar de novo funciona", async () => {
      /* Não cria a conta de verdade: o documento é o mesmo de uma conta que
         a suíte grava antes, então o segundo erro prova que o envio saiu com
         os campos que ficaram na tela. */
      await db.query("update tenants set cpf_cnpj = $1 where id = $2", [cpf, existente.id]);
      await pagina.fill('input[name="email"]', `outro-${Date.now()}@teste.local`);
      await pagina.locator('form:has(input[name="email"]) button[type="submit"]').click();
      await pagina.getByText("Já existe uma conta com esse CPF/CNPJ").waitFor({ timeout: 30000 });
      const nome = await pagina.inputValue('input[name="nome_estudio"]');
      if (nome !== digitado.nome_estudio) throw new Error(`o nome sumiu no segundo envio: ${JSON.stringify(nome)}`);
    });
  }
} finally {
  await navegador?.close();
  await limparRodada(db);
  await db.end();
}

process.exitCode = falhou ? 1 : 0;
