import { desenhoDoTitulo, temPalavraQueNaoCabe } from "@/lib/titulo-da-capa";
import {
  FONTES_TITULO,
  alturaLogoPx,
  fonteDoDetalhe,
  pesoDoTitulo,
  type Aparencia,
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

export function GaleriaCapa({ dados, aparencia }: { dados: DadosCapa; aparencia: Aparencia }) {
  const fonteTitulo = FONTES_TITULO[aparencia.tipografia];
  const { titulo, subtitulo, dataFormatada, estudio, urlImagem, logoUrl, capaEscolhida } = dados;
  const legenda = [dataFormatada, subtitulo].filter(Boolean).join(" · ");

  /*
   * ── AS LETRINHAS DA CAPA GANHARAM DONO (23/09/2026) ─────────────────────
   *
   * Juan: "as fontes dessas outras letrinhas não tem como trocar". Felipe, em
   * seguida: "e a cor também".
   *
   * Medido antes de mexer, na capa jornal: o título saía em Cormorant Garamond
   * (o eixo `tipografia`) e a sobrancelha, a data, a assinatura e o botão saíam
   * todos em `ui-monospace`. A causa é o `font-mono` escrito nas cinco tags
   * aqui embaixo — classe na própria tag ganha da fonte herdada do corpo, então
   * nem o eixo do título nem o do texto alcançavam nada disso.
   *
   * `detalhe` é `null` quando o eixo está em `mono`, e aí a classe `font-mono`
   * continua onde sempre esteve: capa entregue não muda de cara sozinha.
   */
  const fonteDetalhe = fonteDoDetalhe(aparencia);
  const semMono = fonteDetalhe ? "" : "font-mono";
  const estiloDetalhe = fonteDetalhe ? { fontFamily: fonteDetalhe } : {};
  /* A cor escolhida vale para as três letrinhas de texto; sem ela, cada uma
     mantém o tom derivado que sempre teve. Ver `CoresProprias.detalhe`. */
  const corDetalhe = aparencia.cores?.detalhe;

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
   * ── A CAPA QUE FICA (16/09/2026) ────────────────────────────────────────
   *
   * Felipe: "permitir fixar o título da capa na galeria, ou seja, se for
   * rolando a galeria, o título fica".
   *
   * `sticky` e não `fixed`: ver o comentário de `CapaFixa`. Resumo — `fixed`
   * tiraria a capa do fluxo e as primeiras fotos nasceriam atrás dela, e o
   * conserto seria um espaçador com a altura da capa, ou seja, dois lugares
   * concordando sobre o mesmo número para sempre.
   *
   * `z-0` importa: sem ele a capa fica no mesmo nível da galeria e a ordem de
   * quem cobre quem passa a depender da ordem do documento. A galeria se
   * declara `z-10` na página; a capa se declara aqui.
   */
  const grudada = aparencia.capaFixa === "fixa" ? "sticky top-0 z-0" : "";

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

  /*
   * ── A CAPA SEM ASSINATURA NENHUMA (17/09/2026) ──────────────────────────
   *
   * "Nenhuma" no eixo da logo não troca a imagem por texto: tira a assinatura
   * inteira. A capa fica com a foto, o título e a data — que é o que "sem logo"
   * quer dizer numa capa de casamento. Trocar por texto seria responder outra
   * pergunta, e é a resposta que o eixo já dá a quem não enviou logo.
   */
  const semAssinatura = aparencia.logo === "nenhuma";

  const Estudio = ({ className = "" }: { className?: string }) =>
    semAssinatura ? null : logoUrl ? (
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
      className={`${semMono} text-[11px] uppercase tracking-[0.3em] ${className}`}
      style={{ ...estiloDetalhe, color: corDetalhe ?? "var(--g-suave)" }}
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

  /*
   * ── AS LINHAS SÃO DECIDIDAS AQUI, NÃO PELA LARGURA (17/09/2026) ─────────
   *
   * Felipe, com "Júlia & Gustavo" e "3 linhas" marcado: "aqui o 3 linhas não
   * está em 3, está apenas em 2".
   *
   * Largura não conta linha — ela impede a linha de passar de um tamanho, e o
   * navegador usa quantas precisar, nunca mais. Ver `lib/titulo-da-capa.ts`.
   *
   * `null` é o `auto`: aí quem quebra é o navegador, dentro da caixa de 22ch,
   * e o `text-balance` distribui. Com linhas decididas, o `nowrap` garante que
   * cada uma fique inteira — e o tamanho da fonte é limitado pela MAIOR delas,
   * pelo mesmo motivo que já limitava "1 linha": sem isso, um nome comprido
   * transborda e a galeria ganha rolagem horizontal.
   *
   * `desenhoDoTitulo` é uma porta TOTAL: qualquer tropeço lá dentro devolve
   * `linhas: null` e a capa desenha como sempre desenhou, em vez de a galeria
   * inteira cair na tela de erro. Foi o que aconteceu em 17/09/2026 — ver o
   * cabeçalho de `lib/titulo-da-capa.ts`.
   */
  const { linhas, larguraEm } = desenhoDoTitulo(titulo, aparencia.linhasTitulo);
  /*
   * ── A PALAVRA QUE NÃO TEM ONDE QUEBRAR (21/09/2026) ────────────────────
   *
   * Só no `auto`, e só quando ela existe: ver `temPalavraQueNaoCabe`. Com
   * linhas decididas o `nowrap` e o teto de fonte já cuidam disso.
   */
  const quebrarPalavra = !linhas && temPalavraQueNaoCabe(titulo);

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
      <div style={{ containerType: "inline-size", width: "100%" }}>
        <h1
          /* `text-balance` reparte bem um título de várias palavras — e, quando
             a quebra DENTRO da palavra está liberada, o balanceador escolhe o
             mínimo e escreve o nome uma letra por linha. Os dois não convivem. */
          className={`${linhas || quebrarPalavra ? "" : "text-balance"} ${alinharBloco}`}
          style={{
            fontFamily: fonteTitulo,
            fontWeight: peso,
            lineHeight: aparencia.tipografia === "manuscrita" ? 1.2 : 1.05,
            fontSize: linhas
              ? `min(calc(${pedido}), calc(100cqw / ${larguraEm.toFixed(2)}))`
              : `calc(${pedido})`,
            /* Sem linhas decididas vale a caixa de 22ch do `auto`; com elas, o
               `nowrap` impede que uma linha vire duas por falta de espaço. */
            ...(linhas
              ? { whiteSpace: "nowrap" as const }
              : {
                  maxWidth: "22ch",
                  /* Quebrar dentro da palavra é feio; a galeria inteira rolando
                     de lado é pior, e era o que acontecia. Só entra quando há
                     palavra que não cabe. */
                  ...(quebrarPalavra ? { overflowWrap: "break-word" as const } : {}),
                }),
          }}
        >
          {linhas
            ? linhas.map((linha, i) => (
                <span key={`${i}-${linha}`}>
                  {i > 0 && <br />}
                  {linha}
                </span>
              ))
            : titulo}
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
        className={`${semMono} text-[10px] uppercase tracking-[0.32em]`}
        style={{ ...estiloDetalhe, color: corDetalhe ?? "var(--g-tenue)" }}
      >
        {aparencia.rotulo}
      </p>
    ) : null;

  const Legenda = () =>
    legenda ? (
      <p
        className={`${semMono} text-[11px] uppercase tracking-[0.2em]`}
        style={{ ...estiloDetalhe, color: corDetalhe ?? "var(--g-suave)" }}
      >
        {legenda}
      </p>
    ) : null;

  // --- IMERSA: foto ocupa a tela, texto por cima -----------------------------
  if (aparencia.capa === "imersa" && urlImagem) {
    return (
      <header
        data-capa="imersa"
        className={`relative flex min-h-[var(--g-capa-h,78vh)] items-end overflow-hidden ${grudada} ${
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
        className={`px-6 py-20 sm:py-28 ${grudada} ${alinharTexto}`}
        style={{ borderBottom: "1px solid var(--g-linha)", background: "var(--g-fundo)" }}
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
          className={`mt-10 inline-block rounded-full px-8 py-3 ${semMono} text-[11px] uppercase tracking-[0.2em] transition hover:opacity-80`}
          style={{ ...estiloDetalhe, border: "1px solid var(--g-destaque)", color: "var(--g-destaque)" }}
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
        className={`grid gap-8 px-5 py-5 md:min-h-[calc(var(--g-capa-h,78vh)*1.205)] md:grid-cols-[1.1fr_1fr] md:gap-14 md:px-10 md:py-10 ${grudada}`}
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
          {/* Sem assinatura, o lugar dela FICA: este `justify-between` tem dois
              filhos, e é o de cima que empurra o texto para o pé da coluna. Com
              um filho só, o texto subiria para o topo — a capa CONVITE mudaria
              de desenho por causa de uma escolha que era só sobre a logo. */}
          {semAssinatura ? (
            <span aria-hidden />
          ) : (
            <Estudio className={aEsquerda ? "self-start" : "self-center"} />
          )}
          <div className={`flex flex-col gap-5 ${alinharItens} ${alinharTexto}`}>
            <Legenda />
            {/* Peso normal, e não negrito: a serifada de contraste alto (Bodoni,
                Playfair) vive do traço fino, e o negrito fecha justamente o que
                faz ela parecer papel de convite. */}
            <Rotulo />
            <Titulo base={TITULO_MEDIO} />
            <a
              href="#fotos"
              className={`mt-2 inline-block px-8 py-3 ${semMono} text-[11px] uppercase tracking-[0.2em] transition hover:opacity-85`}
              style={{ ...estiloDetalhe, background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
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
      <header
        data-capa="dividida"
        className={`grid min-h-[calc(var(--g-capa-h,78vh)*0.897)] md:grid-cols-2 ${grudada}`}
      >
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
        className={`px-6 py-14 sm:py-20 ${grudada} ${alinharTexto}`}
        style={{ borderBottom: "1px solid var(--g-linha)", background: "var(--g-fundo)" }}
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
        {/* O embrulho sai junto: vazio, o `mt-6` dele deixaria um vão morto no pé
            da capa — espaço reservado para uma assinatura que não vem. */}
        {!semAssinatura && (
          <div className="mt-6">
            <Estudio />
          </div>
        )}
      </header>
    );
  }

  // --- MÍNIMA (e reserva para quando não há foto de capa) -------------------
  return (
    <header
      data-capa="minima"
      className={`px-6 py-16 sm:py-20 ${grudada} ${alinharTexto}`}
      style={{ borderBottom: "1px solid var(--g-linha)", background: "var(--g-fundo)" }}
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
