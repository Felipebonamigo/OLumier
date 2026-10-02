#!/usr/bin/env node
/**
 * MANDA OS E-MAILS DA GALERIA QUE VENCERAM HOJE. Uso:
 *   node --env-file=.env.production --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/enviar-emails-da-galeria.mjs [--aplicar]
 *
 * Sem `--aplicar` apenas LISTA o que sairia. É o padrão de propósito: este
 * script manda mensagem para o cliente de outra pessoa, e o modo seco é como se
 * confere a fila antes de ela virar e-mail na caixa da noiva.
 *
 * Roda uma vez por dia pelo timer `fotonio-emails` (ver `ops/`).
 *
 * ── O QUE ELE NÃO FAZ, E É DE PROPÓSITO ───────────────────────────────────
 *
 * · Não agenda nada. Quem agenda é o fotógrafo, no painel (`agendarEmails`).
 * · Não reenvia. A linha enviada ganha `enviado_em` e sai da fila para sempre;
 *   a chave única da migração 059 impede até a segunda linha existir.
 * · Não manda de galeria fora do ar nem no cofre: o link abriria um 404 ou uma
 *   tela de "arquivada", e o casal descobriria antes do fotógrafo. Essas linhas
 *   ficam na fila com o motivo escrito, e saem no dia em que a galeria voltar.
 */
import {
  pendentesParaEnviar,
  marcarEnviado,
  marcarErro,
  urlDoEmail,
  maisBaixadas,
  fotoDaCapa,
} from "../src/lib/emails-da-galeria.ts";
import { montarEmailDaGaleria } from "../src/config/email-da-galeria.ts";
import { enviarEmail, emailConfigurado, motivoEmailIndisponivel } from "../src/lib/email.ts";
import { urlDeLeitura } from "../src/lib/r2.ts";
import { urlDaDerivada, armazemDe } from "../src/lib/armazem.ts";

const APLICAR = process.argv.includes("--aplicar");
/* Uma semana: as imagens do e-mail são carregadas quando a pessoa ABRE, e isso
   pode ser dias depois. URL de uma hora chegaria quebrada na maioria. */
const VALIDADE = 7 * 24 * 3600;

const agora = new Date();
const pendentes = await pendentesParaEnviar(agora);

if (pendentes.length === 0) {
  console.log("nada a enviar hoje");
  process.exit(0);
}

console.log(`${pendentes.length} e-mail(is) venceram${APLICAR ? "" : " — modo seco"}`);

/*
 * A FALTA DE CHAVE NÃO INTERROMPE A RODADA, e a razão é mecânica: as conferências
 * que PULAM linha (galeria fora do ar, no cofre) acontecem dentro do laço, e
 * sair antes dele faria essas linhas nunca receberem o motivo escrito — numa
 * bancada sem e-mail configurado, a regra "galeria fora do ar não é entregue"
 * ficaria sem como ser verificada.
 *
 * Então o aviso sai uma vez, bem alto, e cada linha que CHEGARIA ao envio ganha
 * o motivo na fila. Nada é marcado como enviado.
 */
const semEmail = APLICAR && !emailConfigurado();
if (semEmail) console.error(`não dá para enviar: ${motivoEmailIndisponivel()}`);

let enviados = 0;
let falhas = 0;
let pulados = 0;

for (const e of pendentes) {
  const destino = `${e.tipo} → ${e.para} (${e.titulo})`;

  if (!e.publicada || e.estado !== "online") {
    const motivo = !e.publicada ? "galeria fora do ar" : `galeria em ${e.estado}`;
    console.log(`  · ${destino} — pulado: ${motivo}`);
    if (APLICAR) await marcarErro(e.id, motivo);
    pulados += 1;
    continue;
  }

  /* A capa: o arquivo enviado vence, senão a foto marcada como capa. Sem nenhuma
     das duas o e-mail sai sem imagem, que é melhor que sair com uma foto que o
     fotógrafo não escolheu. */
  let capaUrl = null;
  try {
    if (e.capaChave) {
      capaUrl = await urlDeLeitura(e.capaChave, VALIDADE);
    } else {
      const foto = await fotoDaCapa(e.galeriaId, e.capaMediaId);
      if (foto) {
        capaUrl = await urlDaDerivada(
          foto.chave_preview,
          foto.chave,
          armazemDe(foto.armazem),
          VALIDADE,
        );
      }
    }
  } catch {
    capaUrl = null;
  }

  /* As mais baixadas só nos lembretes: no e-mail de entrega ninguém baixou
     nada ainda, e no dia do casamento a galeria está vazia. */
  let destaques = [];
  if (e.tipo === "relembrar" || e.tipo === "um_ano" || e.tipo === "feedback") {
    try {
      const fotos = await maisBaixadas(e.galeriaId, 3);
      destaques = (
        await Promise.all(
          fotos.map((f) =>
            urlDaDerivada(f.chave_thumb, f.chave, armazemDe(f.armazem), VALIDADE).catch(() => null),
          ),
        )
      ).filter(Boolean);
    } catch {
      destaques = [];
    }
  }

  const logoUrl = e.estudioLogo
    ? await urlDeLeitura(e.estudioLogo, VALIDADE).catch(() => null)
    : null;

  const { assunto, html, texto } = montarEmailDaGaleria({
    tipo: e.tipo,
    template: e.template,
    nome: e.nome,
    estudio: { nome: e.estudioNome, cor: e.estudioCor, logoUrl },
    galeria: {
      titulo: e.titulo,
      url: urlDoEmail(e),
      capaUrl,
      dataEvento: e.dataEvento,
    },
    mensagem: e.tipo === "entrega" ? e.mensagem : null,
    destaques,
  });

  if (!APLICAR) {
    console.log(`  · ${destino} — "${assunto}"`);
    continue;
  }

  if (semEmail) {
    await marcarErro(e.id, `envio indisponível: ${motivoEmailIndisponivel()}`);
    falhas += 1;
    console.log(`  ✗ ${destino} — sem e-mail configurado`);
    continue;
  }

  const ok = await enviarEmail({ para: e.para, assunto, html, texto });
  if (ok) {
    await marcarEnviado(e.id);
    enviados += 1;
    console.log(`  ✓ ${destino}`);
  } else {
    await marcarErro(e.id, "o envio falhou — ver o log do servidor");
    falhas += 1;
    console.log(`  ✗ ${destino}`);
  }
}

console.log(
  APLICAR
    ? `\n${enviados} enviado(s), ${falhas} falha(s), ${pulados} pulado(s)`
    : `\n${pendentes.length} sairiam — rode com --aplicar`,
);
/* Falha de envio NÃO derruba o timer: a linha fica na fila e a próxima rodada
   tenta de novo. Sair diferente de zero faria o systemd marcar a unidade como
   quebrada por causa de um Resend fora do ar por dez minutos. */
process.exitCode = semEmail ? 1 : 0;
