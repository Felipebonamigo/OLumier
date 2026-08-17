/**
 * PLANOS E QUOTAS — espelham a planilha `planejamento/custos-validado-v7.xlsx`
 * do repositório `plataforma-galerias` (fonte da verdade comercial, 17/08/2026).
 *
 * Regras que vieram da análise de mercado e NÃO devem ser mexidas sem revisar a planilha:
 *  - acima de 2 TB de FOTO não competimos por preço (concorrente tem "ilimitado" a ~R$ 220);
 *  - vídeo é o filão: Pic-Time cobra R$ 275–468 pelas mesmas faixas;
 *  - 10 TB não vira plano de prateleira — é sob consulta.
 */

export type Segmento = "foto" | "filme";

export interface Plano {
  id: string;
  segmento: Segmento;
  nome: string;
  /** Espaço da galeria online, em GB. */
  quotaGb: number;
  /** Cofre incluso no pacote, em GB (0 = sem cofre; vendido como add-on). */
  cofreGb: number;
  /** Preço mensal em centavos de real — dinheiro nunca em float. */
  precoCentavos: number;
  destaque?: boolean;
}

export const planos: Plano[] = [
  {
    id: "foto-100",
    segmento: "foto",
    nome: "Foto 100 GB",
    quotaGb: 100,
    cofreGb: 500,
    precoCentavos: 9900,
  },
  {
    id: "foto-200",
    segmento: "foto",
    nome: "Foto 200 GB",
    quotaGb: 200,
    cofreGb: 1000,
    precoCentavos: 12900,
    destaque: true,
  },
  {
    id: "foto-500",
    segmento: "foto",
    nome: "Foto 500 GB",
    quotaGb: 500,
    cofreGb: 2000,
    precoCentavos: 17900,
  },
  {
    id: "filme-1000",
    segmento: "filme",
    nome: "Filme 1 TB",
    quotaGb: 1000,
    cofreGb: 3000,
    precoCentavos: 24900,
  },
  {
    id: "filme-2000",
    segmento: "filme",
    nome: "Filme 2 TB",
    quotaGb: 2000,
    cofreGb: 5000,
    precoCentavos: 34900,
  },
  {
    id: "filme-5000",
    segmento: "filme",
    nome: "Filme 5 TB",
    quotaGb: 5000,
    cofreGb: 10000,
    precoCentavos: 69900,
  },
];

export const planoPorId = (id: string) => planos.find((p) => p.id === id);

export const formatarReais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const GB = 1024 ** 3;
