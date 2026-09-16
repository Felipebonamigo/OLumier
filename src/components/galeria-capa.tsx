import type { CSSProperties } from "react";
import {
  FONTES_TITULO,
  alturaLogoPx,
  pesoDoTitulo,
  type Aparencia,
  type LinhasTitulo,
} from "@/config/aparencia";

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
  /** O fotógrafo APONTOU uma capa (não é a primeira foto por falta de escolha). */
  capaEscolhida: boolean;
}

/*
 * ── O TAMANHO DO TÍTULO, EM TRÊS NÚMEROS ──────────────────────────────────
 *
 * `[mínimo, quanto cresce com a tela, máximo]`, e a capa escolhe o seu trio.
 * Vira um `clamp()`: no celular vale o mínimo, no notebook o máximo, e entre os
 * dois cresce junto com a janela.
 *
 * ── POR QUE SAIU DAS CLASSES DO TAILWIND ────────────────────────────────
 *
 * Era `text-4xl sm:text-5xl`: 36 px abaixo de 640 px de tela, 48 px acima —
 * um degrau, e nada no meio. Felipe, 16/09/2026, olhando a prévia de celular:
 * "ficou exageradamente grande, poderia ficar um pouco menor, mas delicado".
 * Ele está certo, e o degrau é a causa: 36 px é o tamanho de manchete de um
 * notebook aplicado a uma tela de 390 px, onde ele come metade da largura.
 *
 * Com o `clamp`, o mínimo cai para 28 px na capa redonda e o máximo continua
 * 48 px — o computador desenha o que sempre desenhou, e o celular ganha um
 * título proporcional à tela em vez de um tamanho emprestado de outra.
 *
 * Os máximos são exatamente os `text-*` de antes, para nenhuma galeria
 * entregue encolher no computador.
 */
const TITULO_GRANDE = [2.25, 8, 4.5] as const; //  36 → 72 px (imersa, jornal)
const TITULO_MEDIO = [2, 7, 3.75] as const; //     32 → 60 px (convite, dividida)
const TITULO_MIUDO = [1.75, 7, 3] as const; //     28 → 48 px (redonda, arco, mínima)
type BaseDoTitulo = typeof TITULO_GRANDE | typeof TITULO_MEDIO | typeof TITULO_MIUDO;

/*
 * ── QUANTO O NOME MEDE, EM `em` DA PRÓPRIA FONTE ──────────────────────────
 *
 * Uma estimativa, e ela existe para uma coisa só: garantir que "1 linha" caiba
 * na tela. Com `white-space: nowrap` e um nome comprido, o navegador não
 * quebra nem encolhe — ele transborda, e a galeria inteira ganha rolagem
 * horizontal. Sabendo a largura aproximada do texto dá para pedir ao CSS o
 * MENOR entre "o tamanho que a pessoa escolheu" e "o tamanho que cabe".
 *
 * Os números são médias de serifada e sem-serifa; nenhuma fonte bate exato, e
 * não precisa — errar para menos só desenha um título um pouco menor do que
 * caberia, enquanto errar para mais quebra a página. Daí a folga de 6% no fim.
 */
function larguraDoTituloEm(titulo: string): number {
  let em = 0;
  for (const c of titulo) {
    if (c === " ") em += 0.26;
    else if (c === "&") em += 0.7;
    else if (c === c.toUpperCase() && c !== c.toLowerCase()) em += 0.72;
    else if (/[0-9]/.test(c)) em += 0.5;
    else if (/[ijltIl.,'’!|]/.test(c)) em += 0.28;
    else em += 0.47;
  }
  return Math.max(1, em) * 1.06;
}

/*
 * ── A LARGURA QUE FAZ O NOME CAIR EM N LINHAS ─────────────────────────────
 *
 * Duas linhas é uma caixa com metade dos caracteres; três, com um terço. O
 * `text-wrap: balance` que o título já usa faz o resto — ele distribui as
 * palavras para as linhas saírem parecidas, em vez de deixar uma sobra solta.
 *
 * O piso é a MAIOR PALAVRA. Sem ele, "Nathalia & Matheus" em três linhas
 * pediria uma caixa de 6 caracteres, e "Nathalia" tem oito: a palavra não cabe,
 * não pode quebrar, e transborda a caixa — três linhas tortas em vez de três
 * linhas.
 *
 * Medido em `ch`, e o `ch` sai da fonte do elemento em que a regra está. Por
 * isso ela vai no `h1`, e não na `div` de fora como estava até aqui: lá o `ch`
 * era medido na fonte do CORPO, em 16 px, e um `max-w-[18ch]` que devia valer
 * uns 430 px de título valia 145. É o defeito que empilhava o nome em três.
 */
function quebraDoTitulo(titulo: string, linhas: LinhasTitulo): CSSProperties {
  const limpo = titulo.trim();
  if (linhas === "uma") return { whiteSpace: "nowrap" };

  /* `auto` continua sendo o navegador quebrando onde couber — só que agora
     dentro de uma caixa medida na fonte certa. 22ch é o antigo 18ch corrigido
     com folga: nome de casal cabe numa linha, e título longo vira bloco em vez
     de uma linha de ponta a ponta da tela. */
  if (linhas === "auto") return { maxWidth: "22ch" };

  const n = linhas === "duas" ? 2 : 3;
  const maiorPalavra = limpo.split(/\s+/).reduce((m, p) => Math.max(m, p.length), 0);
  /* +1 de folga: o `ch` é a largura do "0", e letras de caixa alta são mais
     largas que ele. Sem a folga, um nome no limite cai numa linha a mais. */
  const porLinha = Math.max(Math.ceil(limpo.length / n), maiorPalavra) + 1;
  return { maxWidth: `${porLinha}ch` };
}

/**
 * As quatro capas. Todas leem as mesmas variáveis de tema (--g-*), então trocar
 * o tema muda a capa junto, sem cada variante ter cores próprias.
 */
export function GaleriaCapa({ dados, aparencia }: { dados: DadosCapa; aparencia: Aparencia }) {
  const fonteTitulo = FONTES_TITULO[aparencia.tipografia];
  const { titulo, subtitulo, dataFormatada, estudio, urlImagem, logoUrl, capaEscolhida } = dados;
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

  /*
   * ── A BARRINHA DE TAMANHO, E AS LINHAS ────────────────────────────────
   *
   * Pedido do Felipe em 16/09/2026, em duas partes que são a mesma decisão:
   * uma barrinha para o tamanho ("se o texto ficaria tudo em uma única linha,
   * ou se aumentando o tamanho do texto ele iria pra linhas de baixo") e a
   * escolha de quantas linhas o nome ocupa ("na mesma linha, ou em 2 ou em 3").
   *
   * O tamanho é o `clamp` da capa multiplicado pela porcentagem do eixo. Em
   * 100% a conta é o `clamp` puro, e a capa desenha o que sempre desenhou.
   *
   * ── O TETO QUE IMPEDE O TÍTULO DE VAZAR ─────────────────────────────────
   *
   * Em "1 linha" o navegador não quebra nem encolhe: um nome comprido
   * simplesmente sai pela borda e a galeria inteira ganha rolagem horizontal —
   * defeito que apareceria só no dia em que alguém digitasse um nome longo, ou
   * abrisse no celular.
   *
   * O `min()` resolve por construção: o título desenha no tamanho pedido OU no
   * maior que cabe na coluna, o que for menor. `cqw` é a largura do container
   * (a `div` que embrulha o título, com `container-type: inline-size`), então a
   * conta vale em qualquer capa e em qualquer tela sem medir nada em JavaScript.
   *
   * Vale só para "1 linha": nas outras o texto quebra sozinho, e um teto ali
   * deixaria o título menor do que a pessoa pediu sem motivo.
   */
  const fator = aparencia.tamanhoTitulo / 100;
  const umaLinha = aparencia.linhasTitulo === "uma";
  const larguraEm = larguraDoTituloEm(titulo);

  const Titulo = ({ base }: { base: BaseDoTitulo }) => {
    const [min, cresce, max] = base;
    const pedido = `clamp(${min}rem, ${cresce}vw, ${max}rem) * ${fator}`;
    return (
      /*
       * O container de medida é uma `div` e não o `h1`: `container-type` só
       * responde por quem está DENTRO do elemento, então o próprio `h1` não
       * poderia se medir contra si mesmo.
       *
       * Ela não leva classe nenhuma de propósito. `text-align` é herdado, e a
       * capa dividida escreve `md:text-left` no pai: repetir `alinharTexto`
       * aqui venceria essa regra por estar fora de media query e viraria a capa
       * do avesso no computador — uma capa entregue mudando de cara por causa
       * de uma `div` de medição.
       */
      <div style={{ containerType: "inline-size" }}>
        <h1
          className={`text-balance ${alinharBloco}`}
          style={{
            fontFamily: fonteTitulo,
            fontWeight: peso,
            lineHeight: aparencia.tipografia === "manuscrita" ? 1.2 : 1.05,
            fontSize: umaLinha
              ? `min(calc(${pedido}), calc(100cqw / ${larguraEm.toFixed(2)}))`
              : `calc(${pedido})`,
            ...quebraDoTitulo(titulo, aparencia.linhasTitulo),
          }}
        >
          {titulo}
        </h1>
      </div>
    );
  };

  /**
   * A SOBRANCELHA: o que é o evento, acima do título.
   *
   * Juan pediu "casamento, aniversário, prewedding… para não ocupar tanto
   * espaço visual se estivesse no título em si". Por isso é pequena, em
   * maiúsculas e com muito espaçamento entre letras: o olho a lê como etiqueta
   * e segue para o nome, em vez de disputar com ele.
   *
   * Some quando vazia, que é o caso de toda galeria feita antes de 10/09/2026.
   */
  const Rotulo = () =>
    aparencia.rotulo ? (
      <p
        className="font-mono text-[10px] uppercase tracking-[0.32em]"
        style={{ color: "var(--g-tenue)" }}
      >
        {aparencia.rotulo}
      </p>
    ) : null;

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
            <Rotulo />
            <Titulo base={TITULO_GRANDE} />
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
        <div className="mt-8">
          <Rotulo />
          <Titulo base={TITULO_GRANDE} />
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

        {/*
          A FOTO DA JORNAL — a manchete em cima, a imagem embaixo (08/09/2026).

          Felipe: "minha capa não aparece no formato jornal". O aviso da tela
          estava certo — o desenho era só tipografia — mas a resposta certa não
          era mandá-lo trocar de desenho: um jornal TEM foto. É a manchete e,
          abaixo dela, a imagem grande. Era essa metade que faltava.

          Só com capa ESCOLHIDA. A página sabe usar a primeira foto da galeria
          quando ninguém escolheu nada, e se essa terceira via contasse aqui,
          toda galeria que hoje usa o preset Revista ganharia uma foto que
          ninguém pediu — incluindo as já entregues.

          Mais baixa que as outras capas (60% da altura do eixo): aqui a foto
          acompanha o texto em vez de substituí-lo, e ocupar a tela inteira
          empurraria a manchete para fora antes de alguém lê-la.
        */}
        {capaEscolhida && urlImagem && (
          <div
            className={`mt-12 overflow-hidden ${alinharBloco}`}
            style={{ maxWidth: "72rem" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */}
            <img
              src={urlImagem}
              alt=""
              fetchPriority="high"
              style={foco}
              className="h-[calc(var(--g-capa-h,78vh)*0.6)] w-full object-cover"
            />
          </div>
        )}
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
            <Rotulo />
            <Titulo base={TITULO_MEDIO} />
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
            <Rotulo />
            <Titulo base={TITULO_MEDIO} />
          </div>
          <div className="mt-5">
            <Legenda />
          </div>
        </div>
      </header>
    );
  }

  /* --- REDONDA e ARCO: a foto em cima, o texto embaixo ----------------------
   *
   * Juan, 10/09/2026: "foto redonda com título embaixo, mais minimalista. Foto
   * em formato de arco, reta na parte inferior horizontal, título embaixo."
   *
   * São a MESMA capa com uma moldura diferente, e por isso moram no mesmo
   * ramo: o que muda entre elas é uma classe de arredondamento. Separá-las em
   * dois blocos quase idênticos garantiria que um dia uma ganhasse um conserto
   * que a outra não recebe.
   *
   * ── POR QUE A PROPORÇÃO É DIFERENTE NAS DUAS ────────────────────────────
   *
   * O círculo é 1:1 por definição — qualquer outra coisa vira elipse. O arco é
   * 3:4 em pé, que é a forma de um portal: alto o bastante para o topo
   * arredondado ser lido como arco, e não como um canto amassado.
   *
   * As duas caem na mínima sem foto, como as outras capas com foto fazem.
   */
  if ((aparencia.capa === "redonda" || aparencia.capa === "arco") && urlImagem) {
    const ehRedonda = aparencia.capa === "redonda";
    return (
      <header
        data-capa={aparencia.capa}
        className={`px-6 py-14 sm:py-20 ${alinharTexto}`}
        style={{ borderBottom: "1px solid var(--g-linha)" }}
      >
        <div
          className={`overflow-hidden ${alinharBloco} ${
            ehRedonda ? "aspect-square rounded-full" : "aspect-[3/4] rounded-t-full"
          }`}
          style={{ maxWidth: ehRedonda ? "22rem" : "20rem" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */}
          <img
            src={urlImagem}
            alt=""
            fetchPriority="high"
            style={foco}
            className="h-full w-full object-cover"
          />
        </div>

        <div className="mt-8">
          <Rotulo />
        </div>
        <div className="mt-2">
          <Titulo base={TITULO_MIUDO} />
        </div>
        <div className="mt-4">
          <Legenda />
        </div>
        <div className="mt-6">
          <Estudio />
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
      <div className="mt-6">
        <Rotulo />
        <Titulo base={TITULO_MIUDO} />
      </div>
      <div className="mt-4">
        <Legenda />
      </div>
    </header>
  );
}
