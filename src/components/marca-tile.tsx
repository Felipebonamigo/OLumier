import { marca } from "@/config/marca";

/**
 * A marca: O FEIXE ATRAVESSANDO A LENTE.
 *
 * Um anel — a lente, e a órbita do átomo — cortado por um feixe de luz que entra
 * pela esquerda, atravessa e sai mais largo do outro lado. É a própria operação
 * do produto: a luz entra, passa pelo vidro, e chega maior do lado de fora.
 *
 * Nasceu junto com a paleta, não depois dela: o anel é PRATA (o vidro, a luz
 * fria da sala de projeção) e só o ponto focal é ÂMBAR. Mesma regra da
 * interface inteira — o âmbar é reservado ao que importa, então quando ele
 * aparece, quer dizer alguma coisa.
 *
 * A versão anterior (um anel com arco aceso, da era Fotônio recolorida) foi
 * descartada por isto: era desenho bonito herdando cor de outra ideia.
 *
 * SVG inline: escala sem pedido de rede, e o favicon (src/app/icon.svg) é este
 * mesmo desenho com fundo — mudou aqui, mude lá.
 */
/** As três órbitas. Mesma elipse, três giros — 60° entre elas é o que fecha a simetria. */
const ORBITAS = [30, 90, 150];

/** Um elétron na ponta de cada órbita. Coordenadas calculadas, não estimadas. */
const ELETRONS = [
  [37.34, 31.7],
  [24, 8.6],
  [10.66, 31.7],
] as const;

/**
 * As seis lâminas do diafragma. Cada uma sai da borda e entra girando 52° — é o
 * giro que faz ler como lâmina em vez de raio de roda.
 */
const LAMINAS =
  "M 24 16.5 L 26.6 21.97 M 30.5 20.25 L 27.06 25.24 M 30.5 27.75 L 24.46 27.27 " +
  "M 24 31.5 L 21.4 26.03 M 17.5 27.75 L 20.94 22.76 M 17.5 20.25 L 23.54 20.73";

/** A faísca de quatro pontas no núcleo — o gesto que o Movimento Átomo repete. */
const FAISCA =
  "M 24 20.4 L 24.81 23.19 L 27.6 24 L 24.81 24.81 L 24 27.6 " +
  "L 23.19 24.81 L 20.4 24 L 23.19 23.19 Z";

export function MarcaSimbolo({ tamanho = 40 }: { tamanho?: number }) {
  /*
   * ── DUAS VERSÕES, E O MOTIVO ──────────────────────────────────────────
   * Três órbitas + seis lâminas + três elétrons são vinte e poucos traços. A
   * 76px isso é um desenho; a 16px — favicon e selo do rodapé da galeria — vira
   * borrão cinza. Marca que só funciona grande não é marca, é ilustração.
   *
   * Abaixo de 28px o desenho cai para o essencial: duas órbitas, o anel do
   * diafragma sem lâmina, e o núcleo âmbar. A silhueta continua a mesma, então
   * as duas se reconhecem como a mesma marca.
   */
  const miudo = tamanho < 28;

  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      {/* as órbitas — o átomo, e a família */}
      {(miudo ? [30, 150] : ORBITAS).map((giro) => (
        <ellipse
          key={giro}
          cx="24"
          cy="24"
          rx="15.4"
          ry="6"
          transform={`rotate(${giro} 24 24)`}
          stroke="var(--marca-traco)"
          strokeWidth={miudo ? 1.9 : 1.5}
          opacity={giro === 90 ? 0.85 : 1}
        />
      ))}

      {!miudo &&
        ELETRONS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" fill="var(--marca-traco)" />
        ))}

      {/*
        O diafragma no núcleo é o que diz GALERIA. Sem ele o símbolo falaria só
        da família e não do que o produto faz — e foi por isso que ele venceu as
        três propostas anteriores.
      */}
      <circle
        cx="24"
        cy="24"
        r="7.5"
        fill="var(--marca-fundo)"
        stroke="var(--marca-traco)"
        strokeWidth={miudo ? 2.1 : 1.8}
      />
      {!miudo && (
        <path d={LAMINAS} stroke="var(--marca-traco)" strokeWidth="1" opacity="0.55" />
      )}

      {/* o único âmbar: a luz, no centro do diafragma */}
      {miudo ? (
        <circle cx="24" cy="24" r="3.1" fill="var(--acento)" />
      ) : (
        <path d={FAISCA} fill="var(--acento)" />
      )}
    </svg>
  );
}

/** Compatível com os usos antigos. Hoje desenha o símbolo livre, sem moldura. */
export function MarcaTile({ tamanho = 56 }: { tamanho?: number }) {
  return <MarcaSimbolo tamanho={tamanho} />;
}

/**
 * O selo de beta.
 *
 * Some sozinho quando `marca.beta` virar false — não há segundo lugar para
 * lembrar de editar. Fica ao lado do nome, e não numa faixa no topo da tela:
 * faixa vira ruído que a pessoa aprende a não ver em dois dias, e este aviso
 * precisa continuar legível no dia em que alguém for subir um casamento.
 *
 * `title` em vez de texto extra porque o selo aparece em cabeçalho apertado; a
 * frase inteira mora no cadastro, que é onde a decisão acontece.
 */
export function SeloBeta() {
  if (!marca.beta) return null;
  return (
    <span
      title={marca.betaExplicacao}
      className="rounded-full border border-acento/40 px-2 py-0.5 font-mono text-[9px] uppercase leading-none tracking-[0.18em] text-acento-alto"
    >
      beta
    </span>
  );
}

export function MarcaLockup({ tamanho = 40 }: { tamanho?: number }) {
  return (
    <span className="flex items-center gap-3">
      <MarcaSimbolo tamanho={tamanho} />
      <span>
        {/*
          O LOGOTIPO: duas palavras, dois pesos.

          "Galeria" leve e "Átomo" forte — é a hierarquia do nome. Galeria é o
          que a coisa É; Átomo é de quem ela é, e é a palavra que amarra na
          família. Ler nessa ordem, com esse contraste, diz a parceria sem
          precisar de uma linha explicando.

          Caixa alta e entreletra larga, como no lockup do Movimento Átomo. A
          Montserrat é a nossa e também a do site deles — não foi escolhida por
          isso, mas é o que faz as duas marcas parecerem da mesma casa sem
          copiar o desenho de ninguém.
        */}
        <span className="flex items-center gap-2">
          <span className="block text-[17px] uppercase leading-tight tracking-[0.2em]">
            {/* Derivado de `marca.nome`, nunca escrito à mão — é a regra do
                config/marca.ts. Nome de uma palavra só cai no peso forte
                inteiro, que continua sendo um logotipo válido. */}
            {(() => {
              const corte = marca.nome.lastIndexOf(" ");
              if (corte < 0) return <span className="font-semibold">{marca.nome}</span>;
              return (
                <>
                  <span className="font-light">{marca.nome.slice(0, corte)}</span>{" "}
                  <span className="font-semibold">{marca.nome.slice(corte + 1)}</span>
                </>
              );
            })()}
          </span>
          <SeloBeta />
        </span>
        <span className="block font-mono text-[9px] uppercase tracking-[0.3em] text-texto-faint">
          galerias de entrega
        </span>
      </span>
    </span>
  );
}
