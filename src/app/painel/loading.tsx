import { Carregando } from "@/components/carregando";

/* Convenção do App Router: aparece na hora, enquanto o servidor monta a
 * página. O desenho — o átomo da marca em movimento — mora num lugar só,
 * src/components/carregando.tsx. */
export default function Loading() {
  return <Carregando />;
}
