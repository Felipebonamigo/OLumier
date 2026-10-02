import type { Metadata } from "next";
import Link from "next/link";
import { MarcaLockup } from "@/components/marca-tile";
import { confirmarEmail } from "@/lib/confirmacao-email";

export const metadata: Metadata = {
  title: "Confirmar e-mail",
  robots: { index: false, follow: false },
};

/*
 * `force-dynamic`, como em `/recuperar/[token]`: a resposta muda com o uso do
 * link, e uma versão em cache diria "confirmado" para um link que nunca foi.
 *
 * Confirmar no GET é de propósito. O link sai por e-mail e é aberto de um
 * toque no celular; pedir um segundo clique numa página que só diz "clique
 * aqui" não protege nada — o que o link prova é que o e-mail chegou, e
 * chegou. Ver `lib/confirmacao-email.ts`.
 */
export const dynamic = "force-dynamic";

const RECADOS = {
  inexistente: {
    titulo: "Link inválido",
    texto:
      "Esse endereço não corresponde a nenhum pedido. Confira se o link do e-mail veio inteiro — alguns aplicativos quebram links longos em duas linhas.",
  },
  expirado: {
    titulo: "Link vencido",
    texto: "O link vale por 7 dias. Entre no painel e peça outro — ele chega em seguida.",
  },
  usado: {
    titulo: "Existe um link mais novo",
    texto:
      "Depois deste, outro link de confirmação foi pedido, e só o mais recente vale. Procure o último e-mail — ou entre no painel e peça mais um.",
  },
} as const;

export default async function ConfirmarEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resultado = await confirmarEmail(token);

  const titulo = resultado.ok ? "E-mail confirmado" : RECADOS[resultado.motivo].titulo;
  const texto = resultado.ok
    ? `Pronto: ${resultado.nomeEstudio} já pode enviar fotos e vídeos.`
    : RECADOS[resultado.motivo].texto;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-10 self-start">
        <MarcaLockup />
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
      <p className="mt-3 text-sm text-texto-soft">{texto}</p>
      <p className="mt-8 text-sm text-texto-soft">
        <Link href="/painel" className="text-acento underline underline-offset-4">
          Ir para o painel
        </Link>
      </p>
    </main>
  );
}
