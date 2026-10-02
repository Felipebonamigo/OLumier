/**
 * OS E-MAILS DA GALERIA — o que cada um diz, e como ele é desenhado.
 *
 * Juan, 01/10/2026: "ter templates prontos de entrega, mas também disponibilizar
 * modificações estéticas desse template (…) Talvez possamos desenvolver esse
 * sistema de REMEMBER, para os clientes sempre irem relembrando das fotos."
 *
 * ── POR QUE ISTO É `config/` E NÃO `lib/` ─────────────────────────────────
 *
 * Porque a tela do painel precisa dos nomes e das descrições dos templates para
 * oferecê-los, e ela é componente de cliente. Aqui não há banco, não há rede e
 * não há segredo: entra dado, sai HTML.
 *
 * ── O QUE É "MODIFICAÇÃO ESTÉTICA" AQUI ───────────────────────────────────
 *
 * Três desenhos prontos, e dentro de cada um a MARCA DO FOTÓGRAFO: a logo, a cor
 * de destaque e a foto de capa da galeria. É a mesma regra do produto inteiro —
 * a galeria tem de parecer da Sirius quando é da Sirius. Um seletor de doze
 * cores no e-mail daria ao fotógrafo a chance de contradizer a própria marca.
 *
 * ── POR QUE TABELA, E POR QUE ESTILO EM CADA TAG ──────────────────────────
 *
 * Gmail, Outlook e Apple Mail não concordam sobre flexbox, grid, `<style>` no
 * cabeçalho nem media query. Tabela com `style` em cada célula é feio de ler e é
 * o que chega igual nos três. Isto não é código de aplicação: é o formato que o
 * destino aceita.
 */

export type TipoDeEmail = "entrega" | "dia_do_evento" | "feedback" | "relembrar" | "um_ano";

export type TemplateDeEmail = "claro" | "escuro" | "editorial";

export const TEMPLATES: { id: TemplateDeEmail; nome: string; desc: string }[] = [
  { id: "claro", nome: "Claro", desc: "Fundo branco, foto grande, texto curto" },
  { id: "escuro", nome: "Escuro", desc: "Fundo preto, a foto é a única luz" },
  { id: "editorial", nome: "Editorial", desc: "Serifada, linha fina, cara de convite" },
];

export const TEMPLATE_PADRAO: TemplateDeEmail = "claro";

/** O template, se for um dos três. Lixo na coluna cai no padrão. */
export function lerTemplate(bruto: unknown): TemplateDeEmail {
  return TEMPLATES.some((t) => t.id === bruto) ? (bruto as TemplateDeEmail) : TEMPLATE_PADRAO;
}

/**
 * Os cinco e-mails, e QUANDO cada um sai.
 *
 * `diasDepoisDaEntrega` e `diasDepoisDoEvento` são exclusivos: um e-mail se
 * conta a partir da entrega (o feedback, que só faz sentido depois de a pessoa
 * ter visto as fotos) ou a partir do evento (os lembretes, que são sobre a data
 * do casamento). Quem agenda é `lib/emails-da-galeria.ts`.
 */
export const TIPOS: {
  id: TipoDeEmail;
  nome: string;
  desc: string;
  diasDepoisDaEntrega?: number;
  /** Dias a contar da data do evento. Negativo = antes. */
  diasDepoisDoEvento?: number;
}[] = [
  {
    id: "entrega",
    nome: "A galeria está pronta",
    desc: "Sai quando você manda. É a entrega.",
  },
  {
    id: "dia_do_evento",
    nome: "No dia do casamento",
    desc: "Uma mensagem no próprio dia, se a data estiver cadastrada e ainda não tiver passado.",
    diasDepoisDoEvento: 0,
  },
  {
    id: "feedback",
    nome: "Três meses depois: pedir um recado",
    desc: "Conta da entrega, não do evento — pedir recado de quem ainda não viu as fotos não faz sentido.",
    diasDepoisDaEntrega: 90,
  },
  {
    id: "relembrar",
    nome: "Seis meses depois do evento",
    desc: "Para o casal voltar e assistir de novo.",
    diasDepoisDoEvento: 182,
  },
  {
    id: "um_ano",
    nome: "Véspera de um ano",
    desc: "“Amanhã completa um ano” — por isso sai no dia 364, e não no 365.",
    diasDepoisDoEvento: 364,
  },
];

export interface DadosDoEmail {
  tipo: TipoDeEmail;
  template: TemplateDeEmail;
  /** Como chamar quem recebe. Vazio cai numa saudação sem nome. */
  nome: string | null;
  estudio: { nome: string; cor: string; logoUrl: string | null };
  galeria: { titulo: string; url: string; capaUrl: string | null; dataEvento: Date | null };
  /** O recado do fotógrafo no e-mail de entrega. Vazio usa o texto pronto. */
  mensagem: string | null;
  /**
   * As fotos mais baixadas, para os lembretes — "algo que destaque as fotos mais
   * baixadas talvez?". Vazio desenha o e-mail sem a faixa.
   */
  destaques: string[];
}

const FONTE_TEXTO =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const FONTE_SERIFADA = 'Georgia, "Times New Roman", Times, serif';

interface Paleta {
  fundo: string;
  cartao: string;
  texto: string;
  suave: string;
  linha: string;
  fonteTitulo: string;
  fonteTexto: string;
  /** Peso e espaçamento do título — é o que separa "Claro" de "Editorial". */
  tituloExtra: string;
}

function paleta(t: TemplateDeEmail): Paleta {
  if (t === "escuro") {
    return {
      fundo: "#0b0b0c",
      cartao: "#141416",
      texto: "#f3f3f4",
      suave: "#a0a0a8",
      linha: "#2a2a2e",
      fonteTitulo: FONTE_TEXTO,
      fonteTexto: FONTE_TEXTO,
      tituloExtra: "font-weight:600;letter-spacing:-0.4px;",
    };
  }
  if (t === "editorial") {
    return {
      fundo: "#f6f4ef",
      cartao: "#ffffff",
      texto: "#231f1a",
      suave: "#6b6257",
      linha: "#e2dcd1",
      fonteTitulo: FONTE_SERIFADA,
      fonteTexto: FONTE_SERIFADA,
      tituloExtra: "font-weight:400;letter-spacing:0.3px;",
    };
  }
  return {
    fundo: "#f4f5f7",
    cartao: "#ffffff",
    texto: "#17181b",
    suave: "#60636b",
    linha: "#e5e7eb",
    fonteTitulo: FONTE_TEXTO,
    fonteTexto: FONTE_TEXTO,
    tituloExtra: "font-weight:600;letter-spacing:-0.4px;",
  };
}

/** Escapa para HTML. O título da galeria e o recado são texto do fotógrafo. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "12 de outubro de 2025", no fuso do produto. */
function porExtenso(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

/**
 * O QUE CADA E-MAIL DIZ.
 *
 * Separado do desenho de propósito: a mesma frase tem de sair igual nos três
 * templates, e o dia em que alguém mexer no texto não pode ser o dia em que uma
 * das três versões fica para trás.
 *
 * O tom segue a `docs/estrategia-de-marca.md`: nada de "eternizar momentos",
 * "instantes eternos" nem "memórias para sempre". Frase direta, e o assunto diz
 * o que é — ninguém abre e-mail de fotógrafo com assunto misterioso.
 */
function conteudo(d: DadosDoEmail): { assunto: string; titulo: string; corpo: string[]; botao: string } {
  const quem = d.nome?.trim() ? `Oi, ${d.nome.trim()}` : "Oi";
  const evento = d.galeria.dataEvento ? porExtenso(d.galeria.dataEvento) : null;

  switch (d.tipo) {
    case "entrega":
      return {
        assunto: `${d.galeria.titulo} — suas fotos estão prontas`,
        titulo: d.galeria.titulo,
        corpo: [
          `${quem}, as fotos já estão na sua galeria.`,
          d.mensagem?.trim() ||
            "Dá para ver no celular ou no computador, baixar as que quiser e marcar as favoritas.",
        ],
        botao: "Ver as fotos",
      };
    case "dia_do_evento":
      return {
        assunto: `Hoje é o dia — ${d.galeria.titulo}`,
        titulo: "Hoje é o dia",
        corpo: [
          `${quem}! Hoje é o dia de vocês.`,
          "Aproveita cada minuto. As fotos chegam aqui depois — este é o endereço delas.",
        ],
        botao: "Guardar o link da galeria",
      };
    case "feedback":
      return {
        assunto: `${d.galeria.titulo} — conta pra gente o que você achou?`,
        titulo: "Como foi receber as fotos?",
        corpo: [
          `${quem}, faz três meses que a sua galeria ficou pronta.`,
          "Se sobrar um minuto, deixa um recado na galeria dizendo o que você achou. Ajuda muito.",
        ],
        botao: "Deixar um recado",
      };
    case "relembrar":
      return {
        assunto: `Seis meses de ${d.galeria.titulo}`,
        titulo: "Já faz seis meses",
        corpo: [
          evento ? `${quem}, seis meses desde ${evento}.` : `${quem}, já faz seis meses.`,
          "A galeria continua no mesmo lugar. Vale rever com calma.",
        ],
        botao: "Rever as fotos",
      };
    case "um_ano":
      return {
        assunto: `Amanhã faz um ano — ${d.galeria.titulo}`,
        titulo: "Amanhã faz um ano",
        corpo: [
          evento ? `${quem}, amanhã completa um ano de ${evento}.` : `${quem}, amanhã faz um ano.`,
          "Deixamos a galeria aqui, caso vocês queiram começar o dia por ela.",
        ],
        botao: "Abrir a galeria",
      };
  }
}

/** O e-mail pronto: assunto, HTML e a versão em texto puro. */
export function montarEmailDaGaleria(d: DadosDoEmail): {
  assunto: string;
  html: string;
  texto: string;
} {
  const p = paleta(d.template);
  const c = conteudo(d);
  const cor = /^#[0-9a-fA-F]{6}$/.test(d.estudio.cor) ? d.estudio.cor : p.texto;

  const logo = d.estudio.logoUrl
    ? `<img src="${esc(d.estudio.logoUrl)}" alt="${esc(d.estudio.nome)}" height="28" style="display:block;margin:0 auto;max-height:28px;border:0;">`
    : `<div style="font:600 13px/1.2 ${p.fonteTexto};letter-spacing:1.6px;text-transform:uppercase;color:${p.suave};text-align:center;">${esc(d.estudio.nome)}</div>`;

  const capa = d.galeria.capaUrl
    ? `<tr><td style="padding:0;"><a href="${esc(d.galeria.url)}" style="display:block;"><img src="${esc(d.galeria.capaUrl)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></a></td></tr>`
    : "";

  /* A faixa das mais baixadas — "algo que destaque as fotos mais baixadas". Três
     no máximo: quatro em tabela de 600px chegam a 140px e não se vê nada. */
  const destaques = d.destaques.slice(0, 3);
  const faixa =
    destaques.length === 0
      ? ""
      : `<tr><td style="padding:0 28px 24px;">
           <div style="font:600 11px/1.4 ${p.fonteTexto};letter-spacing:1.2px;text-transform:uppercase;color:${p.suave};padding-bottom:10px;">As mais baixadas</div>
           <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
             ${destaques
               .map(
                 (u, i) =>
                   `<td width="33%" style="padding-${i === destaques.length - 1 ? "left" : "right"}:${destaques.length > 1 ? "4px" : "0"};"><a href="${esc(d.galeria.url)}"><img src="${esc(u)}" alt="" width="180" style="display:block;width:100%;height:auto;border:0;border-radius:4px;"></a></td>`,
               )
               .join("")}
           </tr></table>
         </td></tr>`;

  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.assunto)}</title>
</head>
<body style="margin:0;padding:0;background:${p.fundo};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.corpo[0])}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${p.fundo};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:${p.cartao};border:1px solid ${p.linha};border-radius:8px;overflow:hidden;">
      <tr><td style="padding:28px 28px 20px;">${logo}</td></tr>
      ${capa}
      <tr><td style="padding:28px 28px 0;">
        <h1 style="margin:0;font:28px/1.25 ${p.fonteTitulo};${p.tituloExtra}color:${p.texto};">${esc(c.titulo)}</h1>
      </td></tr>
      ${c.corpo
        .map(
          (linha) =>
            `<tr><td style="padding:14px 28px 0;"><p style="margin:0;font:16px/1.6 ${p.fonteTexto};color:${p.suave};white-space:pre-wrap;">${esc(linha)}</p></td></tr>`,
        )
        .join("")}
      <tr><td style="padding:26px 28px 28px;">
        <a href="${esc(d.galeria.url)}" style="display:inline-block;padding:13px 26px;background:${cor};color:${d.template === "escuro" ? "#0b0b0c" : "#ffffff"};font:600 15px/1 ${p.fonteTexto};text-decoration:none;border-radius:6px;">${esc(c.botao)}</a>
      </td></tr>
      ${faixa}
      <tr><td style="padding:18px 28px 26px;border-top:1px solid ${p.linha};">
        <p style="margin:0;font:12px/1.6 ${p.fonteTexto};color:${p.suave};">
          Se o botão não funcionar, o endereço é:<br>
          <a href="${esc(d.galeria.url)}" style="color:${p.suave};">${esc(d.galeria.url)}</a>
        </p>
        <p style="margin:12px 0 0;font:12px/1.6 ${p.fonteTexto};color:${p.suave};">
          Este e-mail é de ${esc(d.estudio.nome)}, sobre as suas fotos. Para não receber os próximos, responda pedindo.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const texto = [
    c.titulo,
    "",
    ...c.corpo,
    "",
    `${c.botao}: ${d.galeria.url}`,
    "",
    `${d.estudio.nome}`,
  ].join("\n");

  return { assunto: c.assunto, html, texto };
}
