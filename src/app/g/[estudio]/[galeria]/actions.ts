"use server";

import { revalidatePath } from "next/cache";
import {
  buscarGaleriaPublica,
  conferirSenhaGaleria,
  liberarAcesso,
} from "@/lib/galerias-publicas";
import { podeTentar, registrarErro, limparTentativas, emPalavras } from "@/lib/tentativas";

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

  /*
   * O freio é por GALERIA, não por visitante.
   *
   * Por IP seria mais gentil com o convidado que erra a senha, mas inútil contra
   * o ataque que importa: quem quer abrir a galeria à força troca de IP sem
   * esforço. Por galeria, o custo de tentar milhares de senhas some — e o casal
   * que digitou errado espera junto com os convidados, o que é o preço aceitável
   * de proteger as fotos do casamento deles.
   */
  const chave = `galeria:${galeria.id}`;
  const antes = podeTentar(chave);
  if (!antes.permitido) {
    return {
      erro: `Muitas tentativas. Tente de novo em ${emPalavras(antes.esperarSeg!)}.`,
    };
  }

  if (!conferirSenhaGaleria(senha, galeria.senha_hash)) {
    const depois = registrarErro(chave);
    if (!depois.permitido) {
      return {
        erro: `Muitas tentativas. Tente de novo em ${emPalavras(depois.esperarSeg!)}.`,
      };
    }
    return { erro: "Senha incorreta. Confira com quem enviou o link." };
  }

  limparTentativas(chave);
  await liberarAcesso(galeria.id);
  revalidatePath(`/g/${estudio}/${galeriaSlug}`);
  return {};
}
