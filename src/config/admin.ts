/**
 * Quem enxerga a visão de administrador.
 *
 * Vem de variável de ambiente, não de uma coluna no banco. A diferença importa:
 * uma coluna `admin` poderia ser ligada por um `update` errado, por um bug numa
 * tela de perfil, ou por quem conseguisse escrever no banco. A variável só muda
 * com acesso ao servidor — que é exatamente o poder que a visão concede.
 *
 * Vazia (o padrão) = ninguém é admin e a página não existe para nenhuma conta.
 *
 *   ADMINS=felipe@exemplo.com,carol@exemplo.com
 */

export function administradores(): string[] {
  return (process.env.ADMINS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Comparação por e-mail, sem diferenciar maiúsculas nem espaço em volta. */
export function ehAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const lista = administradores();
  if (lista.length === 0) return false;
  return lista.includes(email.trim().toLowerCase());
}
