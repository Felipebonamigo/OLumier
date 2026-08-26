#!/usr/bin/env node
/**
 * Testa a decisão sobre envio pendente. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-pendentes.mjs
 *
 * A linha em `medias` nasce com `pronto = false` para reservar quota antes do
 * envio começar. Quando ela fica parada, alguém precisa decidir entre duas
 * coisas MUITO diferentes:
 *
 *   RESGATAR — o arquivo chegou ao armazém e só a confirmação se perdeu.
 *              Confirma com o tamanho real e a foto aparece para o cliente.
 *   REMOVER  — o envio foi abandonado. Apaga a linha e devolve a quota.
 *
 * ── O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR (26/08/2026) ───────────
 * A decisão vivia dentro de `limpar-pendentes.mjs` e procurava o arquivo SEMPRE
 * no R2, com `conferirObjeto` importado direto de `lib/r2.ts`, ignorando a
 * coluna `armazem`.
 *
 * Desde a obra do B2, o ORIGINAL mora no B2 e só as derivadas ficam no R2.
 * Então, para toda mídia com `armazem = 'b2'` cujo envio deu certo e cuja
 * confirmação se perdeu, o script procurava onde o arquivo nunca esteve, não
 * achava, e concluía "abandonado": apagava a linha do banco enquanto o arquivo
 * seguia no B2 — órfão, pago e invisível.
 *
 * Perda de dado silenciosa, no sentido contrário ao que o script existe para
 * proteger. O comentário dele dizia "melhor entregar a foto ao cliente do que
 * apagar o trabalho de alguém", e o código fazia o oposto para tudo no B2.
 *
 * Não doeu, e o motivo não é sorte nem cuidado: em 26/08/2026 a produção tinha
 * ZERO mídias, então não havia linha para o script julgar. As seis pendências
 * que existiam moravam no `fotonio_dev`, todas com `armazem = 'r2'`, todas do
 * "Estúdio Teste Fotônio" — sobra de teste, não trabalho de cliente.
 *
 * A margem era mais fina do que parece: o script roda TODO DIA às 04:30 em
 * produção, pelo `fotonio-cofre.service`. Não era um defeito adormecido à espera
 * de alguém executar à mão; era um defeito executado quatro vezes na semana
 * passada, que só não encontrou nada para destruir.
 */
const { decidirPendente } = await import("../src/lib/pendentes.ts");

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
  }
};

/** Armazém de mentira: registra onde perguntaram, e só "tem" o que foi plantado. */
function armazemFalso(presentes) {
  const perguntas = [];
  const conferir = async (chave, armazem) => {
    perguntas.push({ chave, armazem });
    const achado = presentes.find((p) => p.chave === chave && p.armazem === armazem);
    if (!achado) throw Object.assign(new Error("NotFound"), { name: "NotFound" });
    return { bytes: achado.bytes };
  };
  return { conferir, perguntas };
}

console.log("Envio pendente:\n");

/* ── o defeito, prendido ─────────────────────────────────────────────────── */

await etapa("mídia no B2 é procurada NO B2, não no R2", async () => {
  const { conferir, perguntas } = armazemFalso([]);
  await decidirPendente({ chave: "k.jpg", armazem: "b2" }, conferir);
  igual(perguntas, [{ chave: "k.jpg", armazem: "b2" }], "onde perguntou");
});

await etapa("arquivo PRESENTE no B2 é resgatado, nunca removido", async () => {
  /* Esta é a etapa que o defeito reprovava: com a busca cravada no R2, o
   * arquivo estava lá no B2 e a resposta era "remover". */
  const { conferir } = armazemFalso([{ chave: "k.jpg", armazem: "b2", bytes: 4096 }]);
  const r = await decidirPendente({ chave: "k.jpg", armazem: "b2" }, conferir);
  igual(r, { acao: "resgatar", bytes: 4096 }, "decisão");
});

await etapa("arquivo presente no R2 continua sendo resgatado", async () => {
  const { conferir } = armazemFalso([{ chave: "k.jpg", armazem: "r2", bytes: 128 }]);
  const r = await decidirPendente({ chave: "k.jpg", armazem: "r2" }, conferir);
  igual(r, { acao: "resgatar", bytes: 128 }, "decisão");
});

await etapa("ausente nos dois é removido — o caso do envio abandonado", async () => {
  const { conferir } = armazemFalso([]);
  igual(await decidirPendente({ chave: "k.jpg", armazem: "b2" }, conferir), { acao: "remover" }, "b2");
  igual(await decidirPendente({ chave: "k.jpg", armazem: "r2" }, conferir), { acao: "remover" }, "r2");
});

await etapa("o mesmo arquivo no OUTRO armazém não conta como presente", async () => {
  /* Sem isto, um `armazem` errado no banco faria o script resgatar uma mídia
   * apontando para chave que não é dela. */
  const { conferir } = armazemFalso([{ chave: "k.jpg", armazem: "r2", bytes: 999 }]);
  const r = await decidirPendente({ chave: "k.jpg", armazem: "b2" }, conferir);
  igual(r, { acao: "remover" }, "decisão");
});

/* ── o valor nulo, que é o caso das mídias antigas ───────────────────────── */

await etapa("armazem nulo é tratado como r2, igual ao resto do sistema", async () => {
  /* `armazemDe()` em lib/armazem.ts decide que qualquer coisa que não seja
   * exatamente "b2" é "r2" — é onde todo arquivo antigo está. Aqui vale a mesma
   * régua, senão a limpeza divergiria da leitura da galeria. */
  const { conferir, perguntas } = armazemFalso([]);
  await decidirPendente({ chave: "k.jpg", armazem: null }, conferir);
  igual(perguntas[0].armazem, "r2", "armazém consultado");
});

await etapa("valor estranho no banco não vira consulta estranha", async () => {
  const { conferir, perguntas } = armazemFalso([]);
  await decidirPendente({ chave: "k.jpg", armazem: "s3-do-vizinho" }, conferir);
  igual(perguntas[0].armazem, "r2", "armazém consultado");
});

/* ── falha de rede não pode virar remoção ────────────────────────────────── */

await etapa("erro de REDE não é 'abandonado' — na dúvida, não apaga", async () => {
  /* Diferença que decide se o produto perde foto: "não achei" é resposta;
   * "não consegui perguntar" não é. Tratar as duas igual apagaria o trabalho
   * de um estúdio inteiro no dia em que o B2 tivesse instabilidade. */
  const conferir = async () => {
    throw Object.assign(new Error("socket hang up"), { name: "TimeoutError" });
  };
  const r = await decidirPendente({ chave: "k.jpg", armazem: "b2" }, conferir);
  igual(r, { acao: "adiar" }, "decisão");
});

/* ── o caminho REAL, sem armazém falso ───────────────────────────────────── */

/*
 * As etapas acima injetam a consulta, o que prova a lógica e não prova a
 * ligação. Esta usa `conferirOriginal` de verdade — o mesmo que o script usa —
 * contra o ambiente de desenvolvimento, onde o B2 NÃO está configurado.
 *
 * Credencial ausente é a falha mais provável em produção: chave revogada,
 * variável esquecida num deploy, segredo que não subiu. Nesses casos o armazém
 * não responde "não tenho" — ele nem chega a ser perguntado. Se isso virasse
 * "remover", um deploy com variável faltando apagaria a galeria inteira de um
 * estúdio na primeira madrugada.
 */
await etapa("sem credencial do B2, a decisão é ADIAR e nunca remover", async () => {
  const { arquivosConfigurado } = await import("../src/lib/b2.ts");
  if (arquivosConfigurado) {
    return "pulado — o B2 está configurado neste ambiente";
  }
  const r = await decidirPendente({ chave: "qualquer.jpg", armazem: "b2" });
  igual(r, { acao: "adiar" }, "decisão sem credencial");
  return "credencial ausente não apaga foto";
});

console.log(falhou ? "\n✗ decisão sobre pendentes com problema" : "\n✓ decisão sobre pendentes ok");
process.exit(falhou ? 1 : 0);
