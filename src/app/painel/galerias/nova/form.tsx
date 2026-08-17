"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { criarGaleriaAction, type EstadoGaleria } from "../../actions";
import { Campo, Erro, BotaoEnviar } from "@/components/form-ui";

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Criar galeria</BotaoEnviar>;
}

export function FormNovaGaleria() {
  const [estado, action] = useActionState<EstadoGaleria, FormData>(criarGaleriaAction, {});

  return (
    <form action={action} className="mt-8 flex flex-col gap-4">
      <Campo
        label="Nome da galeria"
        name="titulo"
        required
        placeholder="Ana & Pedro"
        dica="É o que o cliente vê como título da entrega."
      />
      <Campo label="Local ou descrição" name="subtitulo" placeholder="Serra Gaúcha" />
      <Campo label="Data do evento" name="data_evento" type="date" />

      <Erro mensagem={estado.erro} />
      <Botao />
    </form>
  );
}
