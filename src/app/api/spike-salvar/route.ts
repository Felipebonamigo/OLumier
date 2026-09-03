import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/*
 * ROTA DESCARTÁVEL, SÓ DE DESENVOLVIMENTO. Existe para uma coisa: o spike de
 * rosto recorta caras dentro do navegador, e eu preciso OLHAR esses recortes
 * para dizer se duas caixas são a mesma pessoa. Sem isso a análise vira chute —
 * e chute sobre identidade já errou duas vezes neste trabalho.
 *
 * Sai junto com o spike. Não vai para produção: o `NODE_ENV` fecha a porta, e
 * o diretório de destino é fixo, então nada aqui aceita caminho de fora.
 */

const DESTINO = path.join(
  process.env.TEMP ?? "/tmp",
  "claude",
  "spike-rostos",
);

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response("não existe em produção", { status: 404 });
  }

  const { nome, dataUrl } = (await req.json()) as { nome: string; dataUrl: string };

  // O nome vem do próprio spike, mas é tratado como hostil: só o miolo seguro
  // sobrevive, então nenhum "../" pode escapar do diretório.
  const seguro = nome.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

  await mkdir(DESTINO, { recursive: true });
  const destino = path.join(DESTINO, seguro);
  await writeFile(destino, Buffer.from(base64, "base64"));

  return Response.json({ salvo: destino });
}
