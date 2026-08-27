#!/usr/bin/env node
/**
 * Prova que o envio de e-mail funciona DE VERDADE, pelo código do app. Uso:
 *
 *   node --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/provar-email.mjs destino@exemplo.com
 *
 * `--conditions=react-server` existe porque `src/lib/email.ts` importa
 * `server-only`, que fora do Next resolve para um módulo que estoura de
 * propósito. Com a condição ligada ele resolve para o `empty.js` — o mesmo
 * caminho que o Next usa no servidor. Sem isso, o jeito de testar seria
 * reescrever o `fetch` aqui, e aí o teste provaria o teste, não o app.
 *
 * MANDA E-MAIL DE VERDADE. Passe um destino que seja seu.
 *
 * NÃO se chama `testar-*` de propósito: `testar-tudo.mjs` descobre as suítes
 * pelo nome, e uma que MANDA E-MAIL DE VERDADE não pode entrar na bateria que
 * roda a cada `npm test`. Isto aqui é prova manual, rodada quando se quer saber
 * se o envio funciona — não teste automático.
 *
 * ── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 * Em 24/08/2026 `RESEND_API_KEY=cole_aqui` foi para o .env.production e o
 * recurso PARECEU configurado. A guarda do prefixo `re_` fechou aquele buraco,
 * mas prefixo certo não prova domínio verificado, permissão da chave nem
 * entrega. Só um envio real prova.
 */
import { enviarEmail, emailConfigurado, motivoEmailIndisponivel, moldura } from "../src/lib/email.ts";

const destino = process.argv[2];
if (!destino?.includes("@")) {
  console.error("uso: ... scripts/provar-email.mjs voce@seudominio.com");
  process.exit(2);
}

console.log("Envio de e-mail:\n");

if (!emailConfigurado()) {
  console.error(`  ✗ nem tentou — ${motivoEmailIndisponivel()}`);
  console.log("\n✗ envio de e-mail NÃO está configurado");
  process.exit(1);
}
console.log("  ✓ configurado — chave com cara de chave e remetente definido");

const ok = await enviarEmail({
  para: destino,
  assunto: "Teste de envio · Galeria Átomo",
  html: moldura(
    "O envio funciona",
    `<p style="margin:0;font-size:15px;line-height:1.6;color:#c3cad6">
       Se você está lendo isto, a chave do Resend, o domínio verificado e o
       remetente estão certos em produção — e "esqueci minha senha" consegue
       chegar em quem pedir.
     </p>`,
  ),
  texto:
    "Se você está lendo isto, a chave do Resend, o domínio verificado e o " +
    'remetente estão certos em produção — e "esqueci minha senha" consegue ' +
    "chegar em quem pedir.",
});

if (!ok) {
  console.error("  ✗ o Resend recusou — o motivo saiu no [email] acima");
  console.log("\n✗ envio de e-mail tem problema");
  process.exit(1);
}

console.log(`  ✓ aceito pelo Resend para ${destino}`);
console.log("\n✓ envio de e-mail ok — confira a caixa de entrada");
