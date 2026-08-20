import Link from "next/link";
import { MarcaLockup } from "@/components/marca-tile";

/**
 * 404. Chega bastante gente aqui por link de galeria digitado errado ou já
 * removida — por isso o texto fala de galeria, e não "página não encontrada".
 */
export default function NaoEncontrado() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
      <div className="flex justify-center">
        <MarcaLockup />
      </div>
      <h1 className="mt-10 font-serif text-2xl font-bold">Não encontramos esta página</h1>
      <p className="mt-3 text-sm text-texto-soft">
        O endereço pode ter sido digitado com uma letra a mais, ou a galeria pode ter saído do ar.
        Se alguém te mandou este link, vale conferir com quem enviou.
      </p>
      <Link
        href="/"
        className="mt-8 inline-block self-center rounded-full border border-linha px-5 py-2.5 text-sm transition hover:border-linha-forte"
      >
        Ir para o início
      </Link>
    </main>
  );
}
