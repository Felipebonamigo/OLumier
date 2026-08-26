#!/usr/bin/env node
/**
 * O que a troca de marca NÃO pode levar junto.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-marca-plataforma.mjs
 *
 * O nome da plataforma muda. Já mudou uma vez (Fotônio → Olumier) e mudou de
 * novo (Olumier → Galeria Átomo). O `config/marca.ts` existe para que isso seja
 * a edição de um arquivo.
 *
 * O perigo não é o arquivo. É o gesto: a forma natural de fazer uma troca
 * dessas é um localizar-e-substituir em "olumier" no repositório inteiro. E há
 * quatro coisas que carregam essa palavra e NÃO são nome nenhum — são endereço.
 * Trocadas junto, cada uma quebra em silêncio, e nenhuma acusa no dia:
 *
 *   1. O prefixo do Asaas. Está gravado no `externalReference` de toda
 *      assinatura viva, e a conta é COMPARTILHADA com o Atomatiza — é ele que
 *      separa os dois produtos. Trocado, o webhook deixa de reconhecer os
 *      próprios pagamentos: o cliente paga, o evento chega, e o sistema o
 *      ignora achando que é do outro produto.
 *
 *   2. Os buckets. É onde os arquivos MORAM. O B2 não renomeia bucket; trocar o
 *      nome no código aponta para um balde que não existe, e a galeria do casal
 *      abre vazia.
 *
 *   3. O cookie de sessão. Trocado, desloga todo mundo de uma vez. Não é fatal,
 *      mas não há um único ganho — ninguém vê nome de cookie.
 *
 *   4. `marca.dominio`. Este é o mais traiçoeiro, porque PARECE texto e mora no
 *      arquivo da marca. Ele monta o link do "esqueci minha senha" e é o portão
 *      que autoriza a emissão de certificado TLS. Trocado antes de o domínio
 *      novo existir, o e-mail de recuperação aponta para o nada e o certificado
 *      para de ser emitido.
 *
 * Este arquivo é o freio desse gesto. Quando a fase 2 mudar o domínio de
 * verdade, a etapa do domínio aqui muda JUNTO, de propósito — e aí é decisão,
 * não descuido.
 */
import { marca } from "../src/config/marca.ts";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ler = (p) => readFileSync(path.join(RAIZ, p), "utf8");

/*
 * O domínio que está NO AR hoje. Não sai de `marca.ts` de propósito: se saísse,
 * a etapa concordaria com qualquer troca e não estaria conferindo nada.
 */
const DOMINIO_EM_PRODUCAO = "olumier.com.br";

let falhou = false;
function etapa(nome, fn) {
  try {
    const detalhe = fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

console.log("a marca pode mudar; o endereço, não");

etapa("a plataforma tem nome", () => {
  if (!marca.nome || marca.nome.length < 2) throw new Error("marca.nome vazio");
  return marca.nome;
});

etapa("o prefixo do Asaas sobreviveu à troca de nome", () => {
  const asaas = ler("src/lib/asaas.ts");
  const achado = asaas.match(/const PREFIXO = "([^"]+)"/)?.[1];
  if (achado !== "olumier:") {
    throw new Error(
      `o prefixo virou "${achado}". Ele está gravado no externalReference de toda ` +
        `assinatura VIVA, e a conta do Asaas é dividida com o Atomatiza — trocar faz o ` +
        `webhook ignorar os próprios pagamentos, sem erro nenhum. Se a mudança for ` +
        `deliberada, cada assinatura precisa ser migrada no Asaas ANTES.`,
    );
  }
  return achado;
});

etapa("o prefixo não é derivado do nome da marca", () => {
  /* Um `const PREFIXO = \`${marca.nomeSimples}:\`` passaria na etapa acima hoje e
   * quebraria sozinho na próxima troca de nome. A dependência é o defeito. */
  const asaas = ler("src/lib/asaas.ts");
  if (/PREFIXO\s*=\s*[`"'][^`"']*\$\{/.test(asaas) || /PREFIXO.*marca\./.test(asaas)) {
    throw new Error("o prefixo passou a ser montado a partir da marca — ele tem de ser literal");
  }
});

etapa("o cookie de sessão sobreviveu à troca de nome", () => {
  for (const arquivo of ["src/lib/auth.ts", "src/proxy.ts"]) {
    if (!ler(arquivo).includes("olumier_sessao")) {
      throw new Error(`${arquivo} não usa mais "olumier_sessao" — trocar desloga todo mundo`);
    }
  }
  return "auth.ts e proxy.ts de acordo";
});

etapa("os buckets seguem com o nome antigo", () => {
  for (const [chave, esperado] of [
    ["ARQUIVOS_BUCKET", "olumier-arquivos"],
    ["ESPELHO_BUCKET", "olumier-espelho"],
  ]) {
    const valor = process.env[chave];
    /* Vazio no dev é normal (o dev grava no R2). Só confere quando existe: o que
     * importa é que ninguém o REESCREVA com o nome novo. */
    if (valor && valor !== esperado) {
      throw new Error(
        `${chave} virou "${valor}". Bucket é onde o arquivo mora, não é marca — ` +
          `apontar para um balde que não existe abre a galeria do casal vazia.`,
      );
    }
  }
  return "intactos";
});

etapa("marca.dominio ainda é o domínio que está no ar", () => {
  if (marca.dominio !== DOMINIO_EM_PRODUCAO) {
    throw new Error(
      `marca.dominio virou "${marca.dominio}". Ele NÃO é texto: monta o link do ` +
        `"esqueci minha senha" (app/(auth)/actions.ts) e autoriza a emissão de ` +
        `certificado TLS (api/tls/permitir). Trocar antes de o domínio novo responder ` +
        `deixa a recuperação de senha apontando para o nada. Isto é a fase 2 — quando ` +
        `ela chegar, mude DOMINIO_EM_PRODUCAO aqui junto, de propósito.`,
    );
  }
  return marca.dominio;
});

etapa("o e-mail de contato ainda é de um domínio que existe", () => {
  const dominioDoEmail = marca.email.split("@")[1];
  if (dominioDoEmail !== DOMINIO_EM_PRODUCAO) {
    throw new Error(
      `contato virou "${marca.email}", num domínio que ainda não recebe e-mail. ` +
        `Endereço de contato que volta é pior que endereço nenhum.`,
    );
  }
  return marca.email;
});

console.log(falhou ? "\n✗ a troca de marca levou junto o que não devia" : "\n✓ marca ok");
process.exitCode = falhou ? 1 : 0;
