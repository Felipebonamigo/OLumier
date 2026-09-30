"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** Contado na galeria inteira, na ordem das fileiras: E1, E2, E3… */
  numero: number;
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
  focoX,
  focoY,
  fileiras,
  fotos,
  permiteDownload,
  identificado,
}: {
  galeriaId: string;
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

  const fonteTitulo = FONTES_TITULO[aparencia.tipografia];
  const peso = pesoDoTitulo(aparencia.tipografia, aparencia.peso);
  const detalhe = fonteDoDetalhe(aparencia);
  const centro = aparencia.alinhamento === "centro";
  /* A mesma régua da capa (`medidaDaLogo`): a barrinha de tamanho do editor
     vale aqui também. `max-w` segura a logo larga no celular. */
  const medidaLogo = medidaDaLogo(aparencia, proporcaoDaLogo(logoLargura, logoAltura));
  const estiloLogo =
    medidaLogo && "altura" in medidaLogo
      ? { height: `${medidaLogo.altura}px` }
      : { maxHeight: `${medidaLogo?.tetoAltura ?? 0}px` };

  const meta = [
    dataFormatada,
    subtitulo,
    `${episodios.length} ${episodios.length === 1 ? "vídeo" : "vídeos"}`,
    todasComDuracao ? duracaoLegivel(duracaoTotal) : null,
  ].filter(Boolean);

  const alvoDaCapa = continuar?.ep ?? episodios[0];

  return (
    <>
      {/* ── A TELA DE CINEMA ───────────────────────────────────────────── */}
      <header className="relative isolate flex min-h-[82svh] flex-col overflow-hidden">
        {fundo && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém, fora do otimizador do Next
          <img
            src={fundo}
            alt=""
            fetchPriority="high"
            style={{ objectPosition: `${focoX}% ${focoY}%` }}
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
        )}
        {/*
          Dois véus da cor do FUNDO DA GALERIA, e não preto: no tema claro a
          tela de cinema termina em branco, no creme em creme. É o que deixa o
          texto (a cor de texto do tema) legível sobre qualquer foto, e o que
          faz a capa derreter nas fileiras em vez de acabar numa linha.
        */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(to top, var(--g-fundo) 4%, color-mix(in srgb, var(--g-fundo) 70%, transparent) 38%, transparent 72%)",
          }}
        />
        <div
          aria-hidden
          className={`absolute inset-0 -z-10 hidden md:block ${centro ? "opacity-0" : ""}`}
          style={{
            background:
              "linear-gradient(to right, color-mix(in srgb, var(--g-fundo) 85%, transparent) 0%, color-mix(in srgb, var(--g-fundo) 35%, transparent) 38%, transparent 62%)",
          }}
        />

        <div className={`flex px-5 pt-6 sm:px-10 sm:pt-8 ${centro ? "justify-center" : ""}`}>
          {medidaLogo && logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
            <img
              src={logoUrl}
              alt={estudio}
              style={estiloLogo}
              className="w-auto max-w-[55vw] object-contain"
            />
          ) : (
            <span
              className={`text-[11px] uppercase tracking-[0.24em] ${detalhe ? "" : "font-mono"}`}
              style={{ color: "var(--g-suave)", ...(detalhe ? { fontFamily: detalhe } : {}) }}
            >
              {estudio}
            </span>
          )}
        </div>

        <div
          className={`mt-auto w-full px-5 pb-10 sm:px-10 sm:pb-14 ${
            centro ? "mx-auto max-w-3xl text-center" : "max-w-3xl"
          }`}
        >
          {aparencia.rotulo && (
            <span
              className={`block text-[11px] uppercase tracking-[0.24em] ${detalhe ? "" : "font-mono"}`}
              style={{ color: "var(--g-suave)", ...(detalhe ? { fontFamily: detalhe } : {}) }}
            >
              {aparencia.rotulo}
            </span>
          )}
          <h1
            className="mt-2 text-balance leading-[0.95]"
            style={{
              fontFamily: fonteTitulo,
              fontWeight: peso,
              fontSize: `calc(clamp(2.4rem, 7vw, 5.5rem) * ${aparencia.tamanhoTitulo / 100})`,
              color: "var(--g-titulo, var(--g-texto))",
            }}
          >
            {titulo}
          </h1>
          {meta.length > 0 && (
            <p className="mt-4 text-sm" style={{ color: "var(--g-suave)" }}>
              {meta.join("  ·  ")}
            </p>
          )}

          <div className={`mt-7 flex flex-wrap gap-3 ${centro ? "justify-center" : ""}`}>
            {alvoDaCapa && (
              <button
                type="button"
                onClick={() => setTocando(alvoDaCapa.id)}
                className="inline-flex items-center gap-2.5 rounded-[var(--g-pilula,9999px)] px-7 py-3 text-sm font-semibold transition hover:opacity-85"
                style={{ background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
              >
                <IconePlay className="h-3.5 w-3.5" />
                {continuar ? (
                  <span>
                    Continuar
                    <span className="font-normal opacity-80">
                      {" "}
                      · E{continuar.ep.numero} · {relogio(continuar.marca.t)}
                    </span>
                  </span>
                ) : (
                  "Assistir"
                )}
              </button>
            )}
            {fotos.total > 0 && (
              <Link
                href={fotos.href}
                className="inline-flex items-center rounded-[var(--g-pilula,9999px)] px-6 py-3 text-sm transition hover:opacity-75"
                style={{
                  border: "1px solid var(--g-linha)",
                  color: "var(--g-texto)",
                  background: "color-mix(in srgb, var(--g-fundo) 45%, transparent)",
                  backdropFilter: "blur(6px)",
                }}
              >
                Ver as fotos ({fotos.total})
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ── AS FILEIRAS ────────────────────────────────────────────────── */}
      <div className="relative z-10 space-y-12 pb-6 pt-4 sm:space-y-14" style={{ background: "var(--g-fundo)" }}>
        {fileiras.map((f) => (
          <Fileira key={f.id} titulo={f.nome} detalhe={detalhe}>
            {f.episodios.map((ep) => (
              <CartaoDoEpisodio
                key={ep.id}
                ep={ep}
                marca={progresso[ep.id]}
                aoAbrir={() => setTocando(ep.id)}
              />
            ))}
          </Fileira>
        ))}

        {fotos.amostra.length > 0 && (
          <Fileira
            titulo="Fotos"
            detalhe={detalhe}
            extra={
              <Link href={fotos.href} className="text-xs transition hover:opacity-70" style={{ color: "var(--g-suave)" }}>
                ver todas ({fotos.total}) →
              </Link>
            }
          >
            {fotos.amostra.map((src, i) => (
              <li key={i} className="w-[42vw] shrink-0 snap-start sm:w-[220px]">
                <Link
                  href={fotos.href}
                  className="block aspect-[4/5] overflow-hidden rounded-[var(--g-canto,6px)]"
                  style={{ background: "var(--g-superficie)" }}
                  aria-label={i === 0 ? `Ver as ${fotos.total} fotos` : undefined}
                  tabIndex={i === 0 ? 0 : -1}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém */}
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition duration-500 hover:scale-[1.03] motion-reduce:transition-none"
                  />
                </Link>
              </li>
            ))}
          </Fileira>
        )}
      </div>

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
  detalhe,
  extra,
  children,
}: {
  titulo: string;
  detalhe: string | null;
  extra?: React.ReactNode;
  children: React.ReactNode;
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
      <div className="flex items-baseline justify-between gap-4 px-5 sm:px-10">
        <h2
          className={`text-[11px] uppercase tracking-[0.22em] ${detalhe ? "" : "font-mono"}`}
          style={{ color: "var(--g-suave)", ...(detalhe ? { fontFamily: detalhe } : {}) }}
        >
          {titulo}
        </h2>
        {extra}
      </div>
      <ul
        ref={faixa}
        onScroll={medir}
        className="fileira-sem-barra mt-4 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 sm:scroll-px-10 sm:gap-4 sm:px-10"
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
    </section>
  );
}

function CartaoDoEpisodio({
  ep,
  marca,
  aoAbrir,
}: {
  ep: EpisodioDoStream;
  marca: Marca | undefined;
  aoAbrir: () => void;
}) {
  const duracao = duracaoLegivel(ep.duracao ?? marca?.d);
  const visto = marca ? fracaoAssistida(marca.t, marca.d) : 0;
  return (
    <li className="w-[78vw] shrink-0 snap-start sm:w-[340px] lg:w-[380px]">
      <button type="button" onClick={aoAbrir} className="group block w-full text-left">
        <span
          className="relative block aspect-video overflow-hidden rounded-[var(--g-canto,6px)]"
          style={{ background: "var(--g-superficie)" }}
        >
          {ep.poster && (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
            <img
              src={ep.poster}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04] motion-reduce:transition-none"
            />
          )}
          <span
            aria-hidden
            className="absolute inset-0 grid place-items-center bg-black/0 transition group-hover:bg-black/25 group-focus-visible:bg-black/25"
          >
            <span className="grid h-12 w-12 scale-90 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition group-hover:scale-100 group-hover:opacity-100 group-focus-visible:opacity-100">
              <IconePlay className="ml-0.5 h-4 w-4" />
            </span>
          </span>
          {duracao && (
            <span className="absolute bottom-2 right-2 rounded-[4px] bg-black/65 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
              {duracao}
            </span>
          )}
          {visto > 0 && (
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
              <span className="block h-full" style={{ width: `${visto * 100}%`, background: "var(--g-destaque)" }} />
            </span>
          )}
        </span>
        <span className="mt-3 flex items-baseline gap-2.5">
          <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--g-tenue)" }}>
            E{ep.numero}
          </span>
          <span className="min-w-0 truncate text-[15px]" style={{ color: "var(--g-texto)" }}>
            {ep.titulo}
          </span>
        </span>
      </button>
    </li>
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
  const ultimoGravado = useRef(0);
  const registrouPlay = useRef(false);

  /* O endereço do filme, pedido a cada episódio. */
  useEffect(() => {
    let vivo = true;
    /* eslint-disable react-hooks/set-state-in-effect --
       Trocar de episódio zera a tela do anterior antes de o novo endereço
       chegar; é o efeito que conhece a troca. */
    setSrc(null);
    setErro(null);
    setContagem(null);
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
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [anterior, irPara, pedindoNome, proximo, sair]);

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
      role="dialog"
      aria-modal="true"
      aria-label={`E${ep.numero} · ${ep.titulo}`}
      className="fixed inset-0 z-[60] flex flex-col bg-black text-white"
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pb-10 pt-4 sm:px-6">
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
          <span className="block truncate text-sm sm:text-base">
            <span className="text-white/60">E{ep.numero} · </span>
            {ep.titulo}
          </span>
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

      <div className="relative grid min-h-0 flex-1 place-items-center">
        {src ? (
          <video
            key={ep.id}
            ref={video}
            src={src}
            /* Mesma razão do visualizador (16/09/2026): autoplay com som pode
               ser recusado; com pôster, a tela abre no quadro do filme e o
               play fica evidente, em vez de um retângulo preto. */
            poster={ep.poster ?? undefined}
            controls
            autoPlay
            playsInline
            preload="metadata"
            className="h-full max-h-full w-full max-w-full object-contain"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const marca = lerProgresso(galeriaId)[ep.id];
              const desde = marca ? pontoDeRetomada(marca.t, v.duration) : 0;
              if (desde > 0) v.currentTime = desde;
            }}
            onPlay={() => {
              setContagem(null);
              if (registrouPlay.current) return;
              registrouPlay.current = true;
              fetch(`/api/g/${galeriaId}/acesso`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ acao: "assistiu", mediaId: ep.id }),
                keepalive: true,
              }).catch(() => {});
            }}
            onTimeUpdate={() => guardar()}
            onPause={() => guardar(true)}
            onEnded={() => {
              guardar(true);
              if (proximo) setContagem(ESPERA_DO_PROXIMO);
            }}
          />
        ) : erro ? (
          <p className="max-w-sm px-6 text-center text-sm text-white/75">{erro}</p>
        ) : (
          <span className="text-sm text-white/60">preparando o vídeo…</span>
        )}

        {/* ── O PRÓXIMO EPISÓDIO ──────────────────────────────────────── */}
        {contagem !== null && proximo && (
          <div className="absolute bottom-20 right-4 z-10 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-neutral-900/95 shadow-2xl ring-1 ring-white/10 sm:right-8">
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
                  E{proximo.numero} · {proximo.titulo}
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
