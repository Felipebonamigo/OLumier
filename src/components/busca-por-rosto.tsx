"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  desligarBuscaPorRostoAction,
  fotosSemRostoAction,
  ligarBuscaPorRostoAction,
} from "@/app/painel/actions";
import { marca } from "@/config/marca";

/**
 * A busca por rosto, do lado do FOTÓGRAFO: ligar (com o consentimento), medir
 * as fotos que já estavam na galeria, e desligar (que apaga tudo).
 *
 * O texto de consentimento fica aqui, no componente, e não num arquivo de
 * textos: ele é a razão de existir desta tela, e quem mexer nele precisa ver
 * ao lado o que o botão faz.
 */
export function BuscaPorRosto({
  galeriaId,
  ativa,
  ligadaEm,
  rostos,
  fotosComRosto,
  fotosSemMedir,
}: {
  galeriaId: string;
  ativa: boolean;
  /** Quando o fotógrafo aceitou — já formatada. Null enquanto desligada. */
  ligadaEm: string | null;
  rostos: number;
  fotosComRosto: number;
  /** Fotos da galeria que ainda não passaram pela medição. */
  fotosSemMedir: number;
}) {
  const [lendo, setLendo] = useState(false);
  const [aceito, setAceito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const [medindo, setMedindo] = useState<{ feitas: number; total: number; aviso?: string } | null>(
    null,
  );
  const router = useRouter();

  function ligar() {
    const f = new FormData();
    f.set("galeria_id", galeriaId);
    f.set("aceito", aceito ? "1" : "0");
    iniciar(async () => {
      const r = await ligarBuscaPorRostoAction(f);
      if (r?.erro) {
        setErro(r.erro);
        return;
      }
      setLendo(false);
      setAceito(false);
      router.refresh();
    });
  }

  function desligar() {
    if (
      !confirm(
        `Desligar a busca por rosto?\n\nOs ${rostos} códigos de rosto desta galeria serão apagados agora. Para ligar de novo, as fotos precisarão ser medidas outra vez.`,
      )
    ) {
      return;
    }
    const f = new FormData();
    f.set("galeria_id", galeriaId);
    iniciar(async () => {
      await desligarBuscaPorRostoAction(f);
      router.refresh();
    });
  }

  /**
   * Mede, no navegador, as fotos que já estavam na galeria. Baixa a prévia de
   * cada uma, acha os rostos, e manda só os números. A foto não passa pelo
   * servidor — nem para isto.
   */
  async function medirAsAntigas() {
    setErro(null);
    setMedindo({ feitas: 0, total: 0 });
    try {
      const { carregarModelos, medirRostos, backendEmUso } = await import("@/lib/rostos-client");
      await carregarModelos("fotografo");
      const aviso =
        backendEmUso() === "webgl"
          ? undefined
          : "este computador está sem aceleração gráfica: cada foto leva uns 12 segundos";

      const fotos = await fotosSemRostoAction(galeriaId);
      setMedindo({ feitas: 0, total: fotos.length, aviso });

      let feitas = 0;
      for (const foto of fotos) {
        try {
          const resposta = await fetch(foto.url);
          if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
          const bitmap = await createImageBitmap(await resposta.blob());
          let achados;
          try {
            achados = await medirRostos(bitmap);
          } finally {
            bitmap.close();
          }
          // Foto sem rosto também é gravada (lista vazia): sai da fila de pendentes.
          await fetch(`/api/medias/${foto.id}/rostos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rostos: achados }),
          });
        } catch {
          /* Uma foto que falhou não para as outras; ela continua pendente e
           * aparece de novo na próxima passada. */
        }
        feitas++;
        setMedindo({ feitas, total: fotos.length, aviso });
      }
      router.refresh();
    } catch (e) {
      setErro(
        e instanceof Error && /WebGL|backend|tensor/i.test(e.message)
          ? "Não consegui iniciar o reconhecimento neste navegador. Tente no Chrome, com aceleração gráfica ligada."
          : "Não consegui medir agora. Confira a conexão e tente de novo.",
      );
    } finally {
      setMedindo(null);
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Busca por rosto</h2>
        <span className={`text-xs font-medium ${ativa ? "text-ok" : "text-texto-faint"}`}>
          {ativa ? "ligada" : "desligada"}
        </span>
      </div>
      <p className="mt-0.5 max-w-[60ch] text-xs text-texto-faint">
        Seu cliente tira uma selfie e a galeria mostra só as fotos em que ele aparece. Útil em
        formatura, corporativo e casamento grande, onde ninguém rola 800 fotos atrás de si mesmo.
      </p>

      {!ativa && !lendo && (
        <button
          type="button"
          onClick={() => setLendo(true)}
          className="mt-4 rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2"
        >
          Ligar a busca por rosto
        </button>
      )}

      {!ativa && lendo && (
        /*
         * O CONSENTIMENTO. O texto diz o que é guardado (um código, não o
         * rosto), onde a medição acontece (no navegador dele), o que a lei
         * chama isso (dado sensível), e o que ele declara ao ligar. A caixa de
         * aceite é obrigatória e é conferida de novo no servidor.
         */
        <div className="mt-4 rounded-lg border border-linha-forte bg-void p-4 text-sm">
          <p>
            Para isso, o sistema mede os rostos das fotos desta galeria e guarda um{" "}
            <strong>código numérico</strong> de cada um — não guarda recorte de rosto, e a medição
            acontece <strong>no seu navegador</strong>, durante o envio. A selfie do seu cliente
            também é medida no aparelho dele e nunca sai de lá.
          </p>
          <p className="mt-3">
            Esse código é <strong>dado biométrico</strong>, e a lei (LGPD, art. 11) trata como dado
            sensível. Ao ligar, você declara que:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-texto-soft">
            <li>
              é você quem decide o que fotografar e publicar — o {marca.nome} só executa;
            </li>
            <li>
              você tem, ou vai obter, autorização das pessoas fotografadas para este uso
              específico;
            </li>
            <li>cada convidado ainda vai dar o consentimento dele antes de usar a busca — nós pedimos.</li>
          </ul>
          <p className="mt-3 text-texto-soft">
            Pode desligar quando quiser. Ao desligar, todos os códigos desta galeria são apagados,
            e a busca some para o cliente.
          </p>

          <label className="mt-4 flex items-start gap-3">
            <input
              type="checkbox"
              checked={aceito}
              onChange={(e) => setAceito(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[color:var(--acento)]"
            />
            <span className="text-sm">Li e aceito as condições acima.</span>
          </label>

          {erro && <p className="mt-3 text-xs text-erro">{erro}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setLendo(false);
                setAceito(false);
                setErro(null);
              }}
              className="rounded-lg border border-linha px-4 py-2 text-sm text-texto-soft transition hover:bg-carbon-2"
            >
              Agora não
            </button>
            <button
              type="button"
              disabled={!aceito || salvando}
              onClick={ligar}
              className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-40"
            >
              {salvando ? "Ligando…" : "Ligar a busca por rosto"}
            </button>
          </div>
        </div>
      )}

      {ativa && (
        <div className="mt-4">
          <p className="text-sm">
            <strong>{rostos}</strong> {rostos === 1 ? "rosto" : "rostos"} em{" "}
            <strong>{fotosComRosto}</strong> {fotosComRosto === 1 ? "foto" : "fotos"}
            {ligadaEm && <span className="text-texto-faint"> · ligada em {ligadaEm}</span>}
          </p>
          <p className="mt-1 max-w-[60ch] text-xs text-texto-faint">
            As fotos que você enviar a partir de agora são medidas durante o envio, no arquivo
            original. Rostos menores que uns 60 pixels ficam de fora — de longe, ninguém se acha
            mesmo.
          </p>

          {fotosSemMedir > 0 && !medindo && (
            <div className="mt-4 rounded-lg border border-linha bg-void p-3">
              <p className="text-sm">
                {fotosSemMedir} {fotosSemMedir === 1 ? "foto ainda não foi medida" : "fotos ainda não foram medidas"}.
              </p>
              <p className="mt-1 text-xs text-texto-faint">
                São as que já estavam aqui antes de ligar. A medição usa a prévia de cada foto e
                roda neste computador — uns 2 segundos por foto com placa de vídeo. Deixe a aba
                aberta.
              </p>
              <button
                type="button"
                onClick={medirAsAntigas}
                className="mt-3 rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto"
              >
                Medir as {fotosSemMedir} fotos
              </button>
            </div>
          )}

          {medindo && (
            <div className="mt-4 rounded-lg border border-linha bg-void p-3">
              <p className="text-sm">
                {medindo.total === 0
                  ? "Preparando…"
                  : `Medindo ${medindo.feitas} de ${medindo.total}… mantenha esta aba aberta.`}
              </p>
              {medindo.aviso && <p className="mt-1 text-xs text-alerta">{medindo.aviso}</p>}
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-carbon-2">
                <div
                  className="h-full rounded-full bg-acento transition-[width]"
                  style={{
                    width: `${medindo.total ? (medindo.feitas / medindo.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}

          {erro && <p className="mt-3 text-xs text-erro">{erro}</p>}

          <button
            type="button"
            disabled={salvando || Boolean(medindo)}
            onClick={desligar}
            className="mt-4 text-xs text-texto-faint underline underline-offset-4 transition hover:text-erro disabled:opacity-40"
          >
            desligar e apagar os códigos de rosto
          </button>
        </div>
      )}
    </section>
  );
}
