import { FONTES_TITULO, type Aparencia } from "@/config/aparencia";

export interface DadosCapa {
  titulo: string;
  subtitulo: string | null;
  dataFormatada: string | null;
  estudio: string;
  /** Logo do estúdio; quando existe, substitui o nome em texto. */
  logoUrl?: string | null;
  urlImagem: string | null;
}

/**
 * As quatro capas. Todas leem as mesmas variáveis de tema (--g-*), então trocar
 * o tema muda a capa junto, sem cada variante ter cores próprias.
 */
export function GaleriaCapa({ dados, aparencia }: { dados: DadosCapa; aparencia: Aparencia }) {
  const fonteTitulo = FONTES_TITULO[aparencia.tipografia];
  const { titulo, subtitulo, dataFormatada, estudio, urlImagem, logoUrl } = dados;
  const legenda = [dataFormatada, subtitulo].filter(Boolean).join(" · ");

  /*
   * A logo, quando existe, SUBSTITUI o nome em texto — não acompanha.
   *
   * Mostrar os dois é o erro clássico: quase toda logo de fotógrafo já contém o
   * nome do estúdio desenhado, e o resultado é o nome aparecendo duas vezes,
   * uma embaixo da outra. Quem carregou uma logo quer que ela seja a marca.
   *
   * `alt` recebe o nome do estúdio: para quem usa leitor de tela, a logo É o
   * nome — deixar vazio apagaria essa informação da página.
   */
  const Estudio = ({ className = "" }: { className?: string }) =>
    logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- URL externa do estúdio, sem otimização nossa
      <img
        src={logoUrl}
        alt={estudio}
        // inline-block em vez de mx-auto: assim o alinhamento vem do pai, e a
        // capa "dividida" (texto à esquerda no desktop) não fica com a logo
        // centralizada sozinha no meio da coluna.
        className={`inline-block max-h-14 w-auto object-contain ${className}`}
      />
    ) : (
      <TextoEstudio className={className} />
    );

  const TextoEstudio = ({ className = "" }: { className?: string }) => (
    <p
      className={`font-mono text-[11px] uppercase tracking-[0.3em] ${className}`}
      style={{ color: "var(--g-destaque)" }}
    >
      {estudio}
    </p>
  );

  const Titulo = ({ tamanho }: { tamanho: string }) => (
    <h1
      className={`text-balance ${tamanho}`}
      style={{ fontFamily: fonteTitulo, lineHeight: aparencia.tipografia === "manuscrita" ? 1.2 : 1.05 }}
    >
      {titulo}
    </h1>
  );

  const Legenda = () =>
    legenda ? (
      <p
        className="font-mono text-[11px] uppercase tracking-[0.2em]"
        style={{ color: "var(--g-suave)" }}
      >
        {legenda}
      </p>
    ) : null;

  // --- IMERSA: foto ocupa a tela, texto por cima -----------------------------
  if (aparencia.capa === "imersa" && urlImagem) {
    return (
      <header className="relative flex min-h-[78vh] items-end justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */}
        <img
          src={urlImagem}
          alt=""
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, var(--g-fundo) 2%, color-mix(in srgb, var(--g-fundo) 55%, transparent) 35%, transparent 75%)",
          }}
        />
        <div className="relative z-10 px-6 pb-16 text-center">
          <Estudio />
          <div className="mt-5">
            <Titulo tamanho="text-5xl font-bold sm:text-7xl" />
          </div>
          <div className="mt-4">
            <Legenda />
          </div>
        </div>
      </header>
    );
  }

  // --- JORNAL: a referência do Sirius — fundo limpo, tipografia grande -------
  if (aparencia.capa === "jornal") {
    return (
      <header
        className="px-6 py-20 text-center sm:py-28"
        style={{ borderBottom: "1px solid var(--g-linha)" }}
      >
        <Estudio />
        <div className="mx-auto mt-8 max-w-[16ch]">
          <Titulo tamanho="text-5xl font-bold sm:text-7xl" />
        </div>
        <div className="mt-6">
          <Legenda />
        </div>
        <a
          href="#fotos"
          className="mt-10 inline-block rounded-full px-8 py-3 font-mono text-[11px] uppercase tracking-[0.2em] transition hover:opacity-80"
          style={{ border: "1px solid var(--g-destaque)", color: "var(--g-destaque)" }}
        >
          Ver galeria
        </a>
      </header>
    );
  }

  // --- DIVIDIDA: foto de um lado, texto do outro ----------------------------
  if (aparencia.capa === "dividida" && urlImagem) {
    return (
      <header className="grid min-h-[70vh] md:grid-cols-2">
        <div className="relative min-h-[42vh] overflow-hidden md:min-h-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */}
          <img
            src={urlImagem}
            alt=""
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
        <div className="flex flex-col justify-center px-8 py-16 text-center md:px-14 md:text-left">
          <Estudio />
          <div className="mt-6">
            <Titulo tamanho="text-4xl font-bold sm:text-6xl" />
          </div>
          <div className="mt-5">
            <Legenda />
          </div>
        </div>
      </header>
    );
  }

  // --- MÍNIMA (e reserva para quando não há foto de capa) -------------------
  return (
    <header
      className="px-6 py-16 text-center sm:py-20"
      style={{ borderBottom: "1px solid var(--g-linha)" }}
    >
      <Estudio />
      <div className="mx-auto mt-6 max-w-[18ch]">
        <Titulo tamanho="text-4xl font-bold sm:text-5xl" />
      </div>
      <div className="mt-4">
        <Legenda />
      </div>
    </header>
  );
}
