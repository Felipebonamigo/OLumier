import { mkdir, open, readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "./config.ts";

/**
 * O DISCO: os ZIPs prontos, e os que estão sendo montados agora.
 *
 * ── POR QUE GUARDAR (23/09/2026) ──────────────────────────────────────────
 *
 * Felipe: "ele é baixado muito no início, quando lança a galeria, depois
 * fica semanas, talvez meses parado". E: "e se os 100 convidados fizerem o
 * download completo?". O ZIP da galeria inteira é montado UMA vez — os
 * originais saem do B2 uma vez — e entregue quantas vezes pedirem. Cem
 * downloads custam cem vezes a banda deste servidor, que está incluída, e
 * zero vezes a do B2.
 *
 * ── MONTAGEM ÚNICA ────────────────────────────────────────────────────────
 *
 * Trinta cliques no mesmo segundo (o link chegou no grupo da família) não
 * podem virar trinta montagens. A primeira abre o `.part` e escreve; as outras
 * LEEM O MESMO `.part` ENQUANTO ELE CRESCE, e vão recebendo bytes conforme a
 * montagem avança — ninguém espera o fim para começar. O tamanho final é
 * conhecido desde o primeiro byte (`tamanhoDoZip`), então o `Content-Length`
 * sai certo para todo mundo.
 *
 * ── A CHAVE CARREGA A VERSÃO ──────────────────────────────────────────────
 *
 * Não há "invalidar o cache". Foto republicada, foto nova, foto apagada: a
 * chave muda (ver `chaveDeCache` em lib/zip-remoto.ts) e o arquivo velho
 * simplesmente não é mais encontrado. Ele fica no disco até a varredura
 * apagá-lo por idade.
 */

export interface Montagem {
  chave: string;
  tamanho: number;
  /** Quantos bytes já estão no `.part`. Só cresce. */
  escritos: number;
  /** Resolve quando o `.part` virou `.zip`; rejeita se a montagem falhou. */
  pronta: Promise<void>;
  erro: Error | null;
  /** Quem está esperando mais bytes. Acordado a cada escrita. */
  acordar: () => void;
  esperar: () => Promise<void>;
}

const emAndamento = new Map<string, Montagem>();

export const caminhoPronto = (chave: string) => path.join(CONFIG.cacheDir, `${chave}.zip`);
export const caminhoParcial = (chave: string) => path.join(CONFIG.cacheDir, `${chave}.part`);

export async function prepararDisco(): Promise<void> {
  await mkdir(CONFIG.cacheDir, { recursive: true });
}

/** O ZIP pronto, se existir. Marca o uso: é a idade que a varredura olha. */
export async function prontoNoDisco(chave: string): Promise<number | null> {
  try {
    const s = await stat(caminhoPronto(chave));
    const agora = new Date();
    await utimes(caminhoPronto(chave), agora, agora).catch(() => {});
    return s.size;
  } catch {
    return null;
  }
}

export function montagemEmAndamento(chave: string): Montagem | null {
  return emAndamento.get(chave) ?? null;
}

/**
 * Começa a montagem de `chave` escrevendo `fluxo` no `.part`, e devolve o
 * registro que os leitores acompanham. Quem chama garante que não há outra
 * montagem da mesma chave (ver `servidor.ts`, que consulta `emAndamento` e
 * chama isto na mesma volta do laço de eventos — não há corrida).
 */
export function iniciarMontagem(
  chave: string,
  tamanho: number,
  fluxo: AsyncIterable<Uint8Array>,
  aoTerminar: (resultado: { ok: boolean; bytes: number; duracaoMs: number }) => void,
): Montagem {
  let acordarTodos: () => void = () => {};
  let proximaEscrita = new Promise<void>((r) => (acordarTodos = r));

  const m: Montagem = {
    chave,
    tamanho,
    escritos: 0,
    erro: null,
    pronta: Promise.resolve(),
    acordar: () => {
      const acorda = acordarTodos;
      proximaEscrita = new Promise<void>((r) => (acordarTodos = r));
      acorda();
    },
    esperar: () => proximaEscrita,
  };

  m.pronta = (async () => {
    const inicio = Date.now();
    const parcial = caminhoParcial(chave);
    const fd = await open(parcial, "w");
    try {
      for await (const pedaco of fluxo) {
        await fd.write(pedaco);
        m.escritos += pedaco.length;
        m.acordar();
      }
      await fd.close();
      if (m.escritos !== tamanho) {
        throw new Error(`o ZIP ficou com ${m.escritos} bytes, e o previsto era ${tamanho}`);
      }
      await rename(parcial, caminhoPronto(chave));
      aoTerminar({ ok: true, bytes: m.escritos, duracaoMs: Date.now() - inicio });
    } catch (e) {
      m.erro = e as Error;
      await fd.close().catch(() => {});
      await unlink(parcial).catch(() => {});
      aoTerminar({ ok: false, bytes: m.escritos, duracaoMs: Date.now() - inicio });
      throw e;
    } finally {
      emAndamento.delete(chave);
      m.acordar();
    }
  })();
  m.pronta.catch(() => {}); // quem lê trata `erro`; a promessa não pode virar unhandled

  emAndamento.set(chave, m);
  return m;
}

/**
 * Lê `[inicio, fim]` de um ZIP guardado — pronto ou ainda crescendo.
 *
 * Com uma montagem em andamento, lê até onde ela chegou e ESPERA pelo resto;
 * é o que serve o segundo clique enquanto o primeiro ainda monta. O `fd` é
 * aberto no `.part`; quando a montagem termina o arquivo é renomeado, e um fd
 * aberto continua lendo o mesmo inode — não há corrida com o rename.
 */
export async function* lerDoDisco(
  chave: string,
  montagem: Montagem | null,
  inicio: number,
  fim: number,
  pedaco = 256 * 1024,
): AsyncGenerator<Uint8Array> {
  /* O `.part` pode ter virado `.zip` entre o caller olhar a montagem e chegar
     aqui; nesse caso o pronto é o certo, e a montagem já não tem o que esperar. */
  const fd = await open(
    montagem && !montagem.erro && emAndamento.has(chave) ? caminhoParcial(chave) : caminhoPronto(chave),
    "r",
  ).catch(() => open(caminhoPronto(chave), "r"));
  try {
    let posicao = inicio;
    while (posicao <= fim) {
      const disponivel = montagem ? montagem.escritos : fim + 1;
      if (posicao >= disponivel) {
        if (!montagem) break;
        if (montagem.erro) throw montagem.erro;
        if (!emAndamento.has(chave) && montagem.escritos <= posicao) {
          /* Terminou (ou morreu) sem chegar até aqui. */
          if (montagem.erro) throw montagem.erro;
          break;
        }
        await montagem.esperar();
        continue;
      }
      const ate = Math.min(fim + 1, disponivel);
      const tamanho = Math.min(pedaco, ate - posicao);
      const buffer = Buffer.allocUnsafe(tamanho);
      const { bytesRead } = await fd.read(buffer, 0, tamanho, posicao);
      if (bytesRead === 0) {
        if (!montagem) break;
        await montagem.esperar();
        continue;
      }
      posicao += bytesRead;
      yield bytesRead === tamanho ? buffer : buffer.subarray(0, bytesRead);
    }
  } finally {
    await fd.close();
  }
}

/**
 * A varredura: apaga ZIP pronto sem uso há `cacheDias`, `.part` órfão (de um
 * processo que caiu) e, passado o teto do disco, o mais antigo primeiro.
 */
export async function varrer(): Promise<{ apagados: number; bytesNoDisco: number }> {
  const agora = Date.now();
  const limite = agora - CONFIG.cacheDias * 24 * 3600 * 1000;
  let apagados = 0;
  const vivos: { caminho: string; bytes: number; mtime: number }[] = [];

  for (const nome of await readdir(CONFIG.cacheDir)) {
    const caminho = path.join(CONFIG.cacheDir, nome);
    let s;
    try {
      s = await stat(caminho);
    } catch {
      continue;
    }
    if (nome.endsWith(".part")) {
      const chave = nome.slice(0, -".part".length);
      if (!emAndamento.has(chave)) {
        await unlink(caminho).catch(() => {});
        apagados++;
      }
      continue;
    }
    if (!nome.endsWith(".zip")) continue;
    if (s.mtimeMs < limite) {
      await unlink(caminho).catch(() => {});
      apagados++;
      continue;
    }
    vivos.push({ caminho, bytes: s.size, mtime: s.mtimeMs });
  }

  let total = vivos.reduce((s, v) => s + v.bytes, 0);
  vivos.sort((a, b) => a.mtime - b.mtime);
  for (const v of vivos) {
    if (total <= CONFIG.cacheMaxBytes) break;
    await unlink(v.caminho).catch(() => {});
    total -= v.bytes;
    apagados++;
  }
  return { apagados, bytesNoDisco: total };
}

export function montagensAtivas(): number {
  return emAndamento.size;
}
