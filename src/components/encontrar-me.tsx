"use client";

import { useRef, useState } from "react";

/**
 * "Encontrar as minhas fotos" — o lado do CONVIDADO.
 *
 * Ordem das coisas, e ela importa: primeiro o texto (o que acontece com a
 * selfie, o que a lei chama isso, com quem falar), DEPOIS a câmera. Quem
 * chega aqui já tem a galeria inteira aberta; a busca é um atalho opcional, e
 * dizer não tem de ser tão fácil quanto dizer sim.
 *
 * A selfie não sai do aparelho. O que sobe são os números — ver
 * `lib/rostos-client.ts`. Tudo aqui é pintado com o tema DA GALERIA (--g-*),
 * porque quem vê é o casal e a cara é a que o fotógrafo escolheu.
 */
export function EncontrarMe({
  galeriaId,
  nomeEstudio,
  contatoEstudio,
  encontradas,
  aoEncontrar,
}: {
  galeriaId: string;
  nomeEstudio: string;
  /** "WhatsApp (51) 9…", "contato@…" ou null quando o estúdio não preencheu. */
  contatoEstudio: string | null;
  /** Ids das fotos encontradas na última busca; null = sem filtro. */
  encontradas: Set<string> | null;
  aoEncontrar: (ids: Set<string> | null) => void;
}) {
  const [lendo, setLendo] = useState(false);
  const [estado, setEstado] = useState<"parado" | "preparando" | "medindo" | "buscando">("parado");
  const [aviso, setAviso] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function comSelfie(arquivo: File) {
    setAviso(null);
    setEstado("preparando");
    try {
      const { carregarModelos, medirSelfie } = await import("@/lib/rostos-client");
      await carregarModelos("convidado");

      setEstado("medindo");
      const r = await medirSelfie(arquivo);
      if (!r.ok) {
        setAviso(
          r.motivo === "sem-rosto"
            ? "Não achei um rosto na selfie. Tente de frente, com o rosto bem iluminado."
            : r.motivo === "rosto-pequeno"
              ? "O rosto ficou pequeno demais. Aproxime a câmera e tente de novo."
              : "Não consegui abrir essa imagem. Tente outra.",
        );
        return;
      }

      setEstado("buscando");
      const resposta = await fetch(`/api/g/${galeriaId}/rostos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vetores: r.vetores }),
      });
      if (!resposta.ok) throw new Error(String(resposta.status));
      const { fotos } = (await resposta.json()) as { fotos: { mediaId: string }[] };

      if (fotos.length === 0) {
        setAviso("Não encontramos você nas fotos. Pode tentar outra selfie, de frente e com luz.");
        return;
      }
      aoEncontrar(new Set(fotos.map((f) => f.mediaId)));
      setLendo(false);
    } catch {
      setAviso("Não consegui buscar agora. Confira sua conexão e tente de novo.");
    } finally {
      setEstado("parado");
    }
  }

  const ocupado = estado !== "parado";

  if (encontradas) {
    return (
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <span className="text-sm" style={{ color: "var(--g-texto)" }}>
          Você aparece em{" "}
          <strong style={{ color: "var(--g-destaque)" }}>
            {encontradas.size} {encontradas.size === 1 ? "foto" : "fotos"}
          </strong>
        </span>
        <button
          type="button"
          onClick={() => aoEncontrar(null)}
          className="rounded-[var(--g-pilula,9999px)] px-4 py-2 text-sm transition hover:opacity-85"
          style={{ border: "1px solid var(--g-linha)", color: "var(--g-suave)" }}
        >
          ver a galeria inteira
        </button>
        <button
          type="button"
          onClick={() => {
            setLendo(true);
            setAviso(null);
          }}
          className="text-xs underline underline-offset-4 transition hover:opacity-70"
          style={{ color: "var(--g-tenue)" }}
        >
          tentar outra selfie
        </button>
      </div>
    );
  }

  return (
    <>
      {!lendo && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setLendo(true)}
            className="rounded-[var(--g-pilula,9999px)] px-5 py-2.5 text-sm transition hover:opacity-85"
            style={{ border: "1px solid var(--g-linha)", color: "var(--g-texto)" }}
          >
            Encontrar as minhas fotos
          </button>
        </div>
      )}

      {lendo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Encontrar as suas fotos"
          className="fixed inset-0 z-50 flex items-end justify-center backdrop-blur sm:items-center"
          style={{ background: "color-mix(in srgb, var(--g-fundo) 80%, transparent)" }}
          onClick={() => !ocupado && setLendo(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl p-6 sm:rounded-2xl"
            style={{
              background: "var(--g-fundo)",
              color: "var(--g-texto)",
              border: "1px solid var(--g-linha)",
              paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-serif text-xl font-bold">Encontrar as suas fotos</h2>
            <p className="mt-2 text-sm" style={{ color: "var(--g-suave)" }}>
              Tire uma selfie e mostramos só as fotos em que você aparece. É opcional — a galeria
              inteira continua aberta para você do mesmo jeito.
            </p>
            <p className="mt-3 text-sm">
              <strong>A sua selfie não sai daqui.</strong> A medição do seu rosto acontece dentro
              deste aparelho, não é enviada para servidor nenhum, não é salva, e desaparece quando
              você fechar esta página. Nada seu fica guardado.
            </p>
            <p className="mt-3 text-sm" style={{ color: "var(--g-suave)" }}>
              A medição de um rosto é um dado biométrico, tratado pela lei como dado sensível. Por
              isso pedimos antes, e por isso é fácil dizer não.
            </p>
            <p className="mt-3 text-xs" style={{ color: "var(--g-tenue)" }}>
              Quem publicou esta galeria é {nomeEstudio}
              {contatoEstudio ? `, e é com ele que você fala sobre as suas fotos: ${contatoEstudio}.` : ", e é com ele que você fala sobre as suas fotos."}
            </p>

            {aviso && (
              <p className="mt-3 text-sm" style={{ color: "var(--g-destaque)" }}>
                {aviso}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={ocupado}
                onClick={() => setLendo(false)}
                className="rounded-[var(--g-pilula,9999px)] px-4 py-2 text-sm transition hover:opacity-85 disabled:opacity-50"
                style={{ border: "1px solid var(--g-linha)", color: "var(--g-suave)" }}
              >
                Ver a galeria inteira
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => inputRef.current?.click()}
                className="rounded-[var(--g-pilula,9999px)] px-5 py-2 text-sm font-semibold transition hover:opacity-85 disabled:opacity-60"
                style={{ background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
              >
                {estado === "preparando"
                  ? "Preparando… (baixa uns 7 MB)"
                  : estado === "medindo"
                    ? "Medindo o rosto…"
                    : estado === "buscando"
                      ? "Procurando…"
                      : "Concordo — tirar selfie"}
              </button>
            </div>

            {/*
              `capture="user"` abre a câmera FRONTAL direto no celular. No
              computador vira um seletor de arquivo — quem está no notebook
              escolhe uma foto sua. Os dois caminhos chegam ao mesmo lugar.
            */}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void comSelfie(f);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
