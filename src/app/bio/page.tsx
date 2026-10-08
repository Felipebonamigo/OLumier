import { METADADOS_DA_BIO, PaginaDaBio } from "./pagina";

/**
 * A PÁGINA-PONTE DO INSTAGRAM — `/bio`. O corpo, o porquê de cada escolha e as
 * regras de indexação estão em `pagina.tsx`; o endereço limpo para colar na
 * bio do Instagram é `/bio/instagram` (`app/bio/[canal]/page.tsx`).
 */
export const metadata = METADADOS_DA_BIO;

export default function BioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PaginaDaBio searchParams={searchParams} />;
}
