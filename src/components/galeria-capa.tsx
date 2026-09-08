import { FONTES_TITULO, alturaLogoPx, pesoDoTitulo, type Aparencia } from "@/config/aparencia";

export interface DadosCapa {
  titulo: string;
  subtitulo: string | null;
  dataFormatada: string | null;
  estudio: string;
  /** Logo do estúdio; quando existe, substitui o nome em texto. */
  logoUrl?: string | null;
  urlImagem: string | null;
  /** Onde cortar a foto, em porcentagem. 50/50 é o centro — ver migração 031. */
  focoX: number;
  focoY: number;
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
  /*
   * A ALTURA VEM DO EIXO, não do componente.
   *
   * Era `max-h-14` escrito aqui — 56 px, iguais para logo quadrada e para logo
   * horizontal fina, e sem nada na tela para mexer. Virou eixo de aparência
   * (`OPCOES.logo`), e o número mora lá: uma tabela de alturas duplicada aqui
   * envelheceria separada da que o editor mostra.
   *
   * Vai em `style` e não em classe do Tailwind de propósito: `max-h-[88px]`
   * montado a partir de variável não existe no CSS gerado — o Tailwind varre o
   * código à procura de classes escritas por extenso, e a que se monta em tempo
   * de execução simplesmente não é gerada. Já quebrou assim em outros projetos;
   * `style` não tem esse problema.
   */
  const alturaLogo = alturaLogoPx(aparencia.logo);

  /*
   * O PONTO FOCAL — onde a foto deve ser cortada.
   *
   * Juan, 08/09/2026: "queria que aparecesse mais o corpo do noivo, mas o
   * enquadramento foi automático". O automático é o `object-cover`, que
   * preenche a caixa e descarta o excedente pelo CENTRO — e numa capa larga com
   * uma foto retrato isso joga fora a metade de cima e a de baixo.
   *
   * Vai em `style` e não em classe pelo motivo de sempre neste arquivo: o
   * Tailwind gera classe lendo o código, e `object-[30%_78%]` montado em tempo
   * de execução não existe no CSS. Os dois números chegam validados de
   * `lib/capa-galeria.ts` e do próprio banco (migração 031).
   */
  const foco = { objectPosition: `${dados.focoX}% ${dados.focoY}%` };

  /*
   * ── O ALINHAMENTO, EM TRÊS CLASSES ─────────────────────────────────────
   *
   * São três e não uma porque alinhar texto tem três mecanismos diferentes,
   * e usar só o primeiro é o que deixa a capa pela metade:
   *
   *   texto   `text-align`, que move as LINHAS dentro da caixa
   *   bloco   o `mx-auto`, que centra a CAIXA (a de 16ch do título)
   *   itens   o `align-items` do flex, para os filhos de largura própria
   *
   * Trocar só o `text-align` deixaria a caixa do título no meio com o texto
   * encostado na esquerda dela — ainda torto, e agora com duas referências.
   * É exatamente a queixa que o eixo existe para resolver.
   */
  const aEsquerda = aparencia.alinhamento === "esquerda";
  const alinharTexto = aEsquerda ? "text-left" : "text-center";
  const alinharBloco = aEsquerda ? "" : "mx-auto";
  const alinharItens = aEsquerda ? "items-start" : "items-center";

  const Estudio = ({ className = "" }: { className?: string }) =>
    logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- URL externa do estúdio, sem otimização nossa
      <img
        src={logoUrl}
        alt={estudio}
        style={{ maxHeight: `${alturaLogo}px` }}
        // inline-block em vez de mx-auto: assim o alinhamento vem do pai, e a
        // capa "dividida" (texto à esquerda no desktop) não fica com a logo
        // centralizada sozinha no meio da coluna.
        className={`inline-block w-auto object-contain ${className}`}
      />
    ) : (
      <TextoEstudio className={className} />
    );

  /*
   * O NOME DO ESTÚDIO NÃO USA A COR DO BOTÃO.
   *
   * Juan, 05/09/2026: "deixei os botões verdinhos e gostei, mas a logo também
   * ficou verde e isso ficou ruim". Ele tem razão, e o defeito nasceu quando as
   * cores viraram escolha: enquanto `--g-destaque` era a cor do tema, pintar a
   * assinatura com ela era coerência. Desde que o editor a rotulou "Botões",
   * ela virou uma promessa — e pintar o nome do estúdio com ela é o botão
   * vazando para onde ninguém pediu.
   *
   * `--g-suave` é o secundário do tema, com contraste medido (ver
   * `variaveisDoTema`): a assinatura continua discreta sem herdar a cor de
   * ação.
   */
  const TextoEstudio = ({ className = "" }: { className?: string }) => (
    <p
      className={`font-mono text-[11px] uppercase tracking-[0.3em] ${className}`}
      style={{ color: "var(--g-suave)" }}
    >
      {estudio}
    </p>
  );

  /*
   * A GROSSURA VEM DO EIXO, e o `font-bold` que ficava nas quatro chamadas saiu.
   *
   * Ele cravava 700 em toda capa. Nas sete fontes que só têm o peso 400 isso
   * não deixava a fonte mais forte — o navegador engordava o traço sozinho, e
   * numa manuscrita o resultado é caligrafia deformada. `pesoDoTitulo` é quem
   * sabe o que cada família tem; ver o comentário do tipo `Peso`.
   */
  const peso = pesoDoTitulo(aparencia.tipografia, aparencia.peso);

  const Titulo = ({ tamanho }: { tamanho: string }) => (
    <h1
      className={`text-balance ${tamanho}`}
      style={{
        fontFamily: fonteTitulo,
        fontWeight: peso,
        lineHeight: aparencia.tipografia === "manuscrita" ? 1.2 : 1.05,
      }}
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
      <header
        data-capa="imersa"
        className={`relative flex min-h-[var(--g-capa-h,78vh)] items-end overflow-hidden ${
          aEsquerda ? "justify-start" : "justify-center"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */}
        <img
          src={urlImagem}
          alt=""
          fetchPriority="high"
          style={foco}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, var(--g-fundo) 2%, color-mix(in srgb, var(--g-fundo) 55%, transparent) 35%, transparent 75%)",
          }}
        />
        <div className={`relative z-10 w-full max-w-3xl px-6 pb-16 ${alinharTexto}`}>
          <Estudio />
          <div className="mt-5">
            <Titulo tamanho="text-5xl sm:text-7xl" />
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
        data-capa="jornal"
        className={`px-6 py-20 sm:py-28 ${alinharTexto}`}
        style={{ borderBottom: "1px solid var(--g-linha)" }}
      >
        <Estudio />
        <div className={`mt-8 max-w-[16ch] ${alinharBloco}`}>
          <Titulo tamanho="text-5xl sm:text-7xl" />
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

  /* --- CONVITE: foto emoldurada, entrega no pé, botão de entrada ------------
   *
   * Pedida pela Carol em 31/08/2026, a partir de uma galeria que ela viu no
   * Pixieset. É prima da "dividida" e não a mesma coisa — três diferenças, e
   * cada uma muda o que a capa comunica:
   *
   *   · A foto é EMOLDURADA, com margem da cor do tema em volta, em vez de
   *     sangrar até a borda. É o que dá o ar de convite impresso; foto colada
   *     na quina é a capa imersa, que conta outra história.
   *   · O texto ancora no PÉ da coluna, não no meio. A marca fica no alto, o
   *     olho sobe uma vez e desce para a ação — o mesmo caminho de um convite.
   *   · Tem BOTÃO de entrada. Na dividida a galeria começa ao rolar; aqui há um
   *     convite explícito, e é dele que a capa tira o nome.
   *
   * Capa nova em vez de mexer na dividida, porque a "Ateliê" já usa a dividida
   * em galeria que pode estar entregue — e capa que muda sozinha é a coisa que
   * este arquivo mais evita.
   */
  if (aparencia.capa === "convite" && urlImagem) {
    return (
      <header
        data-capa="convite"
        className="grid gap-8 px-5 py-5 md:min-h-[calc(var(--g-capa-h,78vh)*1.205)] md:grid-cols-[1.1fr_1fr] md:gap-14 md:px-10 md:py-10"
      >
        <div className="relative min-h-[calc(var(--g-capa-h,78vh)*0.667)] overflow-hidden md:min-h-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */}
          <img
            src={urlImagem}
            alt=""
            fetchPriority="high"
            style={foco}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>

        <div className="flex flex-col justify-between gap-10 md:py-4">
          <Estudio className={aEsquerda ? "self-start" : "self-center"} />
          <div className={`flex flex-col gap-5 ${alinharItens} ${alinharTexto}`}>
            <Legenda />
            {/* Peso normal, e não negrito: a serifada de contraste alto (Bodoni,
                Playfair) vive do traço fino, e o negrito fecha justamente o que
                faz ela parecer papel de convite. */}
            <Titulo tamanho="text-4xl sm:text-6xl" />
            <a
              href="#fotos"
              className="mt-2 inline-block px-8 py-3 font-mono text-[11px] uppercase tracking-[0.2em] transition hover:opacity-85"
              style={{ background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
            >
              Ver galeria
            </a>
          </div>
        </div>
      </header>
    );
  }

  // --- DIVIDIDA: foto de um lado, texto do outro ----------------------------
  if (aparencia.capa === "dividida" && urlImagem) {
    return (
      <header data-capa="dividida" className="grid min-h-[calc(var(--g-capa-h,78vh)*0.897)] md:grid-cols-2">
        <div className="relative min-h-[calc(var(--g-capa-h,78vh)*0.538)] overflow-hidden md:min-h-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */}
          <img
            src={urlImagem}
            alt=""
            fetchPriority="high"
            style={foco}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
        <div
          className={`flex flex-col justify-center px-8 py-16 md:px-14 md:text-left ${alinharTexto}`}
        >
          <Estudio />
          <div className="mt-6">
            <Titulo tamanho="text-4xl sm:text-6xl" />
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
      data-capa="minima"
      className={`px-6 py-16 sm:py-20 ${alinharTexto}`}
      style={{ borderBottom: "1px solid var(--g-linha)" }}
    >
      <Estudio />
      <div className={`mt-6 max-w-[18ch] ${alinharBloco}`}>
        <Titulo tamanho="text-4xl sm:text-5xl" />
      </div>
      <div className="mt-4">
        <Legenda />
      </div>
    </header>
  );
}
