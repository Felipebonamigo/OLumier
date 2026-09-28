"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { editarGaleriaAction, type EstadoGaleria } from "@/app/painel/actions";
import { Campo, Erro, BotaoEnviar } from "@/components/form-ui";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Salvar</BotaoEnviar>;
}

/**
 * Cabeçalho da galeria, com correção no lugar.
 *
 * Até aqui título, subtítulo e data só podiam ser definidos na criação. Um erro
 * de digitação no nome do casal — o tipo de coisa que se descobre depois de
 * mandar o link — só tinha uma saída: apagar a galeria e reenviar tudo.
 *
 * Fica fechado por padrão. A tela da galeria é usada o tempo todo para publicar
 * e enviar foto; corrigir o título é raro, e um formulário sempre aberto
 * roubaria espaço do que se faz todo dia.
 */
export function EditorGaleria({
  galeriaId,
  titulo,
  subtitulo,
  dataISO,
  dataFormatada,
}: {
  galeriaId: string;
  titulo: string;
  subtitulo: string | null;
  /** yyyy-mm-dd para o campo de data; null quando não há data. */
  dataISO: string | null;
  /** Já formatada em pt-BR para leitura. */
  dataFormatada: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, action] = useActionState<EstadoGaleria, FormData>(editarGaleriaAction, {});

  /*
   * Fecha sozinho SÓ quando a gravação deu certo.
   *
   * Fechar no submit seria mais simples e estaria errado: se a action recusasse
   * (título vazio, por exemplo), o formulário sumiria levando o erro junto e a
   * pessoa acharia que salvou.
   *
   * O ajuste é feito durante a render, comparando com o último estado já visto —
   * é o padrão que o React recomenda para reagir a uma mudança de valor. Num
   * efeito, o formulário chegaria a ser desenhado aberto antes de fechar, e o
   * lint reclama disso com razão.
   */
  const [estadoVisto, setEstadoVisto] = useState(estado);
  if (estado !== estadoVisto) {
    setEstadoVisto(estado);
    if (estado.ok) setAberto(false);
  }

  if (!aberto) {
    return (
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="text-xs text-texto-faint underline underline-offset-4 hover:text-texto"
          >
            editar
          </button>
        </div>
        <p className="mt-1 text-sm text-texto-soft">
          {[dataFormatada, subtitulo].filter(Boolean).join(" · ") || "sem data definida"}
        </p>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="w-full max-w-md rounded-xl border border-linha bg-carbon p-4"
    >
      <input type="hidden" name="galeria_id" value={galeriaId} />
      <div className="flex flex-col gap-3">
        <Campo label="Título" name="titulo" defaultValue={titulo} required maxLength={120} />
        {/* O MESMO NOME DA CRIAÇÃO (28/09/2026). Felipe: "depois que cria a
            galeria não tem como adicionar o local novamente" — tinha: é este
            campo, só que a criação o chama de "Local ou descrição" e aqui ele
            se chamava "Subtítulo". Campo com dois nomes parece dois campos. */}
        <Campo
          label="Local ou descrição"
          name="subtitulo"
          defaultValue={subtitulo ?? ""}
          maxLength={160}
          placeholder="Serra Gaúcha"
        />
        <Campo label="Data do evento" name="data_evento" type="date" defaultValue={dataISO ?? ""} />

        <p className="text-xs text-texto-faint">
          O endereço da galeria não muda — o link que você já mandou continua valendo.
        </p>

        <Erro mensagem={estado.erro} />

        <div className="flex items-center gap-3">
          <Botao />
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="text-sm text-texto-faint hover:text-texto"
          >
            cancelar
          </button>
        </div>
      </div>
    </form>
  );
}
