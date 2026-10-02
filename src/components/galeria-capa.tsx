import { desenhoDoTitulo, temPalavraQueNaoCabe } from "@/lib/titulo-da-capa";
import {
  FONTES_TITULO,
  medidaDaLogo,
  proporcaoDaLogo,
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
  /** A medida do arquivo da logo (migração 052) — a proporção que a área usa. */
  logoLargura?: number | null;
  logoAltura?: number | null;
  urlImagem: string | null;
  /** Onde cortar a foto, em porcentagem. 50/50 é o centro — ver migração 031. */
  focoX: number;
  focoY: number;
  /** O fotógrafo APONTOU uma capa (não é a primeira foto por falta de escolha). */
  capaEscolhida: boolean;
  /** O texto da chamada das capas que têm uma ("Ver galeria"). No Stream com a
      capa do grupo Capa ela leva aos vídeos, e diz isso. */
  chamada?: string;
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

export function GaleriaCapa({
  dados,
  aparencia,
  ilustracao = false,
}: {
  dados: DadosCapa;
  aparencia: Aparencia;
  /**
   * A capa como ILUSTRAÇÃO de outra página — as galerias de exemplo da home.
   *
   * O nome do casal é o `<h1>` da galeria, e na galeria está certo: é o título
   * da página. Na home, onde doze capas de exemplo aparecem juntas, eram doze
   * `<h1>` com nome de casal fictício acima do título de verdade da página —
   * medido no ar em 29/09/2026 pela auditoria de SEO. Aqui o título vira `<p>`,
   * com o mesmo desenho.
   */
  ilustracao?: boolean;
}) {
  const fonteTitulo = FONTES_TITULO[aparencia.tipografia];
  const TagDoTitulo = ilustracao ? "p" : "h1";
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
  /* O nome do casal pode ter cor própria, separada do texto. Sem ela, herda a
     cor do texto como sempre herdou. Ver `CoresProprias.titulo`. */
  const corTitulo = aparencia.cores?.titulo;

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
   *
   * ── E DESDE 30/09/2026, PELA ÁREA ─────────────────────────────────────
   *
   * Com a barrinha mexida (`tamanhoLogo`), a altura sai da área escolhida e da
   * proporção do arquivo — ver `medidaDaLogo`. Aí a altura é EXATA, e não teto:
   * a logo pequena também cresce até o tamanho pedido, que era o meio-termo que
   * faltava. `object-contain` segura o desenho se a tela for mais estreita que a
   * logo (o `max-width: 100%` do Tailwind estreita a caixa, não a imagem).
   */
  const medidaLogo = medidaDaLogo(
    aparencia,
    proporcaoDaLogo(dados.logoLargura, dados.logoAltura),
  );
  const estiloLogo =
    medidaLogo && "altura" in medidaLogo
      ? { height: `${medidaLogo.altura}px`, maxWidth: "100%" }
      : { maxHeight: `${medidaLogo?.tetoAltura ?? 0}px` };

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
        style={estiloLogo}
        // inline-block em vez de mx-auto: assim o alinhamento vem do pai (ou
        // do `self-*` que a capa passa quando a logo é filha de um flex).
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
       * poderia se medir contra si mesmo. (`TagDoTitulo` é o `h1`, ou um `p`
       * quando a capa é ilustração — ver a prop `ilustracao`.)
       *
       * Ela não leva classe nenhuma de propósito: `text-align` é herdado do
       * pai de cada capa, e é lá que o eixo de alinhamento é aplicado.
       */
      <div style={{ containerType: "inline-size", width: "100%" }}>
        <TagDoTitulo
          /* `text-balance` reparte bem um título de várias palavras — e, quando
             a quebra DENTRO da palavra está liberada, o balanceador escolhe o
             mínimo e escreve o nome uma letra por linha. Os dois não convivem. */
          className={`${linhas || quebrarPalavra ? "" : "text-balance"} ${alinharBloco}`}
          style={{
            ...(corTitulo ? { color: corTitulo } : {}),
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
        </TagDoTitulo>
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

  /* --- CARTAZ: a foto grande e limpa, o texto embaixo ----------------------
   *
   * Felipe, 29/09/2026: "adicionar outra de capa grande, tipo a imersa, mas sem
   * degradê" — "sugeriram de adicionar uma opção de capa grande, mas sem o
   * degradê".
   *
   * ── POR QUE NÃO É A IMERSA COM O VÉU APAGADO ────────────────────────────
   *
   * Porque o véu da imersa é o que torna o nome legível. Ali o título fica
   * SOBRE a foto, e nenhum dos cinco elementos tem sombra, contorno ou fundo
   * próprio. Medido com os tokens do tema noite — o dos presets Átomo e
   * Cerimônia —, o título sem véu sai em 1,13:1 sobre vestido ao sol, 1,39:1
   * sobre pele clara e 1,62:1 sobre céu. O mínimo da WCAG para texto grande é
   * 3:1. O nome do casal some.
   *
   * Sobre o fundo do tema, os MESMOS tokens dão 17,69:1 no noite, 16,77:1 no
   * claro e 10,16:1 no creme. Então o que sai de cima da foto é o TEXTO. A
   * imersa fica exatamente como está: quem escolheu uma não quer a outra.
   *
   * ── A DOBRA, E POR QUE NÃO HÁ MULTIPLICADOR AQUI ───────────────────────
   *
   * Com o texto embaixo, a conta do celular muda. Em 390×844 com `cheia`, os
   * 78vh dariam 658 px de foto e sobrariam 186 px para um bloco que pede ~276
   * com a logo média — o nome cairia abaixo da dobra, que é o contrário de
   * "capa grande com o nome à vista".
   *
   * A saída tentadora é encolher a foto com um `calc(var(--g-capa-h)*0.82)`.
   * Ela custa caro: "Cheia" passaria a dizer 78vh no painel e desenhar 64vh na
   * tela, só nesta capa, e o eixo mentiria para quem o lê. Aqui `--g-capa-h`
   * mede o CABEÇALHO INTEIRO e a foto fica com o que sobra (`flex-1`) — o eixo
   * continua querendo dizer "quanto da tela a capa ocupa", como nas outras seis.
   *
   * ── LIMITE CONHECIDO: `capaFixa` quase não tem efeito aqui ─────────────
   *
   * `grudada` vira `sticky top-0 z-0`, e um cabeçalho de 78vh mais o bloco de
   * texto passa perto de 100vh. Sobra pouquíssimo para grudar. Não quebra nada
   * — a capa rola e as fotos passam —, mas quem escolher "Fica no lugar" vai
   * ver pouca diferença. Fica escrito para a próxima sessão não ler como bug.
   */
  if (aparencia.capa === "cartaz" && urlImagem) {
    return (
      <header
        data-capa="cartaz"
        className={`flex min-h-[var(--g-capa-h,78vh)] flex-col ${grudada}`}
        style={{ borderBottom: "1px solid var(--g-linha)", background: "var(--g-fundo)" }}
      >
        {/*
          A FOTO NUMA CAIXA, E A CAIXA COM O QUE SOBRA (01/10/2026).

          Juan: "Cartaz no formato 'pastas' tá bugado" — o vídeo dele era a tela
          inteira tomada pela foto. Medido em 1440×900 com uma capa em pé: o
          cabeçalho saía com 2.380 px, a foto sozinha com 2.159. Deitada daria
          960 px de foto mais o texto, numa tela de 900. Não era das Pastas: era
          a cartaz em qualquer formato, só mais visível ali, onde as pastas
          ficavam três telas abaixo.

          O `min-h-0 flex-1` que estava na própria `<img>` não segurava: o
          cabeçalho só tem ALTURA MÍNIMA, e num contêiner sem altura definida a
          altura natural da imagem (largura da tela × proporção da foto) é o que
          decide quanto ele cresce. Dentro de uma caixa, com a imagem em
          `absolute`, a foto deixa de ter altura própria: a caixa fica com o que
          sobra de `--g-capa-h` depois do texto, e a foto se corta nela pelo
          foco escolhido.

          O piso (40% da altura escolhida) é para a foto nunca sumir: com a
          capa "baixa" numa tela deitada, o texto sozinho pode passar da altura
          pedida — aí o cabeçalho cresce, em vez de a foto virar uma linha. É
          fração do eixo, e não um vh cravado, pela mesma regra de
          `testar-eixos-forma.mjs`.
        */}
        <div className="relative min-h-[calc(var(--g-capa-h,78vh)*0.4)] w-full flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */}
          <img
            src={urlImagem}
            alt=""
            fetchPriority="high"
            style={foco}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
        <div className={`px-6 py-10 sm:py-12 ${alinharTexto}`}>
          <Rotulo />
          <div className="mt-2">
            <Titulo base={TITULO_GRANDE} />
          </div>
          <div className="mt-4">
            <Legenda />
          </div>
          {/* Como na redonda e no arco: o embrulho sai junto, senão o `mt-6`
              dele deixa um vão morto no pé da capa. */}
          {!semAssinatura && (
            <div className="mt-6">
              <Estudio />
            </div>
          )}
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
        {/*
          ── A JORNAL NÃO TEM MAIS BOTÃO (24/09/2026) ────────────────────────

          Juan, sobre as capas: "muitas letras, cores diferentes. As letrinhas
          de um jeito, o 'ver galeria' de outro". E, sobre a mínima: "esse tá
          lindo, a distribuição das informações tão bonitas — tá sem o 'ver
          galeria'".

          Ele estava certo, e a conta fecha: das cinco capas, três já viviam sem
          botão — incluindo a IMERSA, que é a mais imersiva de todas. O botão
          era o elemento mais pesado da capa e o menos importante.

          E ele não tinha trabalho a fazer aqui: a jornal cresce pelo CONTEÚDO,
          não pela tela, então a próxima foto sempre aparece logo abaixo. O
          botão anunciava o que já estava visível, e a barra de ações
          (Slideshow · Favoritas · Baixar) vem logo em seguida de qualquer
          jeito.

          Decisão do Felipe em 24/09/2026: "tira o botão da jornal e deixa
          discreto no convite".
        */}

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
          {/*
            ── A ORDEM DO CONVITE ESTAVA INVERTIDA (23/09/2026) ──────────────

            Juan: "essa distribuição do 'convite' das opções de capa tá com uma
            estrutura desagradável. Muitas letras, cores diferentes. As
            letrinhas de um jeito, o 'ver galeria' de outro". E, sobre a capa
            mínima: "esse tá lindo, a distribuição das informações tão bonitas".

            Ele achou um defeito nosso, não uma questão de gosto: CONVITE era a
            única das cinco capas que punha a data ANTES da sobrancelha. As
            outras quatro fazem sobrancelha → nome → data, que é a ordem da capa
            que ele chamou de linda.

            A sobrancelha é a etiqueta do nome ("ENSAIO PREWEDDING" diz o que é
            aquele nome); ela pertence colada nele. A data e o local são
            legenda, e legenda vem depois do que ela legenda. Com a data no
            topo, a primeira coisa que o olho lia na entrega de um casamento era
            um número.

            O espaçamento acompanha: `gap-2` entre etiqueta e nome para os dois
            lerem como um bloco só, e `mt-6` antes da legenda para separar o
            bloco do que vem depois. Era `gap-5` entre tudo, e espaçamento
            uniforme não agrupa nada — quatro coisas soltas, que é exatamente o
            "muitas letras" da queixa.
          */}
          <div className={`flex flex-col gap-2 ${alinharItens} ${alinharTexto}`}>
            {/* Peso normal, e não negrito: a serifada de contraste alto (Bodoni,
                Playfair) vive do traço fino, e o negrito fecha justamente o que
                faz ela parecer papel de convite. */}
            <Rotulo />
            <Titulo base={TITULO_MEDIO} />
            <div className="mt-6">
              <Legenda />
            </div>
            {/*
              ── NO CONVITE ELE FICA, MAS SEM O BLOCO ──────────────────────

              Aqui o botão tem trabalho de verdade, e é a única capa em que
              tem: a convite multiplica a altura por 1,205 no computador, então
              na opção "Cheia" ela chega a 94vh e sobra só 6% de tela mostrando
              que existe mais abaixo. Nas outras sobram 22%.

              O que incomodava não era existir, era o PESO: um retângulo sólido
              logo abaixo de um nome em serifada fina é a coisa mais escura da
              capa, e a menos importante. Virou o que ele sempre foi de fato —
              uma chamada — em texto com um filete embaixo, na mesma família
              das outras letrinhas (e por isso acompanha o eixo "Letrinhas da
              capa", como elas).

              `border-bottom` e não `underline`: o filete fica a 6px da linha de
              base em vez de cortar as descidas do "g" de "galeria".
            */}
            <a
              href="#fotos"
              className={`mt-6 inline-block pb-1.5 ${semMono} text-[11px] uppercase tracking-[0.2em] transition hover:opacity-70`}
              style={{
                ...estiloDetalhe,
                color: "var(--g-destaque)",
                borderBottom: "1px solid var(--g-destaque)",
              }}
            >
              {dados.chamada ?? "Ver galeria"}
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
        {/*
          ── O ALINHAMENTO VALE NO COMPUTADOR TAMBÉM (28/09/2026) ────────────

          Esta coluna tinha `md:text-left` cravado: no computador a dividida
          era sempre à esquerda, qualquer que fosse o eixo. Só que a CAIXA do
          título obedece ao eixo (`alinharBloco`), e com "Centralizado" ela ia
          para o meio com o texto encostado na esquerda dela, enquanto o
          rótulo e a data ficavam na borda — o título torto em relação ao
          resto. Felipe, com o print da galeria da Juliana Josende: "na opção
          centralizada ficou feio, só o título ficou no centro".

          Agora o eixo manda nos três mecanismos, em todas as larguras, como
          nas outras capas. Quem quer a dividida encostada à esquerda escolhe
          "À esquerda" — que é o que a opção diz.
        */}
        <div
          className={`flex flex-col justify-center px-8 py-16 md:px-14 ${alinharTexto}`}
        >
          <Estudio className={aEsquerda ? "self-start" : "self-center"} />
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
