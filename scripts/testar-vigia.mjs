#!/usr/bin/env node
/**
 * O vigia e o aviso de backup — o que conta que o resto quebrou. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-vigia.mjs
 *
 * ── POR QUE ISTO EXISTE (17/09/2026) ──────────────────────────────────────
 *
 * Os dois scripts de `ops/` nunca tinham sido rodados por teste nenhum, e
 * carregavam três defeitos que só apareceriam no pior dia possível:
 *
 * 1. O vigia mirava `fotonio.com.br` — a PRIMEIRA marca, de antes do Olumier e
 *    do Galeria Átomo, e um domínio que nem está em `DOMINIOS_ATENDIDOS`. Ou
 *    ele não alcançava nada e caía no ramo que REINICIA O SERVIÇO a cada 5
 *    minutos, ou alcançava outra coisa e uma queda de verdade passava batido.
 *
 * 2. Os dois mandavam o e-mail com `curl -s` sem ler o código HTTP. O `curl`
 *    sai 0 quando a REQUISIÇÃO completa, então uma recusa do Resend (chave
 *    vencida, remetente não verificado) virava "aviso enviado" no log.
 *
 * 3. O vigia gravava o carimbo da espera de 1h ANTES de tentar enviar. Uma
 *    recusa custava o aviso E mais uma hora de silêncio.
 *
 * ── O QUE ESTE TESTE FAZ DE DIFERENTE ─────────────────────────────────────
 *
 * Ele RODA os scripts, não os lê. Um teste que só procurasse `-w '%{http_code}'`
 * no texto passaria com a variável sendo ignorada logo abaixo.
 *
 * O jeito é um `curl` de mentira no começo do PATH, que responde o código que o
 * teste mandar. Assim os três desfechos — enviado, recusado, sem segredo —
 * acontecem de verdade, e o que se lê depois é o log que o Felipe leria.
 *
 * O `systemctl` também é de mentira, pelo motivo óbvio.
 */
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { marca } from "../src/config/marca.ts";
import { DOMINIOS_ATENDIDOS } from "../src/config/dominios.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ler = (p) => readFileSync(path.join(RAIZ, p), "utf8");

let falhou = false;
function etapa(nome, fn) {
  try {
    const d = fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

console.log("o vigia e o aviso — quem conta que o resto quebrou\n");

/* ── 1. O ALVO ──────────────────────────────────────────────────────────── */

const vigia = ler("ops/fotonio-vigia.sh");
const alvo = /URL="\$\{VIGIA_URL:-([^}]+)\}"/.exec(vigia)?.[1];

etapa("o vigia mira o domínio canônico da marca", () => {
  if (!alvo) throw new Error("não achei a URL padrão do vigia em ops/fotonio-vigia.sh");
  const esperado = `https://${marca.dominio}/api/healthz`;
  if (alvo !== esperado) {
    throw new Error(
      `o vigia checa "${alvo}" e marca.dominio é "${marca.dominio}". ` +
        `Vigia no endereço errado é pior que vigia nenhum: parece que tem.`,
    );
  }
  return alvo;
});

etapa("e esse domínio é um dos que o servidor atende", () => {
  const host = new URL(alvo).hostname;
  if (!DOMINIOS_ATENDIDOS.includes(host)) {
    throw new Error(
      `"${host}" não está em DOMINIOS_ATENDIDOS — o Caddy consulta essa lista ` +
        `antes de emitir certificado, então o vigia não conseguiria nem abrir TLS`,
    );
  }
  return host;
});

/* ── 2. OS TRÊS DESFECHOS DO AVISO, RODADOS DE VERDADE ──────────────────── */

/**
 * Monta uma bancada com `curl` e `systemctl` de mentira no começo do PATH.
 *
 * O `curl` de mentira imita o de verdade só no que interessa aqui: honra o
 * `-o arquivo` e o `-w '%{http_code}'`, e responde o código que o teste pediu.
 * O primeiro uso (buscar o healthz) e o segundo (falar com o Resend) recebem
 * códigos diferentes, e é por isso que ele conta as chamadas num arquivo.
 */
function bancada({ healthz, corpoHealthz = "", resend }) {
  const dir = mkdtempSync(path.join(tmpdir(), "vigia-"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin);

  const curl = path.join(bin, "curl");
  writeFileSync(
    curl,
    `#!/usr/bin/env bash
# curl de mentira — ver scripts/testar-vigia.mjs
saida=""
codigo_pedido=""
for a in "$@"; do
  case "$anterior" in -o) saida="$a" ;; esac
  anterior="$a"
done
# Resend é a única chamada com api.resend.com na linha.
if printf '%s ' "$@" | grep -q 'api.resend.com'; then
  codigo_pedido=${resend}
  # Guarda o que seria enviado: é a única forma de provar o CONTEÚDO do aviso,
  # e o conteúdo é o que diz ao Felipe o que quebrou.
  [ -n "\${CURL_REGISTRO:-}" ] && printf '%s\\n' "$*" >> "$CURL_REGISTRO"
  [ -n "$saida" ] && printf '%s' '{"message":"resposta de mentira do Resend"}' > "$saida"
else
  codigo_pedido=${healthz}
  [ -n "$saida" ] && printf '%s' ${JSON.stringify(corpoHealthz)} > "$saida"
fi
# Sem -o, o corpo vai para a saída padrão (é como o script lê o healthz).
if [ -z "$saida" ]; then printf '%s' ${JSON.stringify(corpoHealthz)}; fi
# Com -w, o código sai depois do corpo — igual ao curl de verdade.
if printf '%s ' "$@" | grep -q -- '-w'; then printf '%s' "$codigo_pedido"; fi
exit 0
`,
    { mode: 0o755 },
  );
  chmodSync(curl, 0o755);

  const systemctl = path.join(bin, "systemctl");
  writeFileSync(systemctl, "#!/usr/bin/env bash\necho \"systemctl de mentira: $*\"\nexit 0\n", {
    mode: 0o755,
  });
  chmodSync(systemctl, 0o755);

  return { dir, bin, registro: path.join(dir, "curl-registro.txt") };
}

/** Roda o vigia inteiro na bancada e devolve o log que ele escreveu. */
function rodarVigia({ healthz, corpoHealthz, resend, segredos, relatorio = null, proximo = null }) {
  const { dir, bin, registro } = bancada({ healthz, corpoHealthz, resend });
  /*
   * O resumo semanal da entrega (24/09/2026). Sem `relatorio`, a bancada não
   * tem app instalado e o bloco some — que é o que as etapas antigas esperam.
   * Com ele, um `node` de mentira faz o papel de avisos-da-entrega.mjs.
   */
  const appDir = path.join(dir, "app");
  const proximoArq = path.join(dir, "proximo-relatorio");
  const nodeFalso = path.join(bin, "node-de-mentira");
  if (relatorio) {
    mkdirSync(path.join(appDir, "scripts"), { recursive: true });
    writeFileSync(path.join(appDir, "scripts", "avisos-da-entrega.mjs"), "// de mentira\n");
    const corpo =
      relatorio.codigo === 0
        ? `printf '%s\\n' ${JSON.stringify(JSON.stringify(relatorio.assunto))} ${JSON.stringify(JSON.stringify(relatorio.texto))}`
        : "";
    writeFileSync(nodeFalso, `#!/usr/bin/env bash\n${corpo}\nexit ${relatorio.codigo}\n`, { mode: 0o755 });
    chmodSync(nodeFalso, 0o755);
  }
  if (proximo !== null) writeFileSync(proximoArq, String(proximo));
  const log = path.join(dir, "vigia.log");
  const carimbo = path.join(dir, "carimbo");
  const arquivoSegredos = path.join(dir, "segredos.env");
  if (segredos !== null) writeFileSync(arquivoSegredos, segredos);

  const r = spawnSync("bash", [path.join(RAIZ, "ops/fotonio-vigia.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      VIGIA_LOG: log,
      VIGIA_CARIMBO: carimbo,
      VIGIA_SEGREDOS: arquivoSegredos,
      VIGIA_SERVICO: "servico-de-mentira",
      CURL_REGISTRO: registro,
      VIGIA_APP_DIR: relatorio ? appDir : path.join(dir, "sem-app"),
      VIGIA_NODE: nodeFalso,
      VIGIA_PROXIMO_RELATORIO: proximoArq,
    },
  });

  return {
    log: existsSync(log) ? readFileSync(log, "utf8") : "",
    enviado: existsSync(registro) ? readFileSync(registro, "utf8") : "",
    carimbou: existsSync(carimbo),
    saida: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    codigo: r.status,
    proximo: existsSync(proximoArq) ? Number(readFileSync(proximoArq, "utf8")) : null,
  };
}

const SEGREDOS_BONS = "RESEND_API_KEY=re_de_mentira\nALERTA_EMAIL_DESTINO=felipe@exemplo.com\n";

etapa("healthz 200: o vigia fica calado", () => {
  const r = rodarVigia({ healthz: 200, corpoHealthz: '{"ok":true}', resend: 200, segredos: SEGREDOS_BONS });
  if (r.log.trim()) throw new Error(`escreveu no log com tudo certo: ${r.log.trim()}`);
  return "sem ruído";
});

etapa("dependência fora: avisa, e o log diz para quem", () => {
  const r = rodarVigia({
    healthz: 503,
    corpoHealthz: '{"ok":false,"banco":false,"armazenamento":true}',
    resend: 200,
    segredos: SEGREDOS_BONS,
  });
  /* No E-MAIL, não no log: o log registra o corpo cru do healthz, e quem
     precisa entender o que quebrou é quem abre a mensagem às 3 da manhã. */
  if (!/banco de dados fora do ar/.test(r.enviado)) {
    throw new Error(`o aviso não nomeia a dependência que caiu: ${r.enviado.trim() || "(nada enviado)"}`);
  }
  /* `armazenamento (R2)` é a frase que o script MONTA quando o R2 está fora. A
     palavra solta não serve: o corpo do aviso repete a resposta crua do
     healthz, onde ela aparece de qualquer jeito. */
  if (/armazenamento \(R2\)/.test(r.enviado)) {
    throw new Error("acusou o armazenamento, que neste caso estava de pé");
  }
  if (!/aviso enviado para felipe@exemplo\.com/.test(r.log)) {
    throw new Error(`não registrou o envio: ${r.log.trim()}`);
  }
  if (!r.carimbou) throw new Error("não gravou o carimbo depois de enviar — avisaria de novo em 5 min");
  if (/systemctl de mentira/.test(r.saida)) {
    throw new Error("reiniciou o serviço num 503 — reiniciar não conserta dependência fora");
  }
  return "e não reiniciou nada";
});

/*
 * A etapa que pega o defeito de 17/09/2026. Antes dela, este caso escrevia
 * "aviso enviado" no log e engolia uma hora de silêncio — com ninguém avisado.
 */
etapa("Resend recusa: o log GRITA, e não queima a hora de silêncio", () => {
  const r = rodarVigia({
    healthz: 503,
    corpoHealthz: '{"ok":false,"banco":false,"armazenamento":true}',
    resend: 401,
    segredos: SEGREDOS_BONS,
  });
  if (/aviso enviado/.test(r.log)) {
    throw new Error(`disse que enviou com o Resend respondendo 401: ${r.log.trim()}`);
  }
  if (!/O AVISO NAO SAIU/.test(r.log)) {
    throw new Error(`não acusou a recusa: ${r.log.trim()}`);
  }
  if (!/401/.test(r.log)) throw new Error("não registrou o código que o Resend respondeu");
  if (r.carimbou) {
    throw new Error("gravou o carimbo depois de FALHAR — perderia mais uma hora em silêncio");
  }
  return "tenta de novo na próxima rodada";
});

/*
 * O RESUMO SEMANAL DA ENTREGA (24/09/2026). Felipe: "vou ser avisado quando
 * precisar aumentar o espaço?". O vigia pergunta ao app uma vez por semana e
 * manda pelo mesmo Resend. As quatro etapas abaixo são os quatro desfechos.
 */
const SEMANA = 7 * 24 * 3600;
const agora = () => Math.floor(Date.now() / 1000);
const RELATORIO = {
  codigo: 0,
  assunto: "Galeria Átomo: 1 ponto da entrega precisa de ação",
  texto: 'O disco do servidor de ZIP está pequeno. Aumente o volume para pelo menos 500 GB.\n\nPainel: "Tráfego"',
};

etapa("resumo semanal com aviso: envia, e só pergunta de novo em 7 dias", () => {
  const r = rodarVigia({ healthz: 200, corpoHealthz: '{"ok":true}', resend: 200, segredos: SEGREDOS_BONS, relatorio: RELATORIO });
  if (!/pelo menos 500 GB/.test(r.enviado)) throw new Error(`o texto do app não chegou ao e-mail: ${r.enviado.trim() || "(nada enviado)"}`);
  if (!/resumo semanal enviado para felipe@exemplo\.com/.test(r.log)) throw new Error(`não registrou o envio: ${r.log.trim()}`);
  if (!r.proximo || r.proximo < agora() + SEMANA - 60) throw new Error(`próxima pergunta em ${r.proximo} — devia ser daqui a 7 dias`);
  return "e o carimbo é de uma semana";
});

etapa("resumo semanal sem nada a contar: nenhum e-mail, e pergunta de novo em 7 dias", () => {
  const r = rodarVigia({ healthz: 200, corpoHealthz: '{"ok":true}', resend: 200, segredos: SEGREDOS_BONS, relatorio: { codigo: 3 } });
  if (r.enviado.trim()) throw new Error(`mandou e-mail sem aviso: ${r.enviado.trim()}`);
  if (r.log.trim()) throw new Error(`escreveu no log numa semana sem nada: ${r.log.trim()}`);
  if (!r.proximo || r.proximo < agora() + SEMANA - 60) throw new Error("não adiou a próxima pergunta");
  return "silêncio";
});

etapa("resumo semanal que o Resend recusa: grita, e tenta de novo em 1 hora, não em 7 dias", () => {
  const r = rodarVigia({ healthz: 200, corpoHealthz: '{"ok":true}', resend: 422, segredos: SEGREDOS_BONS, relatorio: RELATORIO });
  if (!/resumo semanal: !! NAO SAIU/.test(r.log)) throw new Error(`não acusou a recusa: ${r.log.trim()}`);
  if (!r.proximo || r.proximo > agora() + 3600 + 60) throw new Error(`adiou demais depois de falhar: ${r.proximo}`);
  return "próxima em 1h";
});

etapa("resumo semanal ainda não vencido: nem pergunta ao app", () => {
  const r = rodarVigia({
    healthz: 200, corpoHealthz: '{"ok":true}', resend: 200, segredos: SEGREDOS_BONS,
    relatorio: RELATORIO, proximo: agora() + 3 * 24 * 3600,
  });
  if (r.enviado.trim()) throw new Error("perguntou e enviou antes da hora");
  return "espera a semana fechar";
});

etapa("sem o segredo: diz QUAL falta, em vez de sumir", () => {
  const r = rodarVigia({
    healthz: 503,
    corpoHealthz: '{"ok":false,"banco":false,"armazenamento":true}',
    resend: 200,
    segredos: "RESEND_API_KEY=re_de_mentira\n",
  });
  if (!/ALERTA_EMAIL_DESTINO ausente/.test(r.log)) {
    throw new Error(`não nomeou a variável que falta: ${r.log.trim()}`);
  }
  return "ALERTA_EMAIL_DESTINO";
});

/* ── 3. O QUE O SERVIÇO CHAMA, O DEPLOY PRECISA INSTALAR ────────────────── */

/*
 * O defeito que esta etapa impede é o que deixou o vigia velho rodando por
 * semanas: `ops/` existia no git e NADA o instalava. Corrigir o arquivo aqui
 * não mudava o que roda lá.
 *
 * A pergunta é mecânica e ninguém a faz sozinho, porque as duas pontas moram em
 * arquivos que ninguém abre junto: todo `/opt/*.sh` citado por um `.service`
 * tem de ser um arquivo de `ops/` que o `deploy.sh` copia.
 */
etapa("o deploy instala todo script que um serviço chama", () => {
  const deploy = ler("deploy.sh");
  const opsDir = path.join(RAIZ, "ops");
  const servicos = readdirSync(opsDir).filter((f) => f.endsWith(".service"));

  const cobrados = new Set();
  for (const s of servicos) {
    const texto = readFileSync(path.join(opsDir, s), "utf8").replace(/\\\r?\n\s*/g, " ");
    for (const m of texto.matchAll(/ExecStart=(\/opt\/([a-z0-9-]+\.sh))/g)) cobrados.add(m[2]);
  }
  if (!cobrados.size) throw new Error("nenhum .service chama script de /opt — a etapa ficou sem objeto");

  const faltando = [];
  for (const nome of cobrados) {
    if (!existsSync(path.join(opsDir, nome))) {
      faltando.push(`${nome} (serviço chama /opt/${nome}, e não existe em ops/)`);
      continue;
    }
    /* O `deploy.sh` copia por nome-base num laço; o que importa é ele ser
       citado, não a forma exata do comando. */
    if (!deploy.includes(nome.replace(/\.sh$/, ""))) {
      faltando.push(`${nome} (existe em ops/, mas o deploy.sh não o envia)`);
    }
  }
  if (faltando.length) {
    throw new Error(
      `${faltando.join("; ")} — o servidor seguiria rodando a cópia velha, e ` +
        `corrigir o arquivo aqui não mudaria nada lá`,
    );
  }
  return [...cobrados].join(", ");
});

/* ── 4. O AVISO DO BACKUP ───────────────────────────────────────────────── */

/**
 * O backup não dá para rodar inteiro — ele faria `pg_dump` de um banco de
 * verdade. Então o `avisar()` é recortado e carregado sozinho.
 *
 * O recorte é por marcador de início e `}` na coluna zero; se um dia a função
 * mudar de forma, este teste falha a acha-la em vez de passar em silêncio.
 */
function avisarDoBackup(resend, segredos) {
  const fonte = ler("ops/fotonio-backup.sh");
  const inicio = fonte.indexOf("avisar() {");
  if (inicio < 0) throw new Error("não achei avisar() em ops/fotonio-backup.sh");
  const fim = fonte.indexOf("\n}\n", inicio);
  if (fim < 0) throw new Error("não achei o fim de avisar() em ops/fotonio-backup.sh");
  const funcao = fonte.slice(inicio, fim + 3);

  const { dir, bin } = bancada({ healthz: 200, resend });
  const arquivoSegredos = path.join(dir, "segredos.env");
  writeFileSync(arquivoSegredos, segredos);
  const roteiro = path.join(dir, "so-avisar.sh");
  writeFileSync(roteiro, `set -uo pipefail\nSEGREDOS="${arquivoSegredos}"\n${funcao}\navisar "Backup falhou"\n`);

  const r = spawnSync("bash", [roteiro], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

etapa("o aviso do backup confirma o envio", () => {
  const saida = avisarDoBackup(200, SEGREDOS_BONS);
  if (!/aviso enviado para felipe@exemplo\.com/.test(saida)) {
    throw new Error(`não confirmou o envio: ${saida.trim()}`);
  }
  return "no journal";
});

/*
 * Esta é a pior das falhas silenciadas: o backup falhou, o aviso não saiu, e
 * antes de 17/09/2026 o `|| true` no fim da função apagava as duas notícias.
 */
etapa("o aviso do backup GRITA quando não sai", () => {
  const saida = avisarDoBackup(422, SEGREDOS_BONS);
  if (!/O AVISO NAO SAIU/.test(saida)) {
    throw new Error(`engoliu a recusa do Resend: ${saida.trim()}`);
  }
  if (!/422/.test(saida)) throw new Error("não registrou o código da recusa");
  return "o banco sem cópia não fica em silêncio";
});

console.log(falhou ? "\n✗ o vigia tem problema" : "\n✓ o vigia avisa, e sabe quando não avisou\n");
process.exit(falhou ? 1 : 0);
