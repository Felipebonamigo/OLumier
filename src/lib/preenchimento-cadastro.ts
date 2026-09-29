import { formatarDocumento, soDigitos } from "./documento";

/**
 * O cadastro que chega do Atomatiza já preenchido.
 *
 * Felipe, 28/09/2026: a aba Pagamentos do Atomatiza ganhou um botão que leva
 * direto para cá, com o CPF/CNPJ da empresa junto — é o elo entre as duas
 * contas, porque o combo acha a assinatura da outra plataforma pelo documento
 * (`lib/combo.ts`). Conta aberta aqui com outro documento nunca ganharia o
 * desconto.
 *
 * Os dados vêm no FRAGMENTO (`/cadastrar#documento=…&email=…&estudio=…`), e
 * isso é de propósito: o que vem depois do `#` não sai do navegador — não vai
 * na requisição nem fica no log de acesso do servidor. O CPF numa query ficaria
 * gravado no log do Caddy para sempre.
 *
 * É só conveniência: nada daqui é confiado. O formulário vai ao servidor como
 * qualquer outro, e `cadastrarAction` confere tudo de novo.
 */
export interface Preenchimento {
  documento: string;
  email: string;
  estudio: string;
  /** Veio pelo botão do Atomatiza — a tela diz uma frase a mais sobre o combo. */
  doAtomatiza: boolean;
}

const VAZIO: Preenchimento = { documento: "", email: "", estudio: "", doAtomatiza: false };

export function lerPreenchimento(fragmento: string): Preenchimento {
  const bruto = fragmento.startsWith("#") ? fragmento.slice(1) : fragmento;
  if (!bruto) return VAZIO;
  let f: URLSearchParams;
  try {
    f = new URLSearchParams(bruto);
  } catch {
    return VAZIO;
  }
  /* Tamanhos cortados: o fragmento é texto que qualquer um escreve num link, e
     o campo não precisa aceitar um livro. */
  const doc = soDigitos(f.get("documento") ?? "").slice(0, 14);
  return {
    documento: doc.length === 11 || doc.length === 14 ? formatarDocumento(doc) : doc,
    email: (f.get("email") ?? "").trim().slice(0, 200),
    estudio: (f.get("estudio") ?? "").trim().slice(0, 80),
    doAtomatiza: f.get("origem") === "atomatiza",
  };
}
