import { Fragment } from "react";
import { FONTES_TITULO, TEMAS, type Aparencia } from "@/config/aparencia";

/**
 * A GALERIA EM MINIATURA — o desenho que o preset produz, e não a cor dele.
 *
 * ── DE ONDE VEIO (25/09/2026) ─────────────────────────────────────────────
 *
 * Juan, escolhendo o estilo ao criar uma galeria:
 *
 *   "Essas prévias dos estilos não fazem sentido. Tem várias super iguais, não
 *    dá pra perceber qual a diferença entre elas. Talvez podemos deixar uma
 *    'prévia' nessa escolha dos estilos. Pra mim a 'ateliê', 'marfim' e
 *    'caligrafia' são iguais. Convite e revista também."
 *
 * Ele estava descrevendo a amostra com precisão. Havia DUAS, diferentes, para a
 * mesma decisão — e cada uma mostrava metade:
 *
 *   no assistente   uma tarja de 56 px com o fundo do tema e "Ana & Pedro" na
 *                   fonte do título. Dois dos cinco eixos.
 *   no editor       um rabisco de 32×24 px com a GRADE, e sem tipografia
 *                   nenhuma. Outro eixo, e nenhum em comum com o primeiro.
 *
 * O que separa os presets é justamente o que nenhuma das duas desenhava: a
 * CAPA. "Ateliê" e "Marfim" são creme com manuscrita nas duas amostras —
 * idênticos — enquanto na galeria um abre com foto ao lado do nome e o outro
 * abre sem foto nenhuma. "Convite" e "Revista" são papel branco com serifada
 * nas duas, e na galeria um é foto emoldurada e o outro é manchete sobre foto.
 *
 * Então a amostra passa a ser a PÁGINA em miniatura: a capa que o preset usa,
 * o título na fonte dele, e a grade logo abaixo com a densidade e o canto
 * dele. Uma só, usada nos dois lugares — duas amostras para a mesma decisão
 * eram duas chances de mentir, e as duas usavam.
 *
 * ── O QUE ELA NÃO PROMETE ─────────────────────────────────────────────────
 *
 * Não é a galeria renderizada: é um diagrama. As "fotos" são retângulos de
 * duas cores tiradas do tema. Desenhar foto de verdade aqui exigiria uma da
 * galeria — que na hora de criar ainda não existe — e faria dez requisições
 * assinadas para uma tela de escolha.
 */

/** O papel de cada tema e as duas tintas que aparecem sobre ele. */
function tintas(a: Aparencia) {
  const t = TEMAS[a.tema];
  /*
   * Valores do tema, e não tokens do painel: isto é um rabisco de OUTRO tema
   * dentro do painel, e usar as cores daqui faria os dez rabiscos iguais — o
   * defeito que esta amostra existe para não ter.
   */
  return {
    fundo: t["--g-fundo"],
    texto: t["--g-texto"],
    linha: t["--g-linha"],
    /* As "fotos": duas tintas, para a grade ter ritmo em vez de virar um bloco
       chapado. No escuro elas clareiam; no claro e no creme, escurecem. */
    foto: a.tema === "noite" ? "rgba(190,205,230,.34)" : a.tema === "creme" ? "#c3ab8b" : "#c9ced6",
    fotoAlt: a.tema === "noite" ? "rgba(190,205,230,.19)" : a.tema === "creme" ? "#d8c7ab" : "#e2e6eb",
  };
}

/** O arredondamento das fotos, na escala da miniatura. */
const RAIO: Record<string, string> = {
  reto: "0px",
  suave: "1.5px",
  redondo: "3px",
  muito: "5px",
};

/** O respiro entre as fotos, na escala da miniatura. */
const VAO: Record<string, string> = {
  compacta: "1px",
  normal: "2.5px",
  arejada: "4px",
};

export function AmostraDoPreset({
  aparencia,
  titulo = "Ana & Pedro",
  className = "",
}: {
  aparencia: Aparencia;
  titulo?: string;
  className?: string;
}) {
  const c = tintas(aparencia);
  const vao = VAO[aparencia.densidade] ?? "2.5px";
  const raio = RAIO[aparencia.canto] ?? "1.5px";
  const fonte = FONTES_TITULO[aparencia.tipografia];

  const foto = (cor: string, estilo: React.CSSProperties = {}) => (
    <span style={{ background: cor, borderRadius: raio, display: "block", ...estilo }} />
  );

  /* O nome do casal, na fonte e no alinhamento do preset. É ele que separa uma
     serifada de uma manuscrita — e, entre duas manuscritas, é a ÚNICA coisa
     que as separa, então ganha o maior corpo que a miniatura comporta. */
  const nome = (corpo: number, alinhar: "center" | "left" = "center") => (
    <span
      style={{
        fontFamily: fonte,
        fontSize: `${corpo}px`,
        lineHeight: 1.1,
        color: c.texto,
        textAlign: alinhar,
        display: "block",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
      }}
    >
      {titulo}
    </span>
  );

  /* Uma linha fina no lugar da legenda (data · local): ela existe em todas as
     capas e dá peso ao bloco de texto, que é metade do que distingue uma capa
     dividida de uma mínima. */
  const legenda = (larg: string, alinhar: "center" | "left" = "center") => (
    <span
      style={{
        display: "block",
        height: "1.5px",
        width: larg,
        background: c.texto,
        opacity: 0.32,
        margin: alinhar === "center" ? "3px auto 0" : "3px 0 0",
      }}
    />
  );

  /*
   * ── AS CAPAS ────────────────────────────────────────────────────────────
   *
   * Cada ramo é o desenho de `galeria-capa.tsx` reduzido ao essencial: onde
   * está a foto, onde está o nome, e quanto da tela a capa ocupa. A altura em
   * porcentagem é o que faz a MÍNIMA parecer mínima — ela cede o espaço para a
   * grade, que é exatamente o que ela faz na galeria.
   */
  const capa = () => {
    const c1 = aparencia.capa;

    if (c1 === "imersa") {
      /* Foto sangrando, nome por cima dela. */
      return (
        <span
          style={{
            position: "relative",
            display: "block",
            height: "52%",
            background: c.foto,
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 6px",
            }}
          >
            {nome(13)}
            {legenda("34%")}
          </span>
        </span>
      );
    }

    if (c1 === "jornal") {
      /* Manchete em cima, imagem grande embaixo (08/09/2026). */
      return (
        <span style={{ display: "block", height: "52%" }}>
          <span style={{ display: "block", padding: "7px 6px 5px" }}>
            {nome(13)}
            {legenda("34%")}
          </span>
          {foto(c.foto, { height: "46%", margin: "0 6px" })}
        </span>
      );
    }

    if (c1 === "dividida") {
      /* Foto numa metade, texto na outra. */
      return (
        <span style={{ display: "flex", height: "52%" }}>
          {foto(c.foto, { width: "50%", borderRadius: 0 })}
          <span
            style={{
              width: "50%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "0 6px",
            }}
          >
            {nome(12)}
            {legenda("58%")}
          </span>
        </span>
      );
    }

    if (c1 === "convite") {
      /* Foto EMOLDURADA — a margem em volta é o que a distingue da dividida, e
         era o que faltava para "Convite" não parecer "Revista". */
      return (
        <span style={{ display: "flex", height: "52%", padding: "5px", gap: "6px" }}>
          {foto(c.foto, { width: "52%" })}
          <span
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              paddingBottom: "3px",
            }}
          >
            {nome(12)}
            {legenda("60%")}
          </span>
        </span>
      );
    }

    if (c1 === "redonda" || c1 === "arco") {
      const forma = c1 === "redonda" ? "50%" : "999px 999px 0 0";
      return (
        <span
          style={{
            height: "52%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
            padding: "5px 6px 0",
          }}
        >
          <span
            style={{
              background: c.foto,
              borderRadius: forma,
              width: c1 === "redonda" ? "36%" : "30%",
              aspectRatio: c1 === "redonda" ? "1 / 1" : "3 / 4",
            }}
          />
          {nome(11)}
        </span>
      );
    }

    /* MÍNIMA: sem foto, e por isso baixa — o resto é grade. */
    return (
      <span
        style={{
          height: "30%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 6px",
        }}
      >
        {nome(13)}
        {legenda("34%")}
      </span>
    );
  };

  /*
   * ── A GRADE ─────────────────────────────────────────────────────────────
   *
   * As quatro formas de `galeria-grade.tsx`, com o vão da densidade e o canto
   * do preset. `panorama` não tem preset, mas cai aqui inteira se um dia tiver.
   */
  const grade = () => {
    const g = aparencia.grade;
    const base: React.CSSProperties = { flex: 1, padding: `${vao} 6px 6px`, minHeight: 0 };

    if (g === "editorial") {
      return (
        <span
          style={{
            ...base,
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: vao,
          }}
        >
          {foto(c.foto, { gridRow: "span 2" })}
          {foto(c.fotoAlt)}
          {foto(c.foto)}
        </span>
      );
    }

    if (g === "linhas") {
      return (
        <span style={{ ...base, display: "flex", flexDirection: "column", gap: vao }}>
          <span style={{ display: "flex", gap: vao, flex: 1 }}>
            {foto(c.foto, { flex: 1 })}
            {foto(c.fotoAlt, { flex: 1 })}
            {foto(c.foto, { flex: 1 })}
          </span>
          <span style={{ display: "flex", gap: vao, flex: 1 }}>
            {foto(c.fotoAlt, { flex: 1 })}
            {foto(c.foto, { flex: 1 })}
            {foto(c.fotoAlt, { flex: 1 })}
          </span>
        </span>
      );
    }

    if (g === "colunas" || g === "panorama") {
      /*
       * FILEIRAS JUSTIFICADAS — desde 26/09/2026 é assim que as duas saem na
       * galeria (ver `lib/grade-mural.ts`), e a amostra desenha o que a
       * galeria faz: cada foto com a largura da sua proporção, a fileira toda
       * na mesma altura, e a fileira com a deitada mais baixa que a outra.
       *
       * A diferença entre as duas é a conta da fileira, e é ela que aparece
       * aqui: na "Colunas" toda fileira tem três fotos, a deitada inclusive;
       * na "Panorama" a deitada vale por duas e divide a fileira com uma só.
       *
       * Larguras e alturas em PROPORÇÃO (flex), não em pixels: a mesma amostra
       * cabe no assistente (112 px) e no editor de Design (80 px).
       */
      const fileira = (proporcoes: number[], cores: string[]) => {
        const soma = proporcoes.reduce((t, x) => t + x, 0);
        return (
          <span style={{ display: "flex", gap: vao, flex: `${1 / soma} 1 0`, minHeight: 0 }}>
            {/* Chave no Fragment: `foto` devolve o elemento sem uma, e a lista
                avisava no console de todo cartão de estilo "Colunas". */}
            {proporcoes.map((x, k) => (
              <Fragment key={k}>{foto(cores[k], { flex: `${x} 1 0` })}</Fragment>
            ))}
          </span>
        );
      };
      const [r, d] = [2 / 3, 3 / 2];
      return (
        <span style={{ ...base, display: "flex", flexDirection: "column", gap: vao }}>
          {g === "colunas" ? (
            <>
              {fileira([r, d, r], [c.foto, c.fotoAlt, c.foto])}
              {fileira([r, r, r], [c.fotoAlt, c.foto, c.fotoAlt])}
            </>
          ) : (
            <>
              {fileira([d, r], [c.foto, c.fotoAlt])}
              {fileira([r, r, r], [c.fotoAlt, c.foto, c.fotoAlt])}
            </>
          )}
        </span>
      );
    }

    /* QUADRADA: tudo do mesmo tamanho. */
    return (
      <span
        style={{
          ...base,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gridTemplateRows: "1fr 1fr",
          gap: vao,
        }}
      >
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} style={{ background: i % 2 ? c.fotoAlt : c.foto, borderRadius: raio }} />
        ))}
      </span>
    );
  };

  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: c.fundo,
        border: `1px solid ${c.linha}`,
        borderRadius: "6px",
      }}
    >
      {capa()}
      {grade()}
    </span>
  );
}
