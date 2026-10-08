"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import {
  FONTES_TITULO,
  fonteDoDetalhe,
  medidaDaLogo,
  proporcaoDaLogo,
  pesoDoTitulo,
  type Aparencia,
} from "@/config/aparencia";
import {
  duracaoLegivel,
  fracaoAssistida,
  pontoDeRetomada,
  relogio,
} from "@/lib/formato-da-entrega";
import { baixarNoComputador } from "@/lib/salvar-client";
import { AvisoDoVideo, useSaudeDoVideo } from "./aviso-do-video";

/**
 * A ENTREGA EM STREAM — os vídeos numa tela de cinema, em fileiras, com
 * "próximo episódio".
 *
 * ── DE ONDE VEIO (30/09/2026) ─────────────────────────────────────────────
 *
 * "Uma outra forma de Stream (estilo Netflix), que vai passando os episódios
 * e tudo mais — mais para vídeos. Hoje nossa entrega de vídeos ainda é meio
 * feia/pobre."
 *
 * Era mesmo. O vídeo entrava na grade de fotos como mais um ladrilho, com um
 * triângulo no meio; abrir era o visualizador de FOTO tocando um filme, sem
 * nome, sem duração, sem saber que havia um segundo vídeo depois. Para quem
 * entrega filme o filme é o trabalho, e ele merecia a tela que as pessoas já
 * sabem usar: fundo grande, "Assistir", fileiras, e o próximo começando sozinho.
 *
 * ── O QUE É DO FOTÓGRAFO, E O QUE É DO FORMATO ────────────────────────────
 *
 * O formato é a ESTRUTURA — capa de cinema, fileiras, player. A cara continua
 * sendo a da galeria: fundo, texto, destaque, canto e letra vêm das mesmas
 * variáveis de tema, o título sai na fonte escolhida, a logo é a do estúdio.
 * O Stream da Sirius e o de um filmmaker de clipe não podem sair iguais (ver
 * `docs/estrategia-de-marca.md`, §8 e §9) — e não saem, porque nada aqui tem
 * cor própria.
 *
 * ── O QUE FICA SÓ NESTE NAVEGADOR ─────────────────────────────────────────
 *
 * Onde a pessoa parou em cada vídeo mora no `localStorage`, por galeria. É
 * conveniência de quem assiste, não dado do fotógrafo: some se a pessoa limpar
 * o navegador, e a tela não promete nada além de "continuar de onde parou"
 * NESTE aparelho. Toda leitura e escrita está num `try` — aba anônima e
 * armazenamento bloqueado simplesmente não lembram.
 */

export interface EpisodioDoStream {
  id: string;
  /**
   * Contado na galeria inteira, na ordem das fileiras. Só as salas que são
   * LISTA numeram (Episódios e Mostra, onde o número é desenho). O "E1"
   * miúdo sobre o cartão e no player saiu a pedido do Juan (30/09/2026):
   * "tirar o EP1 minúsculo que fica no vídeo".
   */
  numero: number;
  /** O nome escrito pelo fotógrafo (migração 055) ou o tirado do arquivo. */
  titulo: string;
  /** O nome original — é com ele que o arquivo baixado chega. */
  nomeDoArquivo: string;
  /** Segundos, quando o envio gravou. Null nos vídeos anteriores a 30/09/2026. */
  duracao: number | null;
  /** O pôster (~640 px). Null = vídeo sem capa: o cartão desenha a cor do tema. */
  poster: string | null;
  bytes: number;
}

export interface FileiraDoStream {
  id: string;
  nome: string;
  /** Uma frase embaixo do nome — só a fileira dos vídeos soltos tem. Ver `fraseDosVideos`. */
  frase?: string;
  episodios: EpisodioDoStream[];
}

type Marca = { t: number; d: number; em: number };

const chaveDoProgresso = (galeriaId: string) => `stream:${galeriaId}`;

function lerProgresso(galeriaId: string): Record<string, Marca> {
  try {
    const bruto = window.localStorage.getItem(chaveDoProgresso(galeriaId));
    const lido = bruto ? (JSON.parse(bruto) as unknown) : null;
    return lido && typeof lido === "object" ? (lido as Record<string, Marca>) : {};
  } catch {
    return {};
  }
}

function gravarProgresso(galeriaId: string, tudo: Record<string, Marca>) {
  try {
    window.localStorage.setItem(chaveDoProgresso(galeriaId), JSON.stringify(tudo));
  } catch {
    /* Armazenamento cheio ou bloqueado: a pessoa só não volta de onde parou. */
  }
}

const ESPERA_DO_PROXIMO = 8;

function tamanho(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export function GaleriaStream({
  galeriaId,
  aparencia,
  titulo,
  subtitulo,
  dataFormatada,
  estudio,
  logoUrl,
  logoLargura = null,
  logoAltura = null,
  fundo,
  fundoVideo = null,
  focoX,
  focoY,
  fileiras,
  fotos,
  permiteDownload,
  identificado,
}: {
  galeriaId: string;
  /** `capaStream` decide se a sala desenha a própria capa ou se a página já
      desenhou a do grupo Capa acima dela. Ver `CapaDoStream`. */
  aparencia: Aparencia;
  titulo: string;
  subtitulo: string | null;
  dataFormatada: string | null;
  estudio: string;
  logoUrl: string | null;
  /** A medida do arquivo da logo — a mesma régua da capa, ver `medidaDaLogo`. */
  logoLargura?: number | null;
  logoAltura?: number | null;
  fundo: string | null;
  /** O clipe da capa em vídeo (migração 066): toca mudo, em laço, por cima de `fundo`. */
  fundoVideo?: string | null;
  focoX: number;
  focoY: number;
  fileiras: FileiraDoStream[];
  fotos: { total: number; amostra: string[]; href: string };
  permiteDownload: boolean;
  /** A pessoa já disse quem é nesta galeria — ver a porta do download. */
  identificado: boolean;
}) {
  const episodios = useMemo(() => fileiras.flatMap((f) => f.episodios), [fileiras]);
  const fileiraDe = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fileiras) for (const e of f.episodios) m.set(e.id, f.nome);
    return m;
  }, [fileiras]);

  /*
   * O progresso começa VAZIO e é lido depois de montar: o servidor não tem
   * `localStorage`, e ler durante a primeira pintura faria o HTML do servidor
   * e o do navegador discordarem (as barrinhas nasceriam num e não no outro).
   */
  const [progresso, setProgresso] = useState<Record<string, Marca>>({});
  /* eslint-disable-next-line react-hooks/set-state-in-effect --
     O armazenamento do navegador só existe depois de montar; ver acima. */
  useEffect(() => setProgresso(lerProgresso(galeriaId)), [galeriaId]);

  const [tocando, setTocando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /* O "Assistir" da capa: o último vídeo começado e não terminado, ou o
     primeiro. É a pergunta que a pessoa traz ao voltar — "onde eu estava?". */
  const continuar = useMemo(() => {
    let melhor: { ep: EpisodioDoStream; marca: Marca } | null = null;
    for (const ep of episodios) {
      const marca = progresso[ep.id];
      if (!marca || pontoDeRetomada(marca.t, marca.d) === 0) continue;
      if (!melhor || marca.em > melhor.marca.em) melhor = { ep, marca };
    }
    return melhor;
  }, [episodios, progresso]);

  const duracaoTotal = episodios.reduce(
    (s, e) => s + (e.duracao ?? progresso[e.id]?.d ?? 0),
    0,
  );
  const todasComDuracao = episodios.every((e) => e.duracao || progresso[e.id]?.d);

  const detalhe = fonteDoDetalhe(aparencia);
  /* A mesma régua da capa (`medidaDaLogo`): a barrinha de tamanho do editor
     vale aqui também. `max-w` segura a logo larga no celular. */
  const medidaLogo = medidaDaLogo(aparencia, proporcaoDaLogo(logoLargura, logoAltura));
  const estiloLogo =
    medidaLogo && "altura" in medidaLogo
      ? { height: `${medidaLogo.altura}px` }
      : { maxHeight: `${medidaLogo?.tetoAltura ?? 0}px` };

  const metaDosVideos = [
    `${episodios.length} ${episodios.length === 1 ? "vídeo" : "vídeos"}`,
    todasComDuracao ? duracaoLegivel(duracaoTotal) : null,
  ].filter((m): m is string => Boolean(m));
  const meta = [dataFormatada, subtitulo, ...metaDosVideos].filter((m): m is string => Boolean(m));

  /*
   * O QUE OS QUATRO DESENHOS DIVIDEM — a "sala". Cada estilo decide onde pôr
   * cada peça; nenhum decide o que ela é. Assim o botão de assistir diz a
   * mesma coisa ("Continuar · E2 · 12:03") em qualquer sala, e a logo segue a
   * mesma régua da capa.
   */
  const sala: Sala = {
    aparencia,
    semCapa: aparencia.capaStream === "galeria",
    grade: aparencia.rolagemStream === "baixo",
    titulo,
    meta,
    metaDosVideos,
    fundo,
    fundoVideo,
    fundoParado: tocando !== null,
    foco: { objectPosition: `${focoX}% ${focoY}%` },
    fileiras,
    episodios,
    progresso,
    continuar,
    alvo: continuar?.ep ?? episodios[0],
    fotos,
    tocar: setTocando,
    letras: {
      titulo: {
        fontFamily: FONTES_TITULO[aparencia.tipografia],
        fontWeight: pesoDoTitulo(aparencia.tipografia, aparencia.peso),
        color: "var(--g-titulo, var(--g-texto))",
      },
      detalhe: {
        className: `uppercase tracking-[0.22em] ${detalhe ? "" : "font-mono"}`,
        style: detalhe ? { fontFamily: detalhe } : {},
      },
    },
    logo:
      medidaLogo && logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
        <img src={logoUrl} alt={estudio} style={estiloLogo} className="w-auto max-w-[55vw] object-contain" />
      ) : (
        <span
          className={`text-[11px] uppercase tracking-[0.24em] ${detalhe ? "" : "font-mono"}`}
          style={{ color: "var(--g-suave)", ...(detalhe ? { fontFamily: detalhe } : {}) }}
        >
          {estudio}
        </span>
      ),
  };

  return (
    <>
      {aparencia.estiloStream === "episodios" ? (
        <SalaEpisodios sala={sala} />
      ) : aparencia.estiloStream === "vitrine" ? (
        <SalaVitrine sala={sala} />
      ) : aparencia.estiloStream === "mostra" ? (
        <SalaMostra sala={sala} />
      ) : (
        <SalaCinema sala={sala} />
      )}

      {tocando && (
        <Player
          key="player"
          galeriaId={galeriaId}
          episodios={episodios}
          fileiraDe={fileiraDe}
          id={tocando}
          trocar={setTocando}
          fechar={() => setTocando(null)}
          permiteDownload={permiteDownload}
          identificadoDeInicio={identificado}
          aoProgresso={(id, marca) =>
            setProgresso((atual) => {
              const novo = { ...atual, [id]: marca };
              gravarProgresso(galeriaId, novo);
              return novo;
            })
          }
          avisar={(t) => {
            setAviso(t);
            window.setTimeout(() => setAviso(null), 3500);
          }}
        />
      )}

      {aviso && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-[var(--g-pilula,9999px)] px-5 py-2.5 text-sm shadow-2xl"
          style={{ background: "var(--g-superficie)", color: "var(--g-texto)", border: "1px solid var(--g-linha)" }}
        >
          {aviso}
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 *  AS QUATRO SALAS
 *
 *  Cada uma na linha de um serviço de streaming que o cliente já sabe usar —
 *  ver `EstiloStream` em `config/aparencia.ts`. O que muda é a ARQUITETURA da
 *  página; letra, logo e cores continuam sendo as da galeria (a Cinema troca
 *  só as cores pela sala escura, na página inteira — `variaveisDaEntrega`).
 * ════════════════════════════════════════════════════════════════════════ */

interface Sala {
  aparencia: Aparencia;
  /** A página já desenhou a capa do grupo Capa: a sala começa no conteúdo. */
  semCapa: boolean;
  /** Tudo em grade, para baixo, em vez de fileiras de lado. */
  grade: boolean;
  titulo: string;
  meta: string[];
  /** Só a quantidade e a duração — o que a barra diz embaixo da capa do grupo Capa. */
  metaDosVideos: string[];
  fundo: string | null;
  /** O clipe da capa em vídeo, ou null. */
  fundoVideo: string | null;
  /** O player está aberto por cima: o clipe da capa não precisa tocar atrás dele. */
  fundoParado: boolean;
  foco: CSSProperties;
  fileiras: FileiraDoStream[];
  episodios: EpisodioDoStream[];
  progresso: Record<string, Marca>;
  continuar: { ep: EpisodioDoStream; marca: Marca } | null;
  /** O que o botão principal toca: onde a pessoa parou, ou o primeiro. */
  alvo: EpisodioDoStream | undefined;
  fotos: { total: number; amostra: string[]; href: string };
  tocar: (id: string) => void;
  letras: { titulo: CSSProperties; detalhe: { className: string; style: CSSProperties } };
  logo: ReactNode;
}

/** O rótulo do botão principal, igual nas quatro salas. */
function RotuloAssistir({ sala }: { sala: Sala }) {
  return sala.continuar ? (
    <span>
      Continuar
      <span className="font-normal opacity-75"> · {relogio(sala.continuar.marca.t)}</span>
    </span>
  ) : (
    <span>Assistir</span>
  );
}

/**
 * O botão de assistir quando a capa é a do grupo Capa (`capaStream: galeria`).
 *
 * A capa da galeria não sabe que existe filme: ela tem "Ver galeria", no
 * máximo. Sem esta barra, a primeira coisa que o cliente veria depois do nome
 * do casal seria uma fileira, e o "continuar de onde parou" sumiria. É o mesmo
 * botão da capa de cada sala, com o que a entrega tem ao lado.
 *
 * `cinema` desenha o botão branco das plataformas de série; as outras salas
 * usam a cor de destaque do tema, como na própria capa delas.
 */
function BarraDeAssistir({ sala, cinema = false, centro = false }: { sala: Sala; cinema?: boolean; centro?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-3 ${centro ? "justify-center text-center" : ""}`}>
      {sala.alvo && (
        <button
          type="button"
          onClick={() => sala.alvo && sala.tocar(sala.alvo.id)}
          className={
            cinema
              ? "inline-flex items-center gap-3 rounded-[min(var(--g-pilula,9999px),0.375rem)] bg-white px-7 py-3 text-base font-semibold text-black transition hover:bg-white/80"
              : "inline-flex items-center gap-2.5 rounded-[var(--g-pilula,9999px)] px-7 py-3 text-sm font-semibold transition hover:opacity-85"
          }
          style={cinema ? undefined : { background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
        >
          <IconePlay className={cinema ? "h-4 w-4" : "h-3.5 w-3.5"} />
          <RotuloAssistir sala={sala} />
        </button>
      )}
      {cinema && sala.fotos.total > 0 && (
        <Link
          href={sala.fotos.href}
          className="inline-flex items-center gap-2 rounded-[min(var(--g-pilula,9999px),0.375rem)] px-6 py-3 text-base font-semibold text-white transition hover:bg-[rgba(109,109,110,.4)]"
          style={{ background: "rgba(109,109,110,.7)" }}
        >
          Ver as fotos
          <span className="font-normal opacity-75">{sala.fotos.total}</span>
        </Link>
      )}
      {/* Só o que a capa não disse: data e local já estão nela, logo acima. */}
      {sala.metaDosVideos.length > 0 && (
        <p className="text-sm" style={{ color: "var(--g-suave)" }}>
          {sala.metaDosVideos.join("  ·  ")}
        </p>
      )}
    </div>
  );
}

/** A frase que o fotógrafo escreveu embaixo do nome da fileira. */
function FraseDaFileira({ frase, className = "" }: { frase: string; className?: string }) {
  return (
    <p className={`max-w-2xl text-sm leading-relaxed ${className}`} style={{ color: "var(--g-suave)" }}>
      {frase}
    </p>
  );
}

function tamanhoDoTitulo(sala: Sala, base: string): string {
  return `calc(${base} * ${sala.aparencia.tamanhoTitulo / 100})`;
}

/* Imagem de episódio ou de fundo. Sem pôster, a cor da superfície segura o
   lugar — nunca o filme num `<img>` (ver `ItemGaleria.temPoster`). */
function Imagem({
  src,
  className = "",
  style,
  prioridade = false,
}: {
  src: string | null | undefined;
  className?: string;
  style?: CSSProperties;
  prioridade?: boolean;
}) {
  if (!src) return <span aria-hidden className={`block ${className}`} style={{ background: "var(--g-superficie)", ...style }} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém, fora do otimizador do Next
    <img
      src={src}
      alt=""
      fetchPriority={prioridade ? "high" : undefined}
      loading={prioridade ? "eager" : "lazy"}
      decoding="async"
      style={style}
      className={`block object-cover ${className}`}
    />
  );
}

/**
 * O CLIPE DA CAPA — vídeo mudo em laço por cima da imagem (08/10/2026).
 *
 * Juan: "adicionar opção de subir capa em VÍDEO no formato Stream". A imagem
 * embaixo é o primeiro quadro do próprio clipe, então nada "pula" quando ele
 * começa; o clipe só se junta a ela depois de montar, porque preferência do
 * navegador não existe no servidor.
 *
 * Quando NÃO toca, e a imagem fica sozinha:
 *   · `prefers-reduced-motion`: movimento de fundo é o caso de livro;
 *   · economia de dados (`saveData`): o clipe é o único peso que a capa tem;
 *   · o clipe falhou em carregar (`onError`);
 *   · fora da tela ou com o player aberto por cima — pausa, e a bateria agradece.
 *
 * `muted` + `playsInline` + `autoPlay` é a combinação que o iPhone e o Chrome
 * aceitam tocar sozinha. Sem som, sem controles, e fora do alcance do teclado.
 */
function ClipeDaCapa({
  src,
  parado,
  className = "",
  style,
}: {
  src: string | null | undefined;
  parado: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const [pode, setPode] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [visivel, setVisivel] = useState(true);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const economia = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       As preferências do navegador só existem depois de montar; ver acima. */
    setPode(!reduzir && !economia);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !pode || typeof IntersectionObserver === "undefined") return;
    const olho = new IntersectionObserver(([e]) => setVisivel(e.isIntersecting), { threshold: 0.05 });
    olho.observe(el);
    return () => olho.disconnect();
  }, [pode, src]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (parado || !visivel) el.pause();
    else void el.play().catch(() => {});
  }, [parado, visivel, pode]);

  if (!src || !pode || falhou) return null;
  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      autoPlay
      playsInline
      preload="auto"
      disablePictureInPicture
      disableRemotePlayback
      aria-hidden
      tabIndex={-1}
      onError={() => setFalhou(true)}
      style={style}
      className={`pointer-events-none block object-cover ${className}`}
    />
  );
}

function BarraVista({ marca, className = "" }: { marca: Marca | undefined; className?: string }) {
  const visto = marca ? fracaoAssistida(marca.t, marca.d) : 0;
  if (visto <= 0) return null;
  return (
    <span aria-hidden className={`absolute inset-x-0 bottom-0 h-[3px] bg-white/25 ${className}`}>
      <span className="block h-full" style={{ width: `${visto * 100}%`, background: "var(--g-destaque)" }} />
    </span>
  );
}

function duracaoDe(ep: EpisodioDoStream, marca: Marca | undefined): string | null {
  return duracaoLegivel(ep.duracao ?? marca?.d);
}

/* ── CINEMA ────────────────────────────────────────────────────────────────
 *
 * A sala das plataformas de série — a que o cliente reconhece sem ler nada.
 *
 *   · capa em tela cheia, texto SEMPRE à esquerda (é assim que ela é lida);
 *   · botão branco com texto preto e o segundo botão cinza translúcido;
 *   · fileiras com o título da fileira em negrito, cartões 16:9 com o nome
 *     SOBRE a imagem, que crescem no hover.
 *
 * As cores vêm da sala escura quando o tema é claro (ver `SALA_ESCURA`); a
 * letra do título e a logo continuam sendo as do fotógrafo.
 */
function SalaCinema({ sala }: { sala: Sala }) {
  /* Na grade o cartão ocupa a coluna; na fileira, a largura fixa que deixa o
     próximo aparecer cortado na borda. */
  const cartao = sala.grade ? "min-w-0" : "w-[72vw] shrink-0 snap-start sm:w-[300px] lg:w-[340px]";
  return (
    <>
      {sala.semCapa ? (
        <div className="px-5 pt-10 sm:px-12 sm:pt-14">
          <BarraDeAssistir sala={sala} cinema />
        </div>
      ) : (
        <header className="relative isolate flex min-h-[88svh] flex-col overflow-hidden">
          <Imagem src={sala.fundo} prioridade style={sala.foco} className="absolute inset-0 -z-10 h-full w-full" />
          <ClipeDaCapa src={sala.fundoVideo} parado={sala.fundoParado} style={sala.foco} className="absolute inset-0 -z-10 h-full w-full" />
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background:
                "linear-gradient(to top, var(--g-fundo) 2%, color-mix(in srgb, var(--g-fundo) 55%, transparent) 30%, transparent 60%), linear-gradient(to right, color-mix(in srgb, var(--g-fundo) 80%, transparent) 0%, color-mix(in srgb, var(--g-fundo) 25%, transparent) 45%, transparent 70%)",
            }}
          />
          <div className="px-5 pt-6 sm:px-12 sm:pt-8">{sala.logo}</div>
          <div className="mt-auto w-full max-w-2xl px-5 pb-12 sm:px-12 sm:pb-20">
            {sala.aparencia.rotulo && (
              <span className={`block text-[11px] ${sala.letras.detalhe.className}`} style={{ color: "var(--g-suave)", ...sala.letras.detalhe.style }}>
                {sala.aparencia.rotulo}
              </span>
            )}
            <h1
              className="mt-3 text-balance leading-[0.92]"
              style={{ ...sala.letras.titulo, fontSize: tamanhoDoTitulo(sala, "clamp(2.6rem, 7.5vw, 6rem)") }}
            >
              {sala.titulo}
            </h1>
            {sala.meta.length > 0 && (
              <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" style={{ color: "var(--g-suave)" }}>
                {sala.meta.map((m, i) => (
                  <span key={i} className="flex items-center gap-3">
                    {i > 0 && <span aria-hidden className="h-1 w-1 rounded-full bg-current opacity-60" />}
                    {m}
                  </span>
                ))}
              </p>
            )}
            <div className="mt-7 flex flex-wrap gap-3">
              {sala.alvo && (
                <button
                  type="button"
                  onClick={() => sala.alvo && sala.tocar(sala.alvo.id)}
                  className="inline-flex items-center gap-3 rounded-[min(var(--g-pilula,9999px),0.375rem)] bg-white px-7 py-3 text-base font-semibold text-black transition hover:bg-white/80"
                >
                  <IconePlay className="h-4 w-4" />
                  <RotuloAssistir sala={sala} />
                </button>
              )}
              {sala.fotos.total > 0 && (
                <Link
                  href={sala.fotos.href}
                  className="inline-flex items-center gap-2 rounded-[min(var(--g-pilula,9999px),0.375rem)] px-6 py-3 text-base font-semibold text-white transition hover:bg-[rgba(109,109,110,.4)]"
                  style={{ background: "rgba(109,109,110,.7)" }}
                >
                  Ver as fotos
                  <span className="font-normal opacity-75">{sala.fotos.total}</span>
                </Link>
              )}
            </div>
          </div>
        </header>
      )}

      <div className={`relative z-10 space-y-10 pb-8 sm:space-y-12 ${sala.semCapa ? "pt-6" : "-mt-6 sm:-mt-12"}`}>
        {sala.fileiras.map((f) => (
          <Fileira key={f.id} titulo={f.nome} frase={f.frase} forte grade={sala.grade}>
            {f.episodios.map((ep) => (
              <li key={ep.id} className={cartao}>
                <button
                  type="button"
                  onClick={() => sala.tocar(ep.id)}
                  className="group relative block aspect-video w-full origin-center overflow-hidden rounded-[min(var(--g-canto,6px),0.375rem)] text-left transition duration-300 hover:z-10 hover:scale-[1.06] hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,.8)] focus-visible:scale-[1.06] motion-reduce:transition-none"
                  style={{ background: "var(--g-superficie)" }}
                >
                  <Imagem src={ep.poster} className="h-full w-full" />
                  <span
                    aria-hidden
                    className="absolute inset-0"
                    style={{ background: "linear-gradient(to top, rgba(0,0,0,.8) 0%, rgba(0,0,0,.2) 45%, transparent 70%)" }}
                  />
                  <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 text-white">
                    <span className="block min-w-0 truncate text-[15px] font-semibold">{ep.titulo}</span>
                    {duracaoDe(ep, sala.progresso[ep.id]) && (
                      <span className="shrink-0 text-[11px] tabular-nums text-white/75">{duracaoDe(ep, sala.progresso[ep.id])}</span>
                    )}
                  </span>
                  <span
                    aria-hidden
                    className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white text-black opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    <IconePlay className="ml-0.5 h-3 w-3" />
                  </span>
                  <BarraVista marca={sala.progresso[ep.id]} />
                </button>
              </li>
            ))}
          </Fileira>
        ))}
        <FileiraDeFotos sala={sala} forte />
      </div>
    </>
  );
}

/* ── EPISÓDIOS ─────────────────────────────────────────────────────────────
 *
 * A página de uma série. Em cima, a capa DIVIDIDA — a imagem de um lado com
 * o play no meio, o título e os botões do outro. Embaixo, os capítulos como
 * temporadas, em abas, e a lista de episódios um embaixo do outro: número,
 * imagem, nome, duração e quanto já foi visto.
 *
 * É a sala para quem entrega poucos filmes longos: lista se lê, fileira se
 * passa o olho. E é a que mais respeita o tema — no claro fica claro.
 */
function SalaEpisodios({ sala }: { sala: Sala }) {
  const [aba, setAba] = useState(0);
  const fileira = sala.fileiras[Math.min(aba, sala.fileiras.length - 1)];
  const centro = sala.aparencia.alinhamento === "centro";
  return (
    <div className={`mx-auto max-w-6xl px-5 pb-10 sm:px-8 ${sala.semCapa ? "pt-10 sm:pt-14" : "pt-6 sm:pt-8"}`}>
      {sala.semCapa ? (
        <BarraDeAssistir sala={sala} centro={centro} />
      ) : (
        <>
          <div className={centro ? "flex justify-center" : ""}>{sala.logo}</div>

          <header className="mt-8 grid items-center gap-8 md:mt-12 md:grid-cols-[1.2fr_1fr] md:gap-12">
            <button
              type="button"
              onClick={() => sala.alvo && sala.tocar(sala.alvo.id)}
              aria-label="Assistir"
              className="group relative block aspect-video overflow-hidden rounded-[var(--g-canto,6px)]"
              style={{ background: "var(--g-superficie)" }}
            >
              <Imagem src={sala.fundo} prioridade style={sala.foco} className="h-full w-full transition duration-700 group-hover:scale-[1.03] motion-reduce:transition-none" />
              <ClipeDaCapa src={sala.fundoVideo} parado={sala.fundoParado} style={sala.foco} className="absolute inset-0 h-full w-full" />
              <span aria-hidden className="absolute inset-0 grid place-items-center bg-black/10 transition group-hover:bg-black/25">
                <span className="grid h-16 w-16 place-items-center rounded-full bg-white/90 text-black shadow-xl transition group-hover:scale-110 motion-reduce:transition-none">
                  <IconePlay className="ml-1 h-5 w-5" />
                </span>
              </span>
            </button>
            <div className={centro ? "text-center" : ""}>
              {sala.aparencia.rotulo && (
                <span className={`block text-[11px] ${sala.letras.detalhe.className}`} style={{ color: "var(--g-suave)", ...sala.letras.detalhe.style }}>
                  {sala.aparencia.rotulo}
                </span>
              )}
              <h1 className="mt-3 text-balance leading-[0.98]" style={{ ...sala.letras.titulo, fontSize: tamanhoDoTitulo(sala, "clamp(2.2rem, 5vw, 4.25rem)") }}>
                {sala.titulo}
              </h1>
              {sala.meta.length > 0 && (
                <p className="mt-4 text-sm" style={{ color: "var(--g-suave)" }}>
                  {sala.meta.join("  ·  ")}
                </p>
              )}
              <div className={`mt-6 flex flex-wrap gap-3 ${centro ? "justify-center" : ""}`}>
                {sala.alvo && (
                  <button
                    type="button"
                    onClick={() => sala.alvo && sala.tocar(sala.alvo.id)}
                    className="inline-flex items-center gap-2.5 rounded-[var(--g-pilula,9999px)] px-7 py-3 text-sm font-semibold transition hover:opacity-85"
                    style={{ background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
                  >
                    <IconePlay className="h-3.5 w-3.5" />
                    <RotuloAssistir sala={sala} />
                  </button>
                )}
              </div>
            </div>
          </header>
        </>
      )}

      {sala.grade ? (
        /* PARA BAIXO: todas as temporadas abertas, uma embaixo da outra, em
           vez das abas. Quem entrega três capítulos de filme não precisa
           esconder dois atrás de um clique. */
        <>
          {sala.fileiras.map((f) => (
            <section key={f.id} className="mt-12 sm:mt-16">
              <h2 className="border-b pb-3 text-lg font-medium sm:text-xl" style={{ borderColor: "var(--g-linha)", color: "var(--g-texto)" }}>
                {f.nome}
                <span className="ml-2 text-xs font-normal" style={{ color: "var(--g-tenue)" }}>{f.episodios.length}</span>
              </h2>
              {f.frase && <FraseDaFileira frase={f.frase} className="mt-3" />}
              <ListaDeEpisodios sala={sala} episodios={f.episodios} />
            </section>
          ))}
          {sala.fotos.total > 0 && (
            <Link
              href={sala.fotos.href}
              className="mt-12 flex items-baseline justify-between gap-4 border-b pb-3 text-lg font-medium transition hover:opacity-70 sm:mt-16 sm:text-xl"
              style={{ borderColor: "var(--g-linha)", color: "var(--g-texto)" }}
            >
              Fotos
              <span className="text-sm font-normal" style={{ color: "var(--g-suave)" }}>
                ver todas ({sala.fotos.total}) →
              </span>
            </Link>
          )}
        </>
      ) : (
        <>
          {/* As abas: cada capítulo é uma temporada, e as fotos são a última. */}
          <nav
            aria-label="Temporadas"
            className="fileira-sem-barra mt-12 flex gap-6 overflow-x-auto border-b sm:mt-16 sm:gap-8"
            style={{ borderColor: "var(--g-linha)" }}
          >
            {sala.fileiras.map((f, i) => {
              const ativa = f === fileira;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setAba(i)}
                  aria-current={ativa ? "true" : undefined}
                  className="-mb-px shrink-0 border-b-2 pb-3 text-sm font-medium transition sm:text-base"
                  style={{
                    borderColor: ativa ? "var(--g-texto)" : "transparent",
                    color: ativa ? "var(--g-texto)" : "var(--g-tenue)",
                  }}
                >
                  {f.nome}
                  <span className="ml-1.5 text-xs font-normal opacity-70">{f.episodios.length}</span>
                </button>
              );
            })}
            {sala.fotos.total > 0 && (
              <Link
                href={sala.fotos.href}
                className="-mb-px shrink-0 border-b-2 border-transparent pb-3 text-sm font-medium transition hover:opacity-70 sm:text-base"
                style={{ color: "var(--g-tenue)" }}
              >
                Fotos
                <span className="ml-1.5 text-xs font-normal opacity-70">{sala.fotos.total}</span>
              </Link>
            )}
          </nav>

          {fileira?.frase && <FraseDaFileira frase={fileira.frase} className="mt-5" />}
          <ListaDeEpisodios sala={sala} episodios={fileira?.episodios ?? []} />
        </>
      )}
    </div>
  );
}

/** A lista de episódios da sala Episódios — numa aba, ou em cada capítulo aberto. */
function ListaDeEpisodios({ sala, episodios }: { sala: Sala; episodios: EpisodioDoStream[] }) {
  return (
    <ol>
      {episodios.map((ep) => {
        const marca = sala.progresso[ep.id];
        const retomar = marca ? pontoDeRetomada(marca.t, marca.d) : 0;
        return (
          <li key={ep.id} className="border-b" style={{ borderColor: "var(--g-linha)" }}>
            <button
              type="button"
              onClick={() => sala.tocar(ep.id)}
              className="group grid w-full grid-cols-[auto_1fr] items-center gap-4 rounded-[var(--g-canto,6px)] px-1 py-5 text-left transition hover:bg-[var(--g-superficie)] sm:grid-cols-[2.5rem_auto_1fr] sm:gap-6 sm:px-3"
            >
              <span className="hidden text-2xl tabular-nums sm:block" style={{ ...sala.letras.titulo, color: "var(--g-tenue)" }}>
                {ep.numero}
              </span>
              <span className="relative block aspect-video w-36 overflow-hidden rounded-[var(--g-canto,6px)] sm:w-56" style={{ background: "var(--g-superficie)" }}>
                <Imagem src={ep.poster} className="h-full w-full" />
                <span aria-hidden className="absolute inset-0 grid place-items-center bg-black/0 transition group-hover:bg-black/30">
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-white/80 text-white opacity-0 transition group-hover:opacity-100">
                    <IconePlay className="ml-0.5 h-3.5 w-3.5" />
                  </span>
                </span>
                <BarraVista marca={marca} />
              </span>
              <span className="min-w-0">
                {/* No celular o nome quebra em até duas linhas e a duração
                    desce para a linha de baixo: dividindo a linha com ela, o
                    nome era cortado na terceira palavra. */}
                <span className="flex items-baseline justify-between gap-3">
                  <span className="line-clamp-2 text-[15px] font-medium leading-snug sm:line-clamp-1 sm:text-lg" style={{ color: "var(--g-texto)" }}>
                    <span className="sm:hidden" style={{ color: "var(--g-tenue)" }}>{ep.numero}. </span>
                    {ep.titulo}
                  </span>
                  {duracaoDe(ep, marca) && (
                    <span className="hidden shrink-0 text-sm tabular-nums sm:inline" style={{ color: "var(--g-suave)" }}>
                      {duracaoDe(ep, marca)}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs" style={{ color: "var(--g-tenue)" }}>
                  {duracaoDe(ep, marca) && <span className="sm:hidden">{duracaoDe(ep, marca)} · </span>}
                  {retomar > 0 ? `Continuar de ${relogio(retomar)}` : tamanho(ep.bytes)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ── VITRINE ───────────────────────────────────────────────────────────────
 *
 * A linha das lojas de filme mais limpas: muito respiro, cartões grandes e
 * arredondados, sombra macia e nada de tela cheia. O título abre a página
 * como manchete; o filme principal vem num cartão grande, largo, com o play
 * branco; os outros em cartões largos de duas ou três colunas, com o nome
 * EMBAIXO da imagem.
 *
 * Segue o tema por inteiro — no claro é branca e calma, que é justamente o
 * que a separa da Cinema. O arredondado é o dobro do canto da galeria: quem
 * escolheu canto vivo continua no canto vivo.
 */
function SalaVitrine({ sala }: { sala: Sala }) {
  const destaque = sala.alvo;
  const centro = sala.aparencia.alinhamento === "centro";
  const RAIO = "rounded-[calc(var(--g-canto,6px)*2)]";
  const SOMBRA = "shadow-[0_24px_60px_-28px_rgba(0,0,0,.45)]";
  return (
    <div className={`mx-auto max-w-7xl px-5 pb-10 sm:px-8 ${sala.semCapa ? "pt-4 sm:pt-6" : "pt-6 sm:pt-8"}`}>
      {!sala.semCapa && (
        <>
          <div className={centro ? "flex justify-center" : ""}>{sala.logo}</div>

          <header className={`mt-10 sm:mt-14 ${centro ? "text-center" : ""}`}>
            {sala.aparencia.rotulo && (
              <span className={`block text-[11px] ${sala.letras.detalhe.className}`} style={{ color: "var(--g-suave)", ...sala.letras.detalhe.style }}>
                {sala.aparencia.rotulo}
              </span>
            )}
            <h1 className="mt-2 text-balance leading-[0.98]" style={{ ...sala.letras.titulo, fontSize: tamanhoDoTitulo(sala, "clamp(2.4rem, 6vw, 5rem)") }}>
              {sala.titulo}
            </h1>
            {sala.meta.length > 0 && (
              <p className="mt-3 text-sm" style={{ color: "var(--g-suave)" }}>
                {sala.meta.join("  ·  ")}
              </p>
            )}
          </header>
        </>
      )}

      {destaque && (
        <button
          type="button"
          onClick={() => sala.tocar(destaque.id)}
          className={`group relative mt-8 block aspect-[4/5] w-full overflow-hidden text-left sm:mt-10 sm:aspect-[16/8] ${RAIO} ${SOMBRA}`}
          style={{ background: "var(--g-superficie)" }}
        >
          {/* Com a capa do grupo Capa logo acima, o destaque mostra o próprio
              filme: repetir a foto da capa seriam duas iguais seguidas. */}
          <Imagem
            src={sala.semCapa ? destaque.poster : (sala.fundo ?? destaque.poster)}
            prioridade
            style={sala.fundo && !sala.semCapa ? sala.foco : undefined}
            className="absolute inset-0 h-full w-full transition duration-[1200ms] group-hover:scale-[1.03] motion-reduce:transition-none"
          />
          {!sala.semCapa && (
            <ClipeDaCapa src={sala.fundoVideo} parado={sala.fundoParado} style={sala.foco} className="absolute inset-0 h-full w-full" />
          )}
          <span aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,.7), rgba(0,0,0,.1) 50%, transparent 70%)" }} />
          <span className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-4 p-6 text-white sm:p-10">
            <span className="min-w-0">
              <span className="block text-xs font-medium uppercase tracking-[0.18em] text-white/70">
                {sala.continuar ? "Continuar assistindo" : "Em destaque"}
              </span>
              <span className="mt-2 block text-2xl font-semibold sm:text-4xl">{destaque.titulo}</span>
              <span className="mt-1 block text-sm text-white/75">
                {[sala.fileiras.find((f) => f.episodios.includes(destaque))?.nome, duracaoDe(destaque, sala.progresso[destaque.id])]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span className="inline-flex items-center gap-2.5 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition group-hover:scale-105 motion-reduce:transition-none">
              <IconePlay className="h-3.5 w-3.5" />
              <RotuloAssistir sala={sala} />
            </span>
          </span>
          <BarraVista marca={sala.progresso[destaque.id]} className="h-1" />
        </button>
      )}

      {sala.fileiras.map((f) => (
        <section key={f.id} className="mt-14 sm:mt-16">
          <h2 className="text-xl font-semibold sm:text-2xl" style={{ color: "var(--g-texto)" }}>
            {f.nome}
          </h2>
          {f.frase && <FraseDaFileira frase={f.frase} className="mt-1.5" />}
          <ul className="mt-5 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {f.episodios.map((ep) => (
              <li key={ep.id}>
                <button type="button" onClick={() => sala.tocar(ep.id)} className="group block w-full text-left">
                  <span className={`relative block aspect-video overflow-hidden ${RAIO} ${SOMBRA} transition duration-500 group-hover:-translate-y-1 motion-reduce:transition-none`} style={{ background: "var(--g-superficie)" }}>
                    <Imagem src={ep.poster} className="h-full w-full" />
                    <span aria-hidden className="absolute bottom-3 right-3 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-black opacity-0 shadow-lg transition group-hover:opacity-100">
                      <IconePlay className="ml-0.5 h-3.5 w-3.5" />
                    </span>
                    <BarraVista marca={sala.progresso[ep.id]} />
                  </span>
                  <span className="mt-3 block truncate text-base font-medium" style={{ color: "var(--g-texto)" }}>
                    {ep.titulo}
                  </span>
                  <span className="mt-0.5 block text-sm" style={{ color: "var(--g-suave)" }}>
                    {duracaoDe(ep, sala.progresso[ep.id]) ?? "\u00a0"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {sala.fotos.amostra.length > 0 && (
        <section className="mt-14 sm:mt-16">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-semibold sm:text-2xl" style={{ color: "var(--g-texto)" }}>
              Fotos
            </h2>
            <Link href={sala.fotos.href} className="text-sm font-medium transition hover:opacity-70" style={{ color: "var(--g-suave)" }}>
              Ver todas as {sala.fotos.total} →
            </Link>
          </div>
          <Link href={sala.fotos.href} className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-6" aria-label={`Ver as ${sala.fotos.total} fotos`}>
            {sala.fotos.amostra.slice(0, 6).map((src, i) => (
              <span key={i} className={`block aspect-square overflow-hidden ${RAIO}`}>
                <Imagem src={src} className="h-full w-full transition duration-500 hover:scale-105 motion-reduce:transition-none" />
              </span>
            ))}
          </Link>
        </section>
      )}
    </div>
  );
}

/* ── MOSTRA ────────────────────────────────────────────────────────────────
 *
 * O programa de um festival de cinema. O título da entrega abre a página
 * enorme, e cada filme é uma LINHA do programa: número, o nome grande na
 * letra da galeria, a duração na margem. A imagem não ocupa a página — ela
 * aparece ao passar o mouse, flutuando junto do cursor, como nos sites de
 * mostra. É a sala mais tipográfica, e a que mais muda com a fonte escolhida.
 *
 * Em tela de toque não há mouse para seguir: ali cada linha mostra a própria
 * imagem pequena, à esquerda. A escolha é por `hover:hover`, e não por
 * largura, porque é isso que decide se existe cursor.
 */
function SalaMostra({ sala }: { sala: Sala }) {
  const [flutua, setFlutua] = useState<{ src: string; x: number; y: number } | null>(null);
  const centro = sala.aparencia.alinhamento === "centro";
  return (
    <div className={`mx-auto max-w-6xl px-5 pb-10 sm:px-8 ${sala.semCapa ? "pt-10 sm:pt-14" : "pt-6 sm:pt-8"}`}>
      {sala.semCapa ? (
        <div className="border-b pb-8" style={{ borderColor: "var(--g-texto)" }}>
          <BarraDeAssistir sala={sala} centro={centro} />
        </div>
      ) : (
        <>
          <div className={`flex items-center justify-between gap-4 ${centro ? "flex-col" : ""}`}>
            {sala.logo}
            {sala.aparencia.rotulo && (
              <span className={`text-[11px] ${sala.letras.detalhe.className}`} style={{ color: "var(--g-suave)", ...sala.letras.detalhe.style }}>
                {sala.aparencia.rotulo}
              </span>
            )}
          </div>

          <header className={`mt-14 border-b pb-8 sm:mt-20 sm:pb-10 ${centro ? "text-center" : ""}`} style={{ borderColor: "var(--g-texto)" }}>
            <h1 className="text-balance leading-[0.9]" style={{ ...sala.letras.titulo, fontSize: tamanhoDoTitulo(sala, "clamp(3rem, 10vw, 8.5rem)") }}>
              {sala.titulo}
            </h1>
            <div className={`mt-6 flex flex-wrap items-end gap-x-8 gap-y-4 ${centro ? "justify-center" : "justify-between"}`}>
              {sala.meta.length > 0 && (
                <p className={`text-[11px] ${sala.letras.detalhe.className}`} style={{ color: "var(--g-suave)", ...sala.letras.detalhe.style }}>
                  {sala.meta.join("  /  ")}
                </p>
              )}
              {sala.alvo && (
                <button
                  type="button"
                  onClick={() => sala.alvo && sala.tocar(sala.alvo.id)}
                  className="inline-flex items-center gap-2.5 border-b pb-1 text-sm font-medium transition hover:opacity-70"
                  style={{ borderColor: "currentColor", color: "var(--g-texto)" }}
                >
                  <IconePlay className="h-3 w-3" />
                  <RotuloAssistir sala={sala} />
                </button>
              )}
            </div>
          </header>
        </>
      )}

      <div onMouseLeave={() => setFlutua(null)}>
        {sala.fileiras.map((f) => (
          <section key={f.id} className="mt-12 sm:mt-16">
            <h2 className={`text-[11px] ${sala.letras.detalhe.className}`} style={{ color: "var(--g-tenue)", ...sala.letras.detalhe.style }}>
              {f.nome}
            </h2>
            {f.frase && <FraseDaFileira frase={f.frase} className="mt-2" />}
            <ol className="mt-3">
              {f.episodios.map((ep) => (
                <li key={ep.id} className="border-b" style={{ borderColor: "var(--g-linha)" }}>
                  <button
                    type="button"
                    onClick={() => sala.tocar(ep.id)}
                    onMouseMove={(e) => ep.poster && setFlutua({ src: ep.poster, x: e.clientX, y: e.clientY })}
                    className="group grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-4 py-5 text-left sm:gap-8 sm:py-7"
                  >
                    <span className="font-mono text-xs tabular-nums" style={{ color: "var(--g-tenue)" }}>
                      {String(ep.numero).padStart(2, "0")}
                    </span>
                    <span className="flex min-w-0 items-center gap-4">
                      {ep.poster && (
                        <span className="block aspect-video w-24 shrink-0 self-center overflow-hidden rounded-[var(--g-canto,6px)] [@media(hover:hover)]:hidden">
                          <Imagem src={ep.poster} className="h-full w-full" />
                        </span>
                      )}
                      <span
                        className="min-w-0 text-balance text-[1.7rem] leading-[1.05] transition duration-300 group-hover:translate-x-2 group-hover:italic sm:text-5xl motion-reduce:transition-none"
                        style={{ ...sala.letras.titulo, color: "var(--g-texto)" }}
                      >
                        {ep.titulo}
                      </span>
                    </span>
                    <span className="text-right text-xs tabular-nums sm:text-sm" style={{ color: "var(--g-suave)" }}>
                      {duracaoDe(ep, sala.progresso[ep.id]) ?? ""}
                      {sala.progresso[ep.id] && fracaoAssistida(sala.progresso[ep.id].t, sala.progresso[ep.id].d) > 0 && (
                        <span className="mt-1 block text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--g-tenue)" }}>
                          {Math.round(fracaoAssistida(sala.progresso[ep.id].t, sala.progresso[ep.id].d) * 100)}% visto
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ))}

        {sala.fotos.total > 0 && (
          <section className="mt-12 sm:mt-16">
            <h2 className={`text-[11px] ${sala.letras.detalhe.className}`} style={{ color: "var(--g-tenue)", ...sala.letras.detalhe.style }}>
              Fotos
            </h2>
            <Link
              href={sala.fotos.href}
              onMouseMove={(e) => sala.fotos.amostra[0] && setFlutua({ src: sala.fotos.amostra[0], x: e.clientX, y: e.clientY })}
              className="group mt-3 flex items-baseline justify-between gap-6 border-b py-5 sm:py-7"
              style={{ borderColor: "var(--g-linha)" }}
            >
              <span
                className="text-[1.7rem] leading-none transition duration-300 group-hover:translate-x-2 group-hover:italic sm:text-5xl motion-reduce:transition-none"
                style={{ ...sala.letras.titulo, color: "var(--g-texto)" }}
              >
                As fotos
              </span>
              <span className="text-sm tabular-nums" style={{ color: "var(--g-suave)" }}>
                {sala.fotos.total} →
              </span>
            </Link>
          </section>
        )}
      </div>

      {/* A imagem que segue o cursor. `pointer-events-none` para nunca roubar
          o clique da linha que está embaixo dela. */}
      {flutua && (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
        <img
          src={flutua.src}
          alt=""
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-40 hidden aspect-video w-[340px] rounded-[var(--g-canto,6px)] object-cover shadow-2xl transition-transform duration-150 ease-out [@media(hover:hover)]:block motion-reduce:transition-none"
          /* Sempre à DIREITA dos títulos: seguindo o cursor ao pé da letra, a
             imagem cobria o nome que a pessoa estava lendo. Anda na altura do
             cursor e só avança para a direita dele — nunca para cima do texto. */
          style={{
            transform: `translate(${Math.min(
              Math.max(flutua.x + 48, (typeof window === "undefined" ? 1440 : window.innerWidth) * 0.56),
              (typeof window === "undefined" ? 1440 : window.innerWidth) - 364,
            )}px, ${flutua.y - 96}px)`,
          }}
        />
      )}
    </div>
  );
}

/** As fotos como a última fileira — Cinema. */
function FileiraDeFotos({ sala, forte = false }: { sala: Sala; forte?: boolean }) {
  if (sala.fotos.amostra.length === 0) return null;
  return (
    <Fileira
      titulo="Fotos"
      forte={forte}
      grade={sala.grade}
      /* Em grade as fotos são menores que os filmes: mais colunas. */
      colunas="grid-cols-3 sm:grid-cols-4 lg:grid-cols-6"
      extra={
        <Link href={sala.fotos.href} className="text-sm transition hover:opacity-70" style={{ color: "var(--g-suave)" }}>
          ver todas ({sala.fotos.total}) →
        </Link>
      }
    >
      {sala.fotos.amostra.map((src, i) => (
        <li key={i} className={sala.grade ? "min-w-0" : "w-[42vw] shrink-0 snap-start sm:w-[220px]"}>
          <Link
            href={sala.fotos.href}
            className="block aspect-[4/5] overflow-hidden rounded-[min(var(--g-canto,6px),0.375rem)]"
            style={{ background: "var(--g-superficie)" }}
            aria-label={i === 0 ? `Ver as ${sala.fotos.total} fotos` : undefined}
            tabIndex={i === 0 ? 0 : -1}
          >
            <Imagem src={src} className="h-full w-full transition duration-500 hover:scale-[1.04] motion-reduce:transition-none" />
          </Link>
        </li>
      ))}
    </Fileira>
  );
}

function IconePlay({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 14" aria-hidden className={className} fill="currentColor">
      <path d="M0 0.8v12.4c0 .6.7 1 1.2.6l10.2-6.2c.5-.3.5-1 0-1.3L1.2.2C.7-.1 0 .2 0 .8z" />
    </svg>
  );
}

/**
 * Uma fileira: título e uma faixa que rola de lado.
 *
 * No toque, a faixa rola com o dedo e o cartão seguinte aparece cortado na
 * borda — é o que diz "tem mais para o lado" sem seta nenhuma. No computador
 * as setas aparecem no hover da fileira e andam uma tela de cada vez.
 */
function Fileira({
  titulo,
  frase,
  forte = false,
  grade = false,
  colunas = "sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4",
  extra,
  children,
}: {
  titulo: string;
  /** A frase embaixo do título, quando o fotógrafo escreveu uma. */
  frase?: string;
  /** O título da fileira em negrito, grande — o da sala Cinema. */
  forte?: boolean;
  /** Para baixo: tudo à mostra em grade, sem rolar de lado. Ver `RolagemDoStream`. */
  grade?: boolean;
  /** As colunas da grade, por largura de tela. */
  colunas?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const faixa = useRef<HTMLUListElement>(null);
  const [pontas, setPontas] = useState({ inicio: true, fim: false });

  const medir = useCallback(() => {
    const el = faixa.current;
    if (!el) return;
    setPontas({
      inicio: el.scrollLeft < 8,
      fim: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8,
    });
  }, []);

  useEffect(() => {
    medir();
    const el = faixa.current;
    if (!el) return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [medir]);

  const andar = (lado: 1 | -1) => {
    const el = faixa.current;
    if (el) el.scrollBy({ left: lado * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section className="group/fileira relative">
      <div className="flex items-baseline justify-between gap-4 px-5 sm:px-12">
        <h2
          className={forte ? "text-lg font-semibold sm:text-xl" : "text-[11px] uppercase tracking-[0.22em]"}
          style={{ color: forte ? "var(--g-texto)" : "var(--g-suave)" }}
        >
          {titulo}
        </h2>
        {extra}
      </div>
      {frase && <FraseDaFileira frase={frase} className="mt-1 px-5 sm:px-12" />}
      {grade ? (
        <ul className={`mt-3 grid gap-x-3 gap-y-5 px-5 py-4 sm:gap-x-4 sm:px-12 ${colunas}`}>{children}</ul>
      ) : (
        <>
          <ul
            ref={faixa}
            onScroll={medir}
            className="fileira-sem-barra mt-3 flex snap-x snap-mandatory scroll-px-5 gap-2 overflow-x-auto px-5 py-4 sm:scroll-px-12 sm:gap-3 sm:px-12"
          >
            {children}
          </ul>
          {(["inicio", "fim"] as const).map((ponta) =>
            pontas[ponta] ? null : (
              <button
                key={ponta}
                type="button"
                aria-label={ponta === "inicio" ? "Voltar a fileira" : "Avançar a fileira"}
                onClick={() => andar(ponta === "inicio" ? -1 : 1)}
                className={`absolute top-1/2 z-10 hidden h-12 w-12 place-items-center rounded-full text-lg opacity-0 shadow-xl transition group-hover/fileira:opacity-100 focus-visible:opacity-100 md:grid ${
                  ponta === "inicio" ? "left-3" : "right-3"
                }`}
                style={{ background: "var(--g-superficie)", color: "var(--g-texto)", border: "1px solid var(--g-linha)" }}
              >
                {ponta === "inicio" ? "‹" : "›"}
              </button>
            ),
          )}
        </>
      )}
    </section>
  );
}

/**
 * O PLAYER — tela cheia, o filme, e o próximo episódio chegando sozinho.
 *
 * O endereço do filme é pedido à rota `urls` na hora do play, como faz o
 * visualizador de fotos: o HTML da página nunca carrega link de original, e a
 * régua de acesso (senha, prazo, estúdio no ar) é conferida de novo aqui.
 * O `tipo: "preview"` devolve o próprio filme — vídeo não tem derivada de
 * preview, por desenho (ver `Derivadas.preview`).
 */
function Player({
  galeriaId,
  episodios,
  fileiraDe,
  id,
  trocar,
  fechar,
  permiteDownload,
  identificadoDeInicio,
  aoProgresso,
  avisar,
}: {
  galeriaId: string;
  episodios: EpisodioDoStream[];
  fileiraDe: Map<string, string>;
  id: string;
  trocar: (id: string) => void;
  fechar: () => void;
  permiteDownload: boolean;
  identificadoDeInicio: boolean;
  aoProgresso: (id: string, marca: Marca) => void;
  avisar: (texto: string) => void;
}) {
  const indice = episodios.findIndex((e) => e.id === id);
  const ep = episodios[indice];
  const proximo = episodios[indice + 1] ?? null;
  const anterior = episodios[indice - 1] ?? null;

  const [src, setSrc] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [contagem, setContagem] = useState<number | null>(null);
  const [identificado, setIdentificado] = useState(identificadoDeInicio);
  const [pedindoNome, setPedindoNome] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const tela = useRef<HTMLDivElement>(null);
  const ultimoGravado = useRef(0);
  const registrouPlay = useRef(false);

  /*
   * ── OS CONTROLES SÃO NOSSOS (30/09/2026) ──────────────────────────────
   *
   * Juan, testando no iPhone: "o layout dos vídeos tá bugado, não aparece os
   * menus de botão e dá o start sozinho. Não consigo diminuir o volume do
   * áudio também."
   *
   * Eram os controles nativos num `<video>` do tamanho da tela inteira. No
   * iPhone o Safari desenha a barra dele no pé do ELEMENTO — embaixo da
   * barra do navegador, longe da imagem, que fica no meio com faixas pretas —
   * e a esconde enquanto toca. E os controles nativos do iPhone não têm
   * volume nenhum: lá o volume é só o botão do aparelho.
   *
   * Agora a barra é desenhada aqui: play, tempo, a linha do filme, som, tela
   * cheia. Aparece parada, some sozinha 3 s depois de o filme andar sem
   * ninguém mexer, e volta ao toque ou ao mouse. A tela mede `100dvh`, então
   * o pé fica acima da barra do Safari.
   *
   * VOLUME: o slider só aparece onde o navegador obedece a ele. No iPhone
   * `video.volume` é somente leitura (regra da Apple, não nossa), e um slider
   * que não faz nada é pior que nenhum — lá fica o botão de mudo, que
   * funciona, e o volume do aparelho.
   *
   * NÃO COMEÇA SOZINHO ao abrir: o filme abre parado no pôster, com o play
   * grande no meio. Começa sozinho só o PRÓXIMO episódio, quando a pessoa já
   * estava assistindo e deixou a contagem correr (ou apertou "Assistir agora").
   */
  const [rodando, setRodando] = useState(false);
  const [tempo, setTempo] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [mudo, setMudo] = useState(false);
  const [volume, setVolume] = useState(1);
  const [esperando, setEsperando] = useState(false);
  const [visiveis, setVisiveis] = useState(true);
  const [volumeObedece, setVolumeObedece] = useState(false);
  const seguirTocando = useRef(false);
  const esconder = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimoToque = useRef<string>("mouse");
  /* O filme que não abre, ou não anda, diz isso — ver `aviso-do-video`. */
  const saude = useSaudeDoVideo(id);

  /* O navegador deixa mudar o volume? No iPhone, não — ver acima. */
  useEffect(() => {
    const teste = document.createElement("video");
    teste.volume = 0.5;
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Pergunta ao navegador, que só existe depois de montar. */
    setVolumeObedece(teste.volume === 0.5);
  }, []);

  const mostrarControles = useCallback(() => {
    setVisiveis(true);
    if (esconder.current) clearTimeout(esconder.current);
    esconder.current = setTimeout(() => {
      if (video.current && !video.current.paused) setVisiveis(false);
    }, 3000);
  }, []);
  useEffect(() => () => void (esconder.current && clearTimeout(esconder.current)), []);

  const alternar = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
    mostrarControles();
  }, [mostrarControles]);

  const andarNoFilme = useCallback(
    (segundos: number) => {
      const v = video.current;
      if (!v || !Number.isFinite(v.duration)) return;
      v.currentTime = Math.min(Math.max(0, v.currentTime + segundos), v.duration);
      mostrarControles();
    },
    [mostrarControles],
  );

  const telaCheia = useCallback(() => {
    const el = tela.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    /* iPhone não põe um elemento qualquer em tela cheia, só o vídeo — e com
       os controles da Apple, que lá são os certos. */
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
    else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else v?.webkitEnterFullscreen?.();
  }, []);

  /* O endereço do filme, pedido a cada episódio. */
  useEffect(() => {
    let vivo = true;
    /* eslint-disable react-hooks/set-state-in-effect --
       Trocar de episódio zera a tela do anterior antes de o novo endereço
       chegar; é o efeito que conhece a troca. */
    setSrc(null);
    setErro(null);
    setContagem(null);
    setRodando(false);
    setTempo(0);
    setDuracao(0);
    setVisiveis(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    registrouPlay.current = false;
    ultimoGravado.current = 0;
    fetch(`/api/g/${galeriaId}/urls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], tipo: "preview" }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const { urls } = (await r.json()) as { urls: Record<string, string> };
        if (!vivo) return;
        if (urls[id]) setSrc(urls[id]);
        else setErro("Este vídeo não está disponível agora.");
      })
      .catch(() => vivo && setErro("Não consegui abrir o vídeo. Confira a conexão e tente de novo."));
    return () => {
      vivo = false;
    };
  }, [galeriaId, id]);

  /* A página por trás não rola enquanto o filme está aberto. */
  useEffect(() => {
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
    };
  }, []);

  const guardar = useCallback(
    (forcar = false) => {
      const v = video.current;
      if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
      const agora = Date.now();
      if (!forcar && agora - ultimoGravado.current < 5000) return;
      ultimoGravado.current = agora;
      aoProgresso(id, { t: v.currentTime, d: v.duration, em: agora });
    },
    [aoProgresso, id],
  );

  const sair = useCallback(() => {
    guardar(true);
    fechar();
  }, [fechar, guardar]);

  const irPara = useCallback(
    (outro: EpisodioDoStream | null) => {
      if (!outro) return;
      guardar(true);
      seguirTocando.current = true;
      trocar(outro.id);
    },
    [guardar, trocar],
  );

  /* Teclado: Esc fecha (em tela cheia nativa o navegador sai dela antes),
     Shift+N e Shift+P andam entre episódios — as teclas do YouTube. */
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (pedindoNome) return;
      if (e.key === "Escape") sair();
      else if (e.shiftKey && e.key.toLowerCase() === "n") irPara(proximo);
      else if (e.shiftKey && e.key.toLowerCase() === "p") irPara(anterior);
      else {
        /* Com o foco num botão ou na linha do filme, espaço e setas são
           deles — senão o espaço tocaria e pausaria no mesmo aperto. */
        const alvo = e.target as HTMLElement | null;
        if (alvo && /^(BUTTON|INPUT|A)$/.test(alvo.tagName)) return;
        const tecla = e.key.toLowerCase();
        if (tecla === " " || tecla === "k") {
          e.preventDefault();
          alternar();
        } else if (e.key === "ArrowRight") andarNoFilme(10);
        else if (e.key === "ArrowLeft") andarNoFilme(-10);
        else if (tecla === "m" && video.current) {
          video.current.muted = !video.current.muted;
          mostrarControles();
        } else if (tecla === "f") telaCheia();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [alternar, andarNoFilme, anterior, irPara, mostrarControles, pedindoNome, proximo, sair, telaCheia]);

  /* A contagem do próximo: um segundo por vez, e ao chegar a zero, troca. */
  useEffect(() => {
    if (contagem === null) return;
    if (contagem <= 0) {
      irPara(proximo);
      return;
    }
    const t = window.setTimeout(() => setContagem((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [contagem, irPara, proximo]);

  /* `jaDisse` é a porta do nome acabando de responder: o estado `identificado`
     só muda na próxima pintura, e a pessoa não pode ter de pedir de novo. */
  async function baixar(jaDisse = false) {
    if (!ep || baixando) return;
    if (!identificado && !jaDisse) {
      setPedindoNome(true);
      return;
    }
    setBaixando(true);
    try {
      const r = await fetch(`/api/g/${galeriaId}/urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [ep.id], tipo: "download" }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const { urls } = (await r.json()) as { urls: Record<string, string> };
      const url = urls[ep.id];
      if (!url) throw new Error("sem url");
      fetch(`/api/g/${galeriaId}/acesso`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "baixou", mediaId: ep.id }),
        keepalive: true,
      }).catch(() => {});
      baixarNoComputador(url, ep.nomeDoArquivo);
      avisar(`Baixando “${ep.titulo}” — ${tamanho(ep.bytes)}`);
    } catch {
      avisar("Não consegui preparar o download. Tente de novo.");
    } finally {
      setBaixando(false);
    }
  }

  if (!ep) return null;
  const fileira = fileiraDe.get(ep.id);

  return (
    <div
      ref={tela}
      role="dialog"
      aria-modal="true"
      aria-label={ep.titulo}
      /* `100dvh`, e não `inset-0` sozinho: no iPhone o pé da tela fixa fica
         embaixo da barra do Safari, e era lá que os controles moravam. */
      className={`fixed inset-x-0 top-0 z-[60] flex h-[100dvh] flex-col bg-black text-white ${visiveis ? "" : "cursor-none"}`}
      onPointerMove={(e) => {
        if (e.pointerType === "mouse") mostrarControles();
      }}
    >
      <div
        className={`absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] transition-opacity duration-300 sm:px-6 ${
          visiveis ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          onClick={sair}
          aria-label="Fechar o vídeo"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl transition hover:bg-white/10"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          {fileira && (
            <span className="block truncate font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">
              {fileira}
            </span>
          )}
          <span className="block truncate text-sm sm:text-base">{ep.titulo}</span>
        </div>
        {anterior && (
          <button
            type="button"
            onClick={() => irPara(anterior)}
            className="hidden rounded-full px-3 py-2 text-xs text-white/80 transition hover:bg-white/10 sm:block"
          >
            ‹ anterior
          </button>
        )}
        {proximo && (
          <button
            type="button"
            onClick={() => irPara(proximo)}
            className="hidden rounded-full px-3 py-2 text-xs text-white/80 transition hover:bg-white/10 sm:block"
          >
            próximo ›
          </button>
        )}
        {permiteDownload && (
          <button
            type="button"
            onClick={() => void baixar()}
            disabled={baixando}
            className="rounded-full border border-white/25 px-4 py-2 text-xs transition hover:bg-white/10 disabled:opacity-50"
          >
            {baixando ? "preparando…" : "Baixar"}
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {src ? (
          <>
            <video
              key={ep.id}
              ref={video}
              src={src}
              /* Sem `controls` e sem `autoPlay`: ver "os controles são
                 nossos", acima. O pôster segura a tela até o play. */
              poster={ep.poster ?? undefined}
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-contain"
              onError={saude.eventos.onError}
              onLoadedData={saude.eventos.onLoadedData}
              onPointerDown={(e) => {
                ultimoToque.current = e.pointerType;
              }}
              onClick={() => {
                /* No toque, o primeiro toque só mostra os controles — como
                   em qualquer player de celular. No mouse, clicar pausa. */
                if (ultimoToque.current !== "mouse" && !visiveis) mostrarControles();
                else alternar();
              }}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setDuracao(v.duration);
                setMudo(v.muted);
                setVolume(v.volume);
                const marca = lerProgresso(galeriaId)[ep.id];
                const desde = marca ? pontoDeRetomada(marca.t, v.duration) : 0;
                if (desde > 0) v.currentTime = desde;
                setTempo(v.currentTime);
                if (seguirTocando.current) {
                  seguirTocando.current = false;
                  void v.play().catch(() => {});
                }
              }}
              onPlay={(e) => {
                saude.eventos.onPlay(e);
                setRodando(true);
                setContagem(null);
                mostrarControles();
                if (registrouPlay.current) return;
                registrouPlay.current = true;
                fetch(`/api/g/${galeriaId}/acesso`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ acao: "assistiu", mediaId: ep.id }),
                  keepalive: true,
                }).catch(() => {});
              }}
              onTimeUpdate={(e) => {
                saude.eventos.onTimeUpdate(e);
                setTempo(e.currentTarget.currentTime);
                guardar();
              }}
              onDurationChange={(e) => setDuracao(e.currentTarget.duration)}
              onVolumeChange={(e) => {
                setMudo(e.currentTarget.muted);
                setVolume(e.currentTarget.volume);
              }}
              onWaiting={() => {
                saude.eventos.onWaiting();
                setEsperando(true);
              }}
              onPlaying={() => {
                saude.eventos.onPlaying();
                setEsperando(false);
              }}
              onCanPlay={() => setEsperando(false)}
              onPause={() => {
                saude.eventos.onPause();
                setRodando(false);
                setVisiveis(true);
                guardar(true);
              }}
              onEnded={() => {
                setRodando(false);
                setVisiveis(true);
                guardar(true);
                if (proximo) setContagem(ESPERA_DO_PROXIMO);
              }}
            />

            {/* O play grande no meio, parado — é o que diz "aperte aqui". */}
            {!rodando && contagem === null && (
              <button
                type="button"
                onClick={alternar}
                aria-label="Tocar"
                className="absolute left-1/2 top-1/2 z-10 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-black shadow-2xl transition hover:scale-105 motion-reduce:transition-none"
              >
                <IconePlay className="ml-1 h-7 w-7" />
              </button>
            )}
            <AvisoDoVideo
              tom="escuro"
              saude={saude.saude}
              baixar={permiteDownload ? () => void baixar() : undefined}
              dispensar={saude.dispensar}
            />
            {esperando && rodando && saude.saude === "ok" && (
              <span
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-2 border-white/25 border-t-white"
              />
            )}

            <BarraDoPlayer
              visiveis={visiveis}
              rodando={rodando}
              tempo={tempo}
              duracao={duracao}
              mudo={mudo}
              volume={volume}
              volumeObedece={volumeObedece}
              alternar={alternar}
              buscar={(t) => {
                if (video.current) video.current.currentTime = t;
                setTempo(t);
                mostrarControles();
              }}
              alternarMudo={() => {
                const v = video.current;
                if (!v) return;
                v.muted = !v.muted;
                if (!v.muted && v.volume === 0) v.volume = 1;
                mostrarControles();
              }}
              mudarVolume={(n) => {
                const v = video.current;
                if (!v) return;
                v.volume = n;
                v.muted = n === 0;
                mostrarControles();
              }}
              telaCheia={telaCheia}
              proximo={proximo ? () => irPara(proximo) : null}
            />
          </>
        ) : erro ? (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/75">{erro}</p>
        ) : (
          <span className="absolute inset-0 grid place-items-center text-sm text-white/60">preparando o vídeo…</span>
        )}

        {/* ── O PRÓXIMO EPISÓDIO ──────────────────────────────────────── */}
        {contagem !== null && proximo && (
          <div className="absolute bottom-28 right-4 z-20 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-neutral-900/95 shadow-2xl ring-1 ring-white/10 sm:right-8">
            <div className="flex gap-3 p-3">
              <span className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md bg-white/10">
                {proximo.poster && (
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
                  <img src={proximo.poster} alt="" className="h-full w-full object-cover" />
                )}
              </span>
              <div className="min-w-0">
                <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">
                  Próximo · em {contagem}s
                </span>
                <span className="mt-1 line-clamp-2 block text-sm">
                  {proximo.titulo}
                </span>
              </div>
            </div>
            <div className="flex gap-2 px-3 pb-3">
              <button
                type="button"
                onClick={() => irPara(proximo)}
                className="relative flex-1 overflow-hidden rounded-md bg-white px-3 py-2 text-xs font-semibold text-black"
              >
                <span
                  aria-hidden
                  className="stream-enche absolute inset-0 bg-black/10"
                  style={{ ["--espera" as string]: `${ESPERA_DO_PROXIMO}s` }}
                />
                <span className="relative">Assistir agora</span>
              </button>
              <button
                type="button"
                onClick={() => setContagem(null)}
                className="rounded-md px-3 py-2 text-xs text-white/75 transition hover:bg-white/10"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      {pedindoNome && (
        <PortaDoNome
          galeriaId={galeriaId}
          fechar={(seguiu) => {
            setPedindoNome(false);
            if (seguiu) {
              setIdentificado(true);
              /* O download segue sozinho: a pessoa pediu para baixar, e digitar
                 o nome não pode obrigá-la a pedir de novo. */
              void baixar(true);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * A barra de baixo do player: play, tempo, a linha do filme, som e tela
 * cheia. Ver "os controles são nossos", no `Player`.
 */
function BarraDoPlayer({
  visiveis,
  rodando,
  tempo,
  duracao,
  mudo,
  volume,
  volumeObedece,
  alternar,
  buscar,
  alternarMudo,
  mudarVolume,
  telaCheia,
  proximo,
}: {
  visiveis: boolean;
  rodando: boolean;
  tempo: number;
  duracao: number;
  mudo: boolean;
  volume: number;
  volumeObedece: boolean;
  alternar: () => void;
  buscar: (t: number) => void;
  alternarMudo: () => void;
  mudarVolume: (n: number) => void;
  telaCheia: () => void;
  proximo: (() => void) | null;
}) {
  const total = Number.isFinite(duracao) && duracao > 0 ? duracao : 0;
  const somZerado = mudo || volume === 0;
  const BOTAO = "grid h-11 w-11 shrink-0 place-items-center rounded-full transition hover:bg-white/10";
  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-12 transition-opacity duration-300 sm:px-6 ${
        visiveis ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <input
        type="range"
        min={0}
        max={total || 1}
        step={0.1}
        value={Math.min(tempo, total || 1)}
        disabled={!total}
        onChange={(e) => buscar(Number(e.target.value))}
        aria-label="Linha do filme"
        aria-valuetext={`${relogio(tempo)} de ${relogio(total)}`}
        className="linha-do-filme block w-full"
        style={{ ["--andou" as string]: `${total ? (tempo / total) * 100 : 0}%` }}
      />
      <div className="mt-1 flex items-center gap-1">
        <button type="button" onClick={alternar} aria-label={rodando ? "Pausar" : "Tocar"} className={BOTAO}>
          {rodando ? (
            <svg viewBox="0 0 12 14" aria-hidden className="h-4 w-4" fill="currentColor">
              <rect x="0.5" y="0.5" width="3.8" height="13" rx="1" />
              <rect x="7.7" y="0.5" width="3.8" height="13" rx="1" />
            </svg>
          ) : (
            <IconePlay className="ml-0.5 h-4 w-4" />
          )}
        </button>
        {proximo && (
          <button type="button" onClick={proximo} aria-label="Próximo vídeo" className={BOTAO}>
            <svg viewBox="0 0 14 14" aria-hidden className="h-4 w-4" fill="currentColor">
              <path d="M0 1.2v11.6c0 .6.7 1 1.2.6L9.6 7.6c.4-.3.4-.9 0-1.2L1.2.6C.7.3 0 .6 0 1.2z" />
              <rect x="10.8" y="0.8" width="2.6" height="12.4" rx="1" />
            </svg>
          </button>
        )}
        <div className="group/som flex items-center">
          <button type="button" onClick={alternarMudo} aria-label={somZerado ? "Ligar o som" : "Tirar o som"} className={BOTAO}>
            <svg viewBox="0 0 20 16" aria-hidden className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 5.5h3L9.5 2v12L5 10.5H2z" fill="currentColor" stroke="none" />
              {somZerado ? (
                <path d="M13.5 5.5l5 5m0-5l-5 5" />
              ) : (
                <>
                  <path d="M13 5.2a4 4 0 0 1 0 5.6" />
                  {volume > 0.5 && <path d="M15.6 2.8a7.4 7.4 0 0 1 0 10.4" />}
                </>
              )}
            </svg>
          </button>
          {/* Só onde o navegador obedece — no iPhone o volume é do aparelho. */}
          {volumeObedece && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={mudo ? 0 : volume}
              onChange={(e) => mudarVolume(Number(e.target.value))}
              aria-label="Volume"
              className="linha-do-filme w-20 sm:w-24"
              style={{ ["--andou" as string]: `${(mudo ? 0 : volume) * 100}%` }}
            />
          )}
        </div>
        <span className="ml-2 text-xs tabular-nums text-white/80">
          {relogio(tempo)}
          {total > 0 && <span className="text-white/50"> / {relogio(total)}</span>}
        </span>
        <button type="button" onClick={telaCheia} aria-label="Tela cheia" className={`${BOTAO} ml-auto`}>
          <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * A PORTA DO NOME, a mesma regra da galeria (23/09/2026): na primeira vez que
 * baixa, a pessoa diz o nome OU o e-mail. A resposta vira o cookie da galeria,
 * e ela não é perguntada de novo — nem aqui, nem nas fotos.
 */
function PortaDoNome({
  galeriaId,
  fechar,
}: {
  galeriaId: string;
  fechar: (seguiu: boolean) => void;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    if (!nome.trim() && !email.trim()) {
      setErro("Escreva o seu nome ou o seu e-mail.");
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch(`/api/g/${galeriaId}/eu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), email: email.trim(), motivo: "baixar" }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setErro(d?.erro ?? "Não consegui guardar. Tente de novo.");
        return;
      }
      fechar(true);
    } catch {
      setErro("Não consegui guardar. Confira sua conexão.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 px-4">
      <form
        onSubmit={enviar}
        className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
        style={{ background: "var(--g-superficie)", color: "var(--g-texto)" }}
      >
        <h2 className="text-base font-semibold">Antes de baixar, quem é você?</h2>
        <p className="mt-1 text-xs" style={{ color: "var(--g-suave)" }}>
          O nome ou o e-mail — um dos dois basta. É só para o estúdio saber quem levou os arquivos.
        </p>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Seu nome"
          aria-label="Seu nome"
          autoFocus
          className="mt-4 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: "var(--g-fundo)", border: "1px solid var(--g-linha)", color: "var(--g-texto)" }}
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Seu e-mail"
          aria-label="Seu e-mail"
          className="mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: "var(--g-fundo)", border: "1px solid var(--g-linha)", color: "var(--g-texto)" }}
        />
        {erro && <p className="mt-2 text-xs" style={{ color: "var(--g-destaque)" }}>{erro}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => fechar(false)}
            className="rounded-[var(--g-pilula,9999px)] px-4 py-2 text-sm transition hover:opacity-70"
            style={{ color: "var(--g-suave)" }}
          >
            Agora não
          </button>
          <button
            type="submit"
            disabled={enviando}
            className="rounded-[var(--g-pilula,9999px)] px-5 py-2 text-sm font-semibold transition hover:opacity-85 disabled:opacity-50"
            style={{ background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
          >
            {enviando ? "…" : "Baixar"}
          </button>
        </div>
      </form>
    </div>
  );
}
