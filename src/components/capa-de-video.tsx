"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { gerarDerivadas, type Derivadas } from "@/lib/derivadas-client";
import { esquecerMiniaturasDe } from "@/lib/miniaturas-do-painel";
import { reconhecerArquivo } from "@/lib/tipos-de-arquivo";
import { EscolherCena } from "@/components/escolher-cena";

/**
 * A capa de UM vídeo — escolhida do arquivo que está no computador.
 *
 * ── POR QUE DO DISCO, E NÃO DO ARMAZÉM ───────────────────────────────────
 *
 * O caminho que parece óbvio é ler o filme que já está guardado. Ele custa
 * caro e falha em silêncio: para tirar um quadro o navegador precisa BUSCAR
 * dentro do arquivo, e um vídeo com o índice no fim (o que a maioria das
 * câmeras grava) obriga a baixar o filme inteiro antes. Some a isso o CORS do
 * bucket e o canvas que fica contaminado por origem cruzada.
 *
 * Do disco não há nada disso: o filme nunca sai da máquina, e o que sobe é a
 * miniatura de ~50 KB. É a mesma arquitetura do envio normal — o arquivo não
 * passa pelo servidor.
 *
 * ── A CENA É DO FOTÓGRAFO (08/10/2026) ───────────────────────────────────
 *
 * Escolhido o filme, abre a janela de `escolher-cena.tsx`: ele passa pelo
 * filme, sorteia uma cena ou segue o "quadro automático" de sempre. Juan:
 * "existe a opção de a pessoa selecionar uma cena do próprio vídeo para ser
 * a capa?". O quadro escolhido sobe como imagem — o mesmo caminho do JPG que o
 * fotógrafo exporta —, e a duração do filme segue junto, como seguia.
 *
 * ── O MESMO SELETOR ACEITA IMAGEM ────────────────────────────────────────
 *
 * E é isso que dá saída ao caso sem saída. Se o navegador não abrir o codec, o
 * fotógrafo escolhe o JPG que ele mesmo exportou — que quase sempre é uma capa
 * melhor do que o quadro do segundo 1. `gerarDerivadas` já sabe tratar os dois
 * tipos, então não nasce derivação nova aqui.
 */
export function CapaDeVideo({
  mediaId,
  nome,
  capa,
}: {
  mediaId: string;
  nome: string;
  capa: string | null;
}) {
  const [estado, setEstado] = useState<"parado" | "gerando" | "enviando">("parado");
  const [erro, setErro] = useState<string | null>(null);
  /* O filme que está sendo escolhido, e o endereço local dele. O endereço nasce
     no clique e é revogado ao fechar — num efeito, o modo estrito do React o
     revogaria antes de a janela usá-lo. */
  const [cena, setCena] = useState<{ arquivo: File; url: string } | null>(null);
  const router = useRouter();
  const campo = `capa-${mediaId}`;

  function aoEscolher(arquivo: File) {
    if (reconhecerArquivo(arquivo.name, arquivo.type)?.tipo === "video") {
      setErro(null);
      setCena({ arquivo, url: URL.createObjectURL(arquivo) });
      return;
    }
    void enviar(() => gerarDerivadas(arquivo));
  }

  function fecharCena() {
    if (cena) URL.revokeObjectURL(cena.url);
    setCena(null);
  }

  /** `duracaoDoFilme` vence a da imagem: um quadro não sabe quanto o filme dura. */
  async function enviar(gerar: () => Promise<Derivadas | null>, duracaoDoFilme?: number) {
    setErro(null);
    setEstado("gerando");
    try {
      const derivadas = await gerar();
      if (!derivadas) {
        /*
         * A mensagem diz O QUE FAZER, e não só que falhou. Quem chega aqui é
         * quem tem um codec que o navegador não abre — e a saída dele é o
         * mesmo botão, com uma imagem no lugar do filme.
         */
        setErro(
          "Não consegui tirar um quadro deste arquivo. Escolha uma imagem (JPG ou PNG) para usar como capa.",
        );
        setEstado("parado");
        return;
      }

      setEstado("enviando");
      const pedido = await fetch(`/api/medias/${mediaId}/poster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!pedido.ok) throw new Error((await pedido.json()).erro ?? "Falha ao preparar o envio.");
      const { url, mime } = await pedido.json();

      /* O `Content-Type` é o que o servidor ASSINOU, e não `blob.type`: no
         Safari o canvas devolve PNG mesmo quando se pede WebP, e a assinatura
         cairia por causa de um cabeçalho que ninguém olhou. */
      const subida = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: derivadas.thumb,
      });
      if (!subida.ok) throw new Error("O envio da capa falhou.");

      const confirmacao = await fetch(`/api/medias/${mediaId}/poster`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          largura: derivadas.largura,
          altura: derivadas.altura,
          duracao: duracaoDoFilme ?? derivadas.duracao,
        }),
      });
      if (!confirmacao.ok) throw new Error((await confirmacao.json()).erro ?? "Falha ao gravar.");

      /* A capa nova mora na MESMA chave da antiga: sem isto, a aba Fotos
         continuaria mostrando a guardada. Ver `lib/miniaturas-do-painel.ts`. */
      esquecerMiniaturasDe(mediaId);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu certo. Tente de novo.");
    } finally {
      setEstado("parado");
    }
  }

  const ocupado = estado !== "parado";

  return (
    <div>
      <div className="aspect-video overflow-hidden rounded-md border border-linha bg-void">
        {capa ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
          <img src={capa} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-texto-faint">
            sem capa
          </div>
        )}
      </div>

      <p className="mt-2 truncate text-xs" title={nome}>
        {nome}
      </p>

      <button
        type="button"
        disabled={ocupado}
        onClick={() => document.getElementById(campo)?.click()}
        className="mt-2 w-full rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon disabled:opacity-50"
      >
        {estado === "gerando"
          ? "tirando o quadro…"
          : estado === "enviando"
            ? "enviando…"
            : capa
              ? "Trocar a capa"
              : "Escolher a capa"}
      </button>

      <input
        id={campo}
        type="file"
        /* Filme OU imagem, no mesmo seletor: é a saída de quem tem um codec que
           o navegador não abre. */
        accept="video/*,image/*"
        className="hidden"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = "";
          if (arquivo) aoEscolher(arquivo);
        }}
      />

      {erro && (
        <p role="alert" className="mt-2 text-[11px] text-alerta">
          {erro}
        </p>
      )}

      {cena && (
        <EscolherCena
          nome={nome}
          url={cena.url}
          aoCancelar={fecharCena}
          aoUsar={(quadro, duracao) => {
            fecharCena();
            void enviar(() => gerarDerivadas(quadro), duracao);
          }}
          aoAutomatico={() => {
            const filme = cena.arquivo;
            fecharCena();
            void enviar(() => gerarDerivadas(filme));
          }}
        />
      )}
    </div>
  );
}
