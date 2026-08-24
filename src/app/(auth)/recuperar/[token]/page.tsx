import type { Metadata } from "next";
import Link from "next/link";
import { MarcaLockup } from "@/components/marca-tile";
import { MINIMO_SENHA, conferirToken, type MotivoRecusa } from "@/lib/recuperacao";
import { FormNovaSenha } from "./form";

export const metadata: Metadata = {
  title: "Criar senha nova",
  robots: { index: false, follow: false },
};

/*
 * `force-dynamic` é obrigatório aqui: a validade do token muda com o tempo e com
 * o uso. Uma versão em cache diria "link válido" depois de ele ter sido gasto.
 */
export const dynamic = "force-dynamic";

const RECADOS: Record<MotivoRecusa, { titulo: string; texto: string }> = {
  inexistente: {
    titulo: "Link inválido",
    texto:
      "Esse endereço não corresponde a nenhum pedido. Confira se o link do e-mail veio inteiro — alguns aplicativos quebram links longos em duas linhas.",
  },
  expirado: {
    titulo: "Link vencido",
    texto: "O link vale por 1 hora. Peça um novo e ele chega em seguida.",
  },
  usado: {
    // Este caso merece um aviso, não só uma explicação: se a pessoa não usou o
    // link, alguém com acesso ao e-mail dela usou.
    titulo: "Link já usado",
    texto:
      "Esse link já serviu para trocar uma senha e não funciona de novo. Se não foi você quem trocou, peça um novo link agora e confira quem tem acesso ao seu e-mail.",
  },
};

export default async function NovaSenhaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resultado = await conferirToken(token);

  if (!resultado.ok) {
    const recado = RECADOS[resultado.motivo];
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
        <Link href="/" className="mb-10 self-start">
          <MarcaLockup />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{recado.titulo}</h1>
        <p className="mt-3 text-sm text-texto-soft">{recado.texto}</p>
        <p className="mt-8 text-sm text-texto-soft">
          <Link href="/recuperar" className="text-luz underline underline-offset-4">
            Pedir um link novo
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-10 self-start">
        <MarcaLockup />
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Criar senha nova</h1>
      <p className="mt-2 text-sm text-texto-soft">
        Para <strong className="text-texto">{resultado.pedido.nomeEstudio}</strong> ·{" "}
        {resultado.pedido.email}
      </p>

      <FormNovaSenha token={token} minimo={MINIMO_SENHA} />

      <p className="mt-6 text-xs text-texto-faint">
        Ao salvar, qualquer aparelho que estava logado nesta conta é desconectado.
      </p>
    </main>
  );
}
