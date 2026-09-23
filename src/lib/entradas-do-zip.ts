import { GRUPO_SEM_CAPITULO } from "./nome-de-arquivo";
import type { Entrega, MediaDaEntrega } from "./entrega-da-galeria";

/**
 * O QUE VAI DENTRO DO ZIP — nome de cada entrada e nome do arquivo.
 *
 * Nasceu dentro de `api/g/[id]/zip` e saiu de lá em 23/09/2026 porque passou
 * a ter dois leitores: a própria rota (o caminho de reserva, que monta o ZIP
 * no VPS) e o MANIFESTO que o servidor de ZIP busca. Dois lugares decidindo
 * como se chama a segunda "DSC_0001.jpg" divergiriam, e o casal receberia
 * nomes diferentes conforme a máquina que montou o arquivo.
 *
 * Puro: recebe a entrega já resolvida e devolve nomes. `scripts/testar-
 * entradas-do-zip.mjs` prende os casos.
 */

export interface EntradaDoZip {
  /** Caminho dentro do zip. Barra vira pasta: "Festa/brinde.jpg". */
  nome: string;
  tamanho: number;
  media: MediaDaEntrega;
}

/**
 * Nome único dentro do zip.
 *
 * Duas fotos "DSC_0001.jpg" no mesmo capítulo são comuns — câmera reiniciada,
 * dois fotógrafos. Dentro de um zip, nome repetido faz o descompactador
 * sobrescrever uma com a outra ou perguntar o que fazer para cada uma, e o
 * casal perde foto sem saber. A segunda vira "DSC_0001 (2).jpg".
 */
export function nomeUnico(nome: string, usados: Set<string>): string {
  if (!usados.has(nome.toLowerCase())) {
    usados.add(nome.toLowerCase());
    return nome;
  }
  const ponto = nome.lastIndexOf(".");
  const base = ponto > 0 ? nome.slice(0, ponto) : nome;
  const ext = ponto > 0 ? nome.slice(ponto) : "";
  for (let n = 2; ; n++) {
    const tentativa = `${base} (${n})${ext}`;
    if (!usados.has(tentativa.toLowerCase())) {
      usados.add(tentativa.toLowerCase());
      return tentativa;
    }
  }
}

/** Pasta ou nome de arquivo sem os caracteres que o Windows recusa. */
export const semProibidos = (s: string) =>
  s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

export function entradasDoZip(entrega: Entrega): { nomeDoZip: string; arquivos: EntradaDoZip[] } {
  const nomeDoCapitulo = new Map(
    [...entrega.capitulos].map(([cid, nome]) => [cid, semProibidos(nome)]),
  );
  /* Pasta por capítulo só no zip da galeria inteira: num zip de UM capítulo a
     pasta seria um nível a mais para abrir sem motivo. */
  const comPastas = entrega.tipo === "tudo" && entrega.capitulos.size > 0;

  const usados = new Set<string>();
  const arquivos = entrega.fotos.map((m) => {
    /* A pasta das soltas tem o nome que o fotógrafo deu (migração 037), e ele
       passa pela MESMA limpeza dos capítulos: é um nome de pasta dentro do zip,
       e o Windows recusa os mesmos caracteres nos dois. */
    const pasta = comPastas
      ? ((m.secao_id ? nomeDoCapitulo.get(m.secao_id) : null) ??
        (semProibidos(entrega.grupoSolto) || GRUPO_SEM_CAPITULO))
      : "";
    const nome = semProibidos(m.nome_original) || `${m.id}.jpg`;
    return {
      nome: nomeUnico(pasta ? `${pasta}/${nome}` : nome, usados),
      tamanho: Number(m.bytes),
      media: m,
    };
  });

  const sufixo = semProibidos(entrega.sufixo.replace(/^ - /, ""));
  const nomeDoZip = `${semProibidos(entrega.titulo) || "galeria"}${sufixo ? ` - ${sufixo}` : ""}.zip`;

  return { nomeDoZip, arquivos };
}
