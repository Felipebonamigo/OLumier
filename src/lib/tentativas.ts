import "server-only";

/**
 * Limite de tentativas para senha — do fotógrafo e da galeria.
 *
 * Sem isto, dava para testar senha à vontade. A senha da galeria é o caso mais
 * exposto: costuma ser curta ("anaepedro"), o link circula em grupo de WhatsApp,
 * e sem freio um script tenta milhares por minuto até abrir o casamento inteiro.
 *
 * Guardado em MEMÓRIA, de propósito:
 *   - é um só processo (systemd, uma instância) — um Map basta;
 *   - gravar no Postgres faria cada tentativa errada custar uma escrita, o que
 *     transforma o próprio freio numa forma de sobrecarregar o banco;
 *   - reiniciar o app zera a contagem, e tudo bem: o reinício é raro e não é
 *     algo que o atacante controle.
 *
 * Se um dia rodar em mais de uma instância, isto vira Redis — e o comentário
 * acima é o aviso de que a decisão foi consciente, não esquecimento.
 */

interface Registro {
  erros: number;
  /** Quando a contagem expira, em ms desde a época. */
  expiraEm: number;
  /** Enquanto isto for futuro, nem confere a senha. */
  bloqueadoAte?: number;
}

const registros = new Map<string, Registro>();

/** Depois de tantos erros seguidos, espera. */
const LIMITE = 8;
/** Janela em que os erros se acumulam. */
const JANELA_MS = 15 * 60 * 1000;
/** Quanto tempo fica travado ao estourar o limite. */
const CASTIGO_MS = 15 * 60 * 1000;
/** Acima disto o Map é varrido — evita crescer sem limite com chaves velhas. */
const LIMPAR_ACIMA_DE = 5000;

function limparVencidos(agora: number) {
  for (const [chave, r] of registros) {
    if (r.expiraEm < agora && (r.bloqueadoAte ?? 0) < agora) registros.delete(chave);
  }
}

export interface Veredito {
  permitido: boolean;
  /** Segundos que faltam para poder tentar de novo. */
  esperarSeg?: number;
}

/** Chamar ANTES de conferir a senha. */
export function podeTentar(chave: string): Veredito {
  const agora = Date.now();
  const r = registros.get(chave);
  if (!r) return { permitido: true };

  if (r.bloqueadoAte && r.bloqueadoAte > agora) {
    return { permitido: false, esperarSeg: Math.ceil((r.bloqueadoAte - agora) / 1000) };
  }
  if (r.expiraEm < agora) {
    registros.delete(chave);
    return { permitido: true };
  }
  return { permitido: true };
}

/** Chamar quando a senha estiver ERRADA. */
export function registrarErro(chave: string): Veredito {
  const agora = Date.now();
  if (registros.size > LIMPAR_ACIMA_DE) limparVencidos(agora);

  const r = registros.get(chave);
  if (!r || r.expiraEm < agora) {
    registros.set(chave, { erros: 1, expiraEm: agora + JANELA_MS });
    return { permitido: true };
  }

  r.erros += 1;
  if (r.erros >= LIMITE) {
    r.bloqueadoAte = agora + CASTIGO_MS;
    r.erros = 0;
    r.expiraEm = agora + CASTIGO_MS;
    return { permitido: false, esperarSeg: Math.ceil(CASTIGO_MS / 1000) };
  }
  return { permitido: true };
}

/** Chamar quando a senha estiver CERTA — quem acertou não carrega o histórico. */
export function limparTentativas(chave: string) {
  registros.delete(chave);
}

/** "faltam 12 minutos" soa melhor que "faltam 743 segundos". */
export function emPalavras(segundos: number): string {
  const min = Math.ceil(segundos / 60);
  if (min <= 1) return "um minuto";
  return `${min} minutos`;
}
