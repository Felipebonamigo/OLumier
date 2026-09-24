import {
  EXCEDENTE_B2_CENTAVOS_GB,
  EXCEDENTE_SERVIDOR_ZIP_CENTAVOS_GB,
  FRANQUIA_B2_MULTIPLO,
  FRANQUIA_SERVIDOR_ZIP_BYTES,
  FRANQUIA_VPS_BYTES,
  gbDe,
} from "@/config/trafego";
import { CUSTOS_FIXOS, IOF, SPREAD_CARTAO } from "@/config/custos-fixos";

/**
 * AS CONTAS DE TRÁFEGO DO PAINEL — quanto saiu, por onde, e se cabe.
 *
 * Puras, como `metricas-admin.ts`: recebem as somas do mês já lidas do banco
 * e devolvem números e avisos. Felipe, 23/09/2026: "precisamos ter no painel
 * admin algo cuidando disso, para que eu saiba se precisamos mudar algo ou
 * não, se o custo mudou". O que esta tela responde:
 *
 *   · o servidor de ZIP está fazendo o que se previu? (montou uma vez, serviu
 *     muitas — a proporção que sai do cache);
 *   · o download está dentro do que o B2 dá de graça?
 *   · o tráfego do servidor está dentro dos 20 TB?
 *   · algum byte de ZIP ainda passa pelo VPS?
 *   · quanto custou o tráfego, e quanto custa cada TB guardado com tudo somado.
 *
 * Cada aviso diz a ação, não só o número: "passou de X, hora de Y".
 */

export interface SomasDeEntrega {
  /** ZIPs montados: leram o armazém inteiro. Qualquer origem. */
  montadosN: number;
  montadosBytes: number;
  /** ZIPs entregues até o fim, pelo servidor. */
  servidosServidorN: number;
  servidosServidorBytes: number;
  /** Dos servidos pelo servidor, quantos saíram do arquivo guardado. */
  doCacheN: number;
  doCacheBytes: number;
  /** ZIPs entregues pelo VPS (o caminho de reserva). */
  servidosVpsN: number;
  servidosVpsBytes: number;
  /** Downloads que caíram no meio, e o que chegou a sair. */
  abortadosN: number;
  abortadosBytes: number;
  abortadosVpsBytes: number;
  /** Downloads de foto avulsa e em lote no celular (acessos 'baixou' fora do ZIP). */
  avulsosN: number;
  /** Tamanho médio de uma mídia, para estimar os bytes dos avulsos. */
  bytesPorMedia: number;
  /**
   * Só os ZIPs GUARDÁVEIS (galeria inteira e capítulo) entregues pelo
   * servidor, e quantos deles saíram do arquivo guardado. Favoritas e recorte
   * nunca são guardados, de propósito: contá-los na fração faria o painel
   * acusar disco pequeno numa galeria de muitas favoritas (24/09/2026).
   */
  guardaveisServidosN: number;
  guardaveisDoCacheN: number;
  /** ZIPs prontos que o servidor apagou para caber outro (migração 042). */
  despejosN: number;
  despejosBytes: number;
  /**
   * Remontagens: a mesma galeria montada de novo, com o mesmo tamanho, menos
   * de 14 dias depois da anterior. É o rodízio — o disco pequeno fazendo ler
   * o B2 à toa. Mudança de conteúdo muda o tamanho e não entra aqui.
   */
  remontagensN: number;
  remontagensBytes: number;
  /**
   * O que o disco precisaria guardar para não despejar: a soma dos ZIPs
   * guardáveis distintos montados nos últimos 14 dias (o prazo do cache).
   */
  conjuntoQuenteBytes: number;
}

export interface Aviso {
  nivel: "ok" | "alerta" | "erro";
  texto: string;
}

export interface ResumoDeTrafego {
  /** Estimativa do que saiu do B2 no mês: montagens mais avulsos. */
  egressB2Bytes: number;
  franquiaB2Bytes: number;
  fracaoB2: number;
  excedenteB2Bytes: number;
  custoExcedenteB2Centavos: number;
  /** O que saiu do servidor de ZIP (entregues mais abortados). */
  trafegoServidorBytes: number;
  fracaoServidor: number;
  excedenteServidorBytes: number;
  custoExcedenteServidorCentavos: number;
  /** O que saiu do VPS em ZIP — deveria ser zero. */
  trafegoVpsBytes: number;
  fracaoVps: number;
  /** Dos ZIPs GUARDÁVEIS entregues pelo servidor, a fração que não tocou o armazém. */
  fracaoDoCache: number;
  /**
   * O tamanho de volume que caberia o uso atual com folga, em GB, arredondado
   * para cima em degraus de 100 GB. `null` quando não há uso para medir.
   */
  discoSugeridoGb: number | null;
  /** O que o mês custou de tráfego, com IOF e spread. */
  custoTrafegoCentavos: number;
  /** O servidor de ZIP, como custo fixo do mês. */
  custoServidorZipCentavos: number;
  /** (guardado + servidor + tráfego) ÷ TB guardados. É o "R$ 50 por TB" acompanhado. */
  custoPorTbGuardadoCentavos: number | null;
  avisos: Aviso[];
}

const cambio = (centavosEmDolarOuEuro: number) =>
  centavosEmDolarOuEuro * (1 + IOF) * (1 + SPREAD_CARTAO);

export function custoServidorZipCentavos(): number {
  return CUSTOS_FIXOS.find((c) => c.id === "servidor-zip")?.centavosPorMes ?? 0;
}

export function resumoDeTrafego(
  somas: SomasDeEntrega,
  contexto: {
    bytesGuardados: number | bigint;
    custoDoGuardadoCentavos: number;
    servidorConfigurado: boolean;
  },
): ResumoDeTrafego {
  const guardado = Number(contexto.bytesGuardados);
  const avulsosBytes = somas.avulsosN * somas.bytesPorMedia;

  const egressB2Bytes = somas.montadosBytes + avulsosBytes;
  const franquiaB2Bytes = guardado * FRANQUIA_B2_MULTIPLO;
  const excedenteB2Bytes = Math.max(0, egressB2Bytes - franquiaB2Bytes);
  const custoExcedenteB2Centavos = Math.round(cambio(gbDe(excedenteB2Bytes) * EXCEDENTE_B2_CENTAVOS_GB));

  const trafegoServidorBytes =
    somas.servidosServidorBytes + (somas.abortadosBytes - somas.abortadosVpsBytes);
  const excedenteServidorBytes = Math.max(0, trafegoServidorBytes - FRANQUIA_SERVIDOR_ZIP_BYTES);
  const custoExcedenteServidorCentavos = Math.round(
    cambio(gbDe(excedenteServidorBytes) * EXCEDENTE_SERVIDOR_ZIP_CENTAVOS_GB),
  );

  const trafegoVpsBytes = somas.servidosVpsBytes + somas.abortadosVpsBytes;

  const fracaoDoCache =
    somas.guardaveisServidosN === 0 ? 0 : somas.guardaveisDoCacheN / somas.guardaveisServidosN;

  /* O teto do cache é 85% do disco (o instalador calcula assim), e os ZIPs
     de uma semana cheia chegam juntos: o conjunto quente dividido por 0,85,
     arredondado para o degrau de 100 GB de cima. */
  const discoSugeridoGb =
    somas.conjuntoQuenteBytes > 0
      ? Math.max(100, Math.ceil(somas.conjuntoQuenteBytes / 0.85 / 1000 ** 3 / 100) * 100)
      : null;

  const custoServidor = contexto.servidorConfigurado ? custoServidorZipCentavos() : 0;
  const custoTrafegoCentavos = custoExcedenteB2Centavos + custoExcedenteServidorCentavos;
  const tbGuardados = guardado / 1000 ** 4;
  const custoPorTbGuardadoCentavos =
    tbGuardados > 0
      ? Math.round((contexto.custoDoGuardadoCentavos + custoServidor + custoTrafegoCentavos) / tbGuardados)
      : null;

  const avisos: Aviso[] = [];
  const tb = (b: number) => `${(b / 1000 ** 4).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} TB`;

  if (!contexto.servidorConfigurado) {
    avisos.push({
      nivel: "alerta",
      texto:
        "Servidor de ZIP não configurado: todo ZIP está passando pelo VPS. Definir ZIP_SERVIDOR_URL e ZIP_SEGREDO no app (docs/servidor-zip.md).",
    });
  } else if (trafegoVpsBytes > 0) {
    avisos.push({
      nivel: "alerta",
      texto: `${tb(trafegoVpsBytes)} de ZIP saíram pelo VPS este mês: a reserva está em uso. Conferir se o servidor de ZIP ficou fora do ar.`,
    });
  }
  if (trafegoVpsBytes > FRANQUIA_VPS_BYTES * 0.5) {
    avisos.push({
      nivel: "erro",
      texto: `O VPS passou da metade dos ${tb(FRANQUIA_VPS_BYTES)} da Hostinger. Acima disso ele cai para 10 Mbps até a virada do mês, com os outros sites junto.`,
    });
  }

  const fracaoServidor = trafegoServidorBytes / FRANQUIA_SERVIDOR_ZIP_BYTES;
  if (fracaoServidor >= 0.9) {
    avisos.push({
      nivel: "erro",
      texto: `Servidor de ZIP em ${Math.round(fracaoServidor * 100)}% dos ${tb(FRANQUIA_SERVIDOR_ZIP_BYTES)} do mês. Acima, € 1 por TB — e é o sinal de trocar por um servidor dedicado com tráfego ilimitado (degrau 2).`,
    });
  } else if (fracaoServidor >= 0.6) {
    avisos.push({
      nivel: "alerta",
      texto: `Servidor de ZIP em ${Math.round(fracaoServidor * 100)}% da franquia mensal. Se a curva continuar, o próximo degrau é um dedicado com tráfego ilimitado.`,
    });
  }

  const fracaoB2 = franquiaB2Bytes === 0 ? (egressB2Bytes > 0 ? Infinity : 0) : egressB2Bytes / franquiaB2Bytes;
  if (excedenteB2Bytes > 0) {
    avisos.push({
      nivel: "erro",
      texto: `Download do B2 passou da franquia de 3× o guardado em ${tb(excedenteB2Bytes)} (estimativa). Custo extra de R$ ${(custoExcedenteB2Centavos / 100).toFixed(2)}. Se repetir, rever o desenho: originais quentes no R2 ou Hetzner Object Storage.`,
    });
  } else if (fracaoB2 >= 0.8) {
    avisos.push({
      nivel: "alerta",
      texto: `Download do B2 em ${Math.round(fracaoB2 * 100)}% da franquia de 3× o guardado. Ainda grátis; acompanhar.`,
    });
  }

  /*
   * O DISCO DO SERVIDOR DE ZIP (24/09/2026).
   *
   * O sinal é o despejo que o servidor relata, não a fração do cache: um
   * despejo é o disco cheio de fato, e uma remontagem é esse disco cheio
   * custando leitura do B2. O texto diz a ação e o tamanho, porque é lido
   * por quem vai clicar em "Resize" na Hetzner, não por quem escreveu isto.
   */
  const gb = (b: number) => `${Math.round(b / 1000 ** 3).toLocaleString("pt-BR")} GB`;
  const alvo = discoSugeridoGb ? `para pelo menos ${discoSugeridoGb.toLocaleString("pt-BR")} GB` : "";
  const comoAumentar =
    "Hetzner → Volumes → Resize, depois `resize2fs` e rodar o instalador de novo (docs/servidor-zip.md).";
  if (somas.remontagensN >= 3) {
    avisos.push({
      nivel: "erro",
      texto: `O disco do servidor de ZIP está pequeno para o volume atual: ${somas.remontagensN} ZIPs foram montados de novo depois de apagados por falta de espaço, lendo ${gb(somas.remontagensBytes)} do B2 à toa. Aumente o volume ${alvo}. ${comoAumentar}`,
    });
  } else if (somas.despejosN > 0) {
    avisos.push({
      nivel: "alerta",
      texto: `O disco do servidor de ZIP encheu este mês e apagou ${somas.despejosN} ZIP${somas.despejosN === 1 ? "" : "s"} pronto${somas.despejosN === 1 ? "" : "s"} (${gb(somas.despejosBytes)}) para caber outros. Ainda sem custo; se virar rotina, aumente o volume ${alvo}.`,
    });
  }

  const entregues = somas.servidosServidorN + somas.servidosVpsN;
  if (entregues + somas.abortadosN >= 10 && somas.abortadosN > (entregues + somas.abortadosN) * 0.3) {
    avisos.push({
      nivel: "alerta",
      texto: `${somas.abortadosN} de ${entregues + somas.abortadosN} downloads de ZIP caíram no meio. Com retomada isso não custa de novo, mas vale olhar se é deploy derrubando (origem VPS) ou conexão do cliente.`,
    });
  }

  if (avisos.length === 0) {
    avisos.push({ nivel: "ok", texto: "Tráfego dentro do previsto: download grátis no B2, servidor de ZIP dentro da franquia, nada pelo VPS." });
  }

  return {
    egressB2Bytes,
    franquiaB2Bytes,
    fracaoB2: Number.isFinite(fracaoB2) ? fracaoB2 : 1,
    excedenteB2Bytes,
    custoExcedenteB2Centavos,
    trafegoServidorBytes,
    fracaoServidor,
    excedenteServidorBytes,
    custoExcedenteServidorCentavos,
    trafegoVpsBytes,
    fracaoVps: trafegoVpsBytes / FRANQUIA_VPS_BYTES,
    fracaoDoCache,
    discoSugeridoGb,
    custoTrafegoCentavos,
    custoServidorZipCentavos: custoServidor,
    custoPorTbGuardadoCentavos,
    avisos,
  };
}
