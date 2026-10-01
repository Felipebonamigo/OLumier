import type { Metadata } from "next";
import { METADADOS_DO_APP } from "@/config/app-instalado";
import { MINIMO_SENHA } from "@/lib/senha";
import Link from "next/link";
import { MarcaLockup } from "@/components/marca-tile";
import { marca } from "@/config/marca";
import { FormCadastrar } from "./form";

/* O ícone da tela de início e o app — ver `config/app-instalado.ts`. */
export const metadata: Metadata = { title: "Criar conta", ...METADADOS_DO_APP };

export default function CadastrarPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-10 self-start">
        <MarcaLockup />
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Criar sua conta</h1>
      <p className="mt-2 text-sm text-texto-soft">
        Suas galerias, com a sua marca. Sem limite de downloads.
      </p>

      {/* O selo no cabeçalho diz a palavra; aqui a palavra vira frase. É a
          última tela antes de alguém confiar a entrega de um cliente ao
          produto — se o aviso não couber aqui, não cabe em lugar nenhum. */}
      {marca.beta && (
        <p className="mt-5 rounded-lg border border-acento/30 bg-acento/5 px-4 py-3 text-sm leading-relaxed text-texto-soft">
          {marca.betaExplicacao}
        </p>
      )}

      {/*
        FORA do `if (beta)`, e é o ponto.

        Esta frase era a segunda metade do texto do beta. Desligar o beta um dia
        — uma linha em config/marca.ts — apagaria junto o aviso mais importante
        do produto, sem ninguém decidir isso. Ele não tem nada a ver com beta:
        vale enquanto o produto existir.
      */}
      <p className="mt-3 rounded-lg border border-linha bg-carbon px-4 py-3 text-sm leading-relaxed text-texto-soft">
        {marca.entregaNaoBackup}
      </p>

      <FormCadastrar minimo={MINIMO_SENHA} />

      {/*
        O ACEITE. Os Termos e a Privacidade existiam desde cedo e ninguém nunca
        os aceitou: só apareciam no rodapé das páginas institucionais, longe do
        momento em que alguém se compromete. Termo que a pessoa não viu na hora
        de decidir vale muito menos que um que ela viu, e a diferença entre os
        dois é esta frase.

        Sem caixinha de marcar, de propósito: uma caixa obrigatória que todo
        mundo marca sem ler não prova consentimento nenhum — só acrescenta um
        clique. A frase acima do botão, com os dois links abertos, informa mais.
      */}
      <p className="mt-4 text-xs leading-relaxed text-texto-faint">
        Ao criar a conta, você aceita os{" "}
        <Link href="/termos" className="text-texto-soft underline underline-offset-4">
          Termos de Uso
        </Link>{" "}
        e a{" "}
        <Link href="/privacidade" className="text-texto-soft underline underline-offset-4">
          Política de Privacidade
        </Link>
        .
      </p>

      <p className="mt-8 text-sm text-texto-soft">
        Já tem conta?{" "}
        <Link href="/entrar" className="text-acento underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </main>
  );
}
