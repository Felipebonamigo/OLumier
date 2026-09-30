/**
 * A configuração do servidor de ZIP — tudo vem do ambiente, e cada valor tem
 * um padrão que funciona numa máquina limpa.
 *
 *   ZIP_APP_URL            onde o app atende (https://galeriaatomo.com.br)
 *   ZIP_SEGREDO            o mesmo ZIP_SEGREDO do app, 32+ caracteres
 *   ZIP_PORTA              porta local; o Caddy fica na frente (padrão 3400)
 *   ZIP_CACHE_DIR          onde os ZIPs prontos ficam (padrão /var/lib/fotonio-zip)
 *   ZIP_CACHE_DIAS         dias sem pedido até apagar um ZIP pronto (padrão 14)
 *   ZIP_CACHE_MAX_GB       teto do disco; passou, apaga o mais antigo (padrão 150)
 *   ZIP_BUSCAS_PARALELAS   quantos originais descem à frente, ao mesmo tempo (padrão 8)
 *   ZIP_MEMORIA_A_FRENTE_MB  teto de memória dessas buscas (padrão 256)
 */

function inteiro(nome: string, padrao: number): number {
  const v = Number(process.env[nome]);
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

export const CONFIG = {
  appUrl: (process.env.ZIP_APP_URL ?? "").replace(/\/+$/, ""),
  segredo: process.env.ZIP_SEGREDO ?? "",
  porta: inteiro("ZIP_PORTA", 3400),
  cacheDir: process.env.ZIP_CACHE_DIR ?? "/var/lib/fotonio-zip",
  cacheDias: inteiro("ZIP_CACHE_DIAS", 14),
  cacheMaxBytes: inteiro("ZIP_CACHE_MAX_GB", 150) * 1024 ** 3,
  buscasParalelas: inteiro("ZIP_BUSCAS_PARALELAS", 8),
  memoriaAFrente: inteiro("ZIP_MEMORIA_A_FRENTE_MB", 256) * 1024 * 1024,
};

export function conferirConfig(): string[] {
  const faltas: string[] = [];
  if (!CONFIG.appUrl) faltas.push("ZIP_APP_URL");
  if (CONFIG.segredo.length < 32) faltas.push("ZIP_SEGREDO (32+ caracteres)");
  return faltas;
}
