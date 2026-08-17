"use server";

import { revalidatePath } from "next/cache";
import {
  buscarGaleriaPublica,
  conferirSenhaGaleria,
  liberarAcesso,
} from "@/lib/galerias-publicas";

export interface EstadoSenha {
  erro?: string;
}

export async function entrarNaGaleriaAction(
  _estado: EstadoSenha,
  form: FormData,
): Promise<EstadoSenha> {
  const estudio = String(form.get("estudio") ?? "");
  const galeriaSlug = String(form.get("galeria") ?? "");
  const senha = String(form.get("senha") ?? "");

  const galeria = await buscarGaleriaPublica(estudio, galeriaSlug);
  if (!galeria) return { erro: "Galeria não encontrada." };
  if (!galeria.senha_hash) return {}; // não tem senha: nada a conferir

  if (!conferirSenhaGaleria(senha, galeria.senha_hash)) {
    return { erro: "Senha incorreta. Confira com quem enviou o link." };
  }

  await liberarAcesso(galeria.id);
  revalidatePath(`/g/${estudio}/${galeriaSlug}`);
  return {};
}
