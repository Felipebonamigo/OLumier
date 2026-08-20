/**
 * CPF / CNPJ.
 *
 * Validar aqui não é burocracia: o Asaas recusa documento inválido com uma
 * mensagem em inglês vinda da API deles, e a pessoa ficaria olhando um erro que
 * não explica nada. Melhor dizer "esse CPF não confere" antes de sair do app.
 *
 * Mesmo algoritmo já em produção no Atomatiza (movimento-atomo/src/lib/subconta.ts).
 */

export const soDigitos = (v: string) => v.replace(/\D/g, "");

/** 111.111.111-11 passa no cálculo do dígito, mas não existe. */
const repetido = (d: string) => /^(\d)\1+$/.test(d);

export function cpfValido(documento: string): boolean {
  const d = soDigitos(documento);
  if (d.length !== 11 || repetido(d)) return false;
  for (const casas of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < casas; i++) soma += Number(d[i]) * (casas + 1 - i);
    const resto = (soma * 10) % 11;
    if ((resto === 10 ? 0 : resto) !== Number(d[casas])) return false;
  }
  return true;
}

export function cnpjValido(documento: string): boolean {
  const d = soDigitos(documento);
  if (d.length !== 14 || repetido(d)) return false;
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const casas of [12, 13]) {
    // O primeiro dígito usa doze pesos; o segundo, treze — por isso a fatia.
    const p = pesos.slice(13 - casas);
    let soma = 0;
    for (let i = 0; i < casas; i++) soma += Number(d[i]) * p[i];
    const resto = soma % 11;
    if ((resto < 2 ? 0 : 11 - resto) !== Number(d[casas])) return false;
  }
  return true;
}

/** Aceita os dois: o estúdio pode ser pessoa física ou ter CNPJ. */
export function documentoValido(documento: string): boolean {
  const d = soDigitos(documento);
  return d.length === 14 ? cnpjValido(d) : cpfValido(d);
}

/** Mensagem específica — "documento inválido" não ajuda ninguém a consertar. */
export function conferirDocumento(documento: string): string | null {
  const d = soDigitos(documento);
  if (!d) return "Informe o CPF ou CNPJ do titular da conta.";
  if (d.length !== 11 && d.length !== 14) {
    return "O CPF tem 11 dígitos e o CNPJ tem 14 — confira o que você digitou.";
  }
  if (d.length === 11 && !cpfValido(d)) return "Esse CPF não confere — verifique os números.";
  if (d.length === 14 && !cnpjValido(d)) return "Esse CNPJ não confere — verifique os números.";
  return null;
}

export function formatarDocumento(documento: string): string {
  const d = soDigitos(documento);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return documento;
}
