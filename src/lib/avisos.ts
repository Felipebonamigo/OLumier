import "server-only";
import { createHmac } from "node:crypto";
import { consultar, consultarUm } from "./db";
import { cifrar, decifrar, temCripto } from "./cripto";
import { galeriasNoAr } from "./assinatura";

/**
 * CANAL DE AVISOS — contar ao outro lado que a entrega mudou de estado.
 *
 * O Atomatiza já sabia PERGUNTAR (o botão "conferir" da ficha do contrato).
 * O que faltava era o contrário: o fotógrafo publica a galeria aqui e o
 * contrato lá continua dizendo "fora do ar" até alguém lembrar de clicar.
 *
 * ── AS QUATRO REGRAS DESTE CANAL ──────────────────────────────────────────
 *
 * 1. AVISAR NUNCA DERRUBA O QUE O DISPAROU. Mesmo desenho de `registrarEvento`:
 *    o catch é vazio de propósito. Quem chama está no caminho do fotógrafo —
 *    publicando uma galeria, arquivando outra. Se o aviso derrubasse a ação, o
 *    outro sistema estar fora do ar impediria o trabalho AQUI, e uma integração
 *    de conveniência viraria um ponto único de falha. Perder um aviso é ruim;
 *    travar a publicação é pior — e quem perdeu o aviso ainda tem o botão
 *    "conferir" do outro lado, que nunca deixou de existir.
 *
 * 2. O QUE VAI NO AVISO É O MÍNIMO. Nem título, nem endereço, nem nada do
 *    casal: só o id da galeria, a referência que o outro lado mandou, o estado
 *    e a contagem. Em especial NÃO VAI A URL — quem recebe já a tem, do
 *    pareamento; aceitar endereço por aviso deixaria um aviso forjado apontar o
 *    casal para outro lugar.
 *
 * 3. O ESTADO É CALCULADO, NUNCA A COLUNA CRUA. `noAr` passa pela mesma régua
 *    da página pública (publicada + estado + prazo + carência do trial). Um
 *    aviso dizendo "no ar" sobre uma galeria que não abre é pior que aviso
 *    nenhum: o outro lado vai escrever isso na tela de quem vende.
 *
 * 4. `ocorridoEm` VAI JUNTO, e é o que o outro lado usa para ORDENAR. Rede
 *    reordena: publicar e despublicar em sequência pode chegar ao contrário, e
 *    sem a hora do FATO o último a chegar venceria — deixando a ficha dizendo
 *    "no ar" para uma galeria que acabou de sair.
 */

/** O que o outro lado recebe. Repare no que NÃO está aqui — ver a regra 2. */
export interface AvisoDeEntrega {
  evento: "entrega.mudou";
  /** Quando o FATO aconteceu aqui, não quando a requisição saiu. */
  ocorridoEm: string;
  galeriaId: string;
  /** A referência opaca que o outro lado mandou ao criar (lá, o id do contrato). */
  referenciaExterna: string;
  noAr: boolean;
  totalMedias: number;
}

export interface Canal {
  tenantId: string;
  url: string;
  segredo: string;
}

/** O canal do estúdio, com o segredo decifrado. `null` quando não há canal, ou
 *  quando o que está guardado não abre mais (segredo do servidor trocado) — nos
 *  dois casos a resposta certa é a mesma: não há como avisar. */
export async function canalDoEstudio(tenantId: string): Promise<Canal | null> {
  const linha = await consultarUm<{ url: string; segredo: string }>(
    "select url, segredo from avisos where tenant_id = $1",
    [tenantId],
  );
  if (!linha) return null;
  try {
    return { tenantId, url: linha.url, segredo: decifrar(linha.segredo) };
  } catch {
    return null;
  }
}

/**
 * O canal como a TELA pode vê-lo. Sem o segredo — nunca, em hipótese nenhuma.
 *
 * Existe separado de `canalDoEstudio` de propósito, e a diferença é a única
 * coisa que importa neste tipo: aquela função decifra o segredo porque vai
 * ASSINAR com ele; esta serve uma página, e página vira HTML que vira cache,
 * print, "inspecionar elemento" e relato de suporte. Um segredo que passa por
 * um componente de tela é um segredo que já vazou — mesmo que nenhum JSX o
 * escreva hoje, basta o próximo `JSON.stringify` de depuração.
 *
 * Por isso o segredo nem sai do banco aqui: o `select` não o pede.
 *
 * Devolve `null` quando não há canal. Diferente de `canalDoEstudio`, um segredo
 * ilegível (chave do servidor trocada) NÃO vira `null`: para quem envia isso é
 * "não há como avisar", mas para quem OLHA a tela o canal existe e está
 * quebrado — e é justamente esse o estado que a pessoa precisa enxergar para
 * saber que tem de reconectar do outro lado.
 */
export interface EstadoDoCanal {
  url: string;
  criadoEm: Date;
  ultimoEnvioEm: Date | null;
  ultimoErro: string | null;
}

export async function estadoDoCanal(tenantId: string): Promise<EstadoDoCanal | null> {
  const linha = await consultarUm<{
    url: string;
    criado_em: Date;
    ultimo_envio_em: Date | null;
    ultimo_erro: string | null;
  }>(
    `select url, criado_em, ultimo_envio_em, ultimo_erro
       from avisos where tenant_id = $1`,
    [tenantId],
  );
  if (!linha) return null;
  return {
    url: linha.url,
    criadoEm: linha.criado_em,
    ultimoEnvioEm: linha.ultimo_envio_em,
    ultimoErro: linha.ultimo_erro,
  };
}

/** Registra (ou troca) o canal do estúdio. O segredo chega de quem RECEBE. */
export async function registrarCanal(tenantId: string, url: string, segredo: string) {
  if (!temCripto) throw new Error("AVISOS_ENC_KEY ausente — não guardo segredo em claro.");
  await consultar(
    `insert into avisos (tenant_id, url, segredo) values ($1, $2, $3)
         on conflict (tenant_id) do update
        set url = excluded.url, segredo = excluded.segredo,
            criado_em = now(), ultimo_erro = null, ultimo_envio_em = null`,
    [tenantId, url, cifrar(segredo)],
  );
}

export async function removerCanal(tenantId: string) {
  await consultar("delete from avisos where tenant_id = $1", [tenantId]);
}

/** A assinatura do corpo. HMAC-SHA256 sobre o texto EXATO que vai na rede —
 *  não sobre o objeto: quem confere do outro lado lê os bytes crus, e
 *  serializar de novo lá daria outro texto ao menor detalhe de ordem. */
export function assinar(corpo: string, segredo: string): string {
  return createHmac("sha256", segredo).update(corpo).digest("hex");
}

/** Quanto tempo esperar pelo outro lado. Curto de propósito: isto roda dentro
 *  de uma ação do painel, e o fotógrafo está olhando para um botão. */
const TEMPO_MAXIMO_MS = 4000;

/**
 * Conta ao outro lado que a entrega desta galeria mudou. NUNCA lança.
 *
 * Só sai aviso de galeria que veio de fora (`origem_ref` preenchido): galeria
 * criada no painel não representa registro nenhum lá, e avisar sobre ela seria
 * mandar um evento que o outro lado não tem onde encaixar.
 */
export async function avisarEntrega(galeriaId: string): Promise<void> {
  try {
    const g = await consultarUm<{
      tenant_id: string;
      origem: string | null;
      origem_ref: string | null;
      publicada: boolean;
      estado: string;
      expira_em: Date | null;
      total_medias: number;
      estudio_status: string;
      estudio_trial_ate: Date | null;
    }>(
      `select g.tenant_id, g.origem, g.origem_ref, g.publicada, g.estado, g.expira_em,
              (select count(*)::int from medias m where m.galeria_id = g.id and m.pronto) as total_medias,
              t.status as estudio_status, t.trial_ate as estudio_trial_ate
         from galerias g join tenants t on t.id = g.tenant_id
        where g.id = $1`,
      [galeriaId],
    );
    if (!g?.origem_ref) return;

    const canal = await canalDoEstudio(g.tenant_id);
    if (!canal) return;

    const vencida = Boolean(g.expira_em && new Date(g.expira_em) < new Date());
    const aviso: AvisoDeEntrega = {
      evento: "entrega.mudou",
      ocorridoEm: new Date().toISOString(),
      galeriaId,
      referenciaExterna: g.origem_ref,
      noAr:
        g.publicada && g.estado === "online" && !vencida &&
        galeriasNoAr({ status: g.estudio_status, trial_ate: g.estudio_trial_ate }),
      totalMedias: g.total_medias,
    };

    const corpo = JSON.stringify(aviso);
    let erro: string | null = null;
    try {
      const r = await fetch(canal.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          /* O ESTÚDIO vai em claro, e não é segredo nenhum: é o que diz ao
           * outro lado QUAL segredo usar para conferir. Quem autentica é a
           * assinatura; isto só escolhe a chave. */
          "x-atomo-estudio": g.tenant_id,
          "x-atomo-assinatura": assinar(corpo, canal.segredo),
        },
        body: corpo,
        cache: "no-store",
        signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
      });
      if (!r.ok) erro = `HTTP ${r.status}`;
    } catch (e) {
      erro = e instanceof Error ? e.message.slice(0, 200) : "falhou";
    }

    /* O resultado fica gravado — é a resposta para "o aviso chegou?", que é a
     * pergunta que aparece quando alguém reclama. Sem isto, a falha some. */
    await consultar(
      "update avisos set ultimo_envio_em = now(), ultimo_erro = $2 where tenant_id = $1",
      [g.tenant_id, erro],
    );
  } catch (e) {
    // Regra 1: avisar não derruba nada. Fica no log do servidor e a vida segue.
    console.error("[avisos] não consegui avisar a entrega:", e);
  }
}
