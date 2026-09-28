import type { Aviso } from "./metricas-entrega";

/**
 * O E-MAIL SEMANAL DA ENTREGA — o que vai para os administradores quando o
 * bloco "Tráfego e custo da entrega" do painel tem aviso de ERRO.
 *
 * ── DE ONDE VEIO (24/09/2026) ─────────────────────────────────────────────
 *
 * Felipe: "vou ser avisado quando precisar aumentar o espaço?". Até aqui o
 * aviso só existia no painel, para quem abrisse a página — e o disco pequeno,
 * a franquia do B2 estourando ou o servidor de ZIP perto dos 20 TB são
 * exatamente as coisas que acontecem no mês em que ninguém olhou.
 *
 * Uma vez por semana o vigia do VPS pergunta a `scripts/avisos-da-entrega.mjs`
 * se há o que contar. Só erro vira e-mail: alerta fica no painel, porque um
 * e-mail semanal que chega sempre vira ruído, e o que vira ruído deixa de ser
 * lido justamente na semana em que importa.
 *
 * Puro de propósito: `testar-metricas-entrega.mjs` prende o texto.
 */

export interface RelatorioSemanal {
  assunto: string;
  texto: string;
}

export function relatorioDaEntrega(avisos: Aviso[], urlDoPainel: string): RelatorioSemanal | null {
  const erros = avisos.filter((a) => a.nivel === "erro");
  if (erros.length === 0) return null;
  const alertas = avisos.filter((a) => a.nivel === "alerta");

  const assunto =
    erros.length === 1
      ? "Galeria Átomo: 1 ponto da entrega precisa de ação"
      : `Galeria Átomo: ${erros.length} pontos da entrega precisam de ação`;

  const linhas = [
    "O resumo semanal do tráfego e do custo da entrega encontrou:",
    "",
    ...erros.map((e) => `• ${e.texto}`),
  ];
  if (alertas.length > 0) {
    linhas.push("", "Para acompanhar (ainda sem custo):", "", ...alertas.map((a) => `• ${a.texto}`));
  }
  linhas.push(
    "",
    `Painel, bloco "Tráfego e custo da entrega": ${urlDoPainel}`,
    "",
    "Este e-mail sai só quando há algo a fazer. Semana sem aviso de erro, semana sem e-mail.",
  );

  return { assunto, texto: linhas.join("\n") };
}
