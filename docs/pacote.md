# O pacote Galeria Átomo + Atomatiza

*Decidido em 30/09/2026 com o Felipe. Este arquivo é o CONTRATO entre os dois
sistemas e existe igual nos dois repositórios (`docs/pacote.md`). Mudou aqui,
mude lá.*

> Felipe: "nos 2 sistemas, temos que ter a opção de assinar os 2 juntos, o
> sistema reconhecer se o cpf/cnpj já tem login no outro sistema, e a pessoa
> poder 'montar' o pacote dela".

## As três decisões

1. **Duas assinaturas, criadas juntas.** Cada sistema continua com a SUA
   assinatura no Asaas (split, troca de plano e conferência continuam como
   são). O pacote cria as duas no mesmo clique, com o mesmo vencimento e a
   mesma forma de pagamento. No Pix/boleto são duas faturas.
2. **A conta do outro lado é criada sozinha.** Quem monta o pacote sem ter
   conta no outro sistema ganha uma, com o mesmo e-mail e o mesmo CPF/CNPJ, e
   recebe um e-mail para criar a senha.
3. **No pacote, o desconto vale desde a assinatura.** As duas assinaturas levam
   a marca `· pacote` na descrição, e a conferência do combo conta a assinatura
   marcada mesmo antes do primeiro pagamento — enquanto não tiver cobrança
   vencida. Venceu sem pagar, a outra volta ao cheio no ciclo seguinte (a
   fatura já emitida não sobe, como sempre). Quem já tem um e assina o outro
   separado segue a regra de sempre: conta a partir do primeiro pagamento.

## Quem é a mesma pessoa

**Só o CPF/CNPJ** (Felipe: "vamos manter por documento, por segurança"). O
e-mail NÃO liga contas. Ele entra só como trava: o pacote só usa a conta que
já existe do outro lado se o e-mail dela for o mesmo de quem está assinando.
CPF/CNPJ com conta lá e e-mail diferente → não mexe, e a pessoa assina por lá
(o desconto entra pela regra de sempre).

## A ponte

Servidor com servidor, `Authorization: Bearer <PONTE_ATOMO_SEGREDO>` (o mesmo
valor nos dois, 32+ caracteres). Sem segredo configurado → 503; segredo errado
→ 401; JSON inválido → 400. `timingSafeEqual` na comparação. Tempo limite de
quem chama: 1,5 s para `situacao`, 15 s para `assinar`.

Os dois sistemas expõem as MESMAS duas rotas. Onde o formato difere, é o
`plano`: a Galeria fala em gigas, o Atomatiza em faixa.

### `POST /api/ponte/situacao` — "este documento tem conta aí?"

Pedido: `{ "documento": "45041663000192" }` (só dígitos, 11 ou 14).

Resposta 200:

```json
{
  "conta": true,
  "emailMascarado": "bi•••@gmail.com",
  "assinatura": {
    "status": "ativa",
    "plano": { "gb": 500 },
    "ciclo": "mensal"
  }
}
```

- `conta: false` → `emailMascarado: null`, `assinatura: null`.
- `assinatura: null` → tem conta, mas não assina (teste, cortesia, cancelada).
- `status`: `"ativa"` (paga e em dia), `"pendente"` (criada, ainda sem
  pagamento), `"atrasada"` (tem cobrança vencida).
- `plano`: a Galeria responde `{ "gb": 500 }`; o Atomatiza responde
  `{ "faixa": "solo" | "equipe" | "estudio" }`.
- `ciclo`: `"mensal"` ou `"anual"`.
- Responde pelo próprio banco, sem chamar o Asaas: é para desenhar tela.
- Mais de uma conta com o documento: vale a mais antiga.
- Documento inválido → `conta: false` (não 400: a tela só não mostra nada).

### `POST /api/ponte/assinar` — "cria a assinatura aí"

Pedido:

```json
{
  "documento": "45041663000192",
  "email": "bibizaco@gmail.com",
  "nome": "BIA ZAC | Photo",
  "plano": { "faixa": "solo" },
  "ciclo": "mensal",
  "forma": "cartao",
  "vencimento": "2026-10-13",
  "pacote": true,
  "parceiro": { "gb": 500 },
  "aceitouTermos": true
}
```

- `plano`: o plano DO SISTEMA QUE RECEBE (faixa para o Atomatiza, gigas para a
  Galeria; na Galeria o segmento é sempre `foto`).
- `parceiro`: o plano do sistema que CHAMA — é com ele que o preço do combo é
  calculado quando `pacote` é true.
- `forma`: `"cartao"` ou `"fatura"` (Pix/boleto). Cada lado traduz pela sua
  `formaDaAssinatura`.
- `vencimento`: o primeiro vencimento de quem chama. Quem recebe usa
  `max(vencimento, hoje)`. A conta que nasce aqui tem os 14 dias de teste de
  sempre, então a primeira fatura pode vencer com o teste correndo — e isso é
  escolha de quem comprou. O que a Galeria faz com o atraso nesse intervalo:
  o aviso de "vencida" **não** marca a conta como inadimplente enquanto o teste
  vale (`api/asaas/webhook`); a fatura segue em aberto no Asaas e, se o teste
  acabar sem pagamento, vale a regra de sempre. Até 08/10/2026 marcava, e isso
  travava o envio de quem ainda tinha dias grátis (migração 064 desfez).
- `pacote: true` → preço com o combo de `parceiro` desde já, e a marca
  `· pacote` na descrição. `pacote: false` (acrescentar o outro produto a quem
  já assina um) → preço pela regra de sempre, lida no Asaas.
- `aceitouTermos`: obrigatório `true` quando a conta for criada; a tela de
  quem chama mostra os links dos Termos e da Privacidade do outro sistema.

Respostas:

- 200 `{ "ok": true, "contaNova": true, "valorCentavos": 5134, "faturaUrl": "https://…" | null }`
- 409 `{ "erro": "…", "codigo": "conta_de_outro_email" }` — o documento tem
  conta aí com outro e-mail. Não mexe em nada.
- 409 `{ "erro": "…", "codigo": "email_em_uso" }` — o documento não tem conta
  aí, mas o e-mail já é de outra conta.
- 409 `{ "erro": "…", "codigo": "ja_assina" }` — a conta já tem assinatura viva.
- 409 `{ "erro": "…", "codigo": "combinado" }` — a conta paga a mensalidade
  combinada direto com a gente, fora do Asaas. Não há assinatura para o combo:
  quem chama trata como erro (a própria assinatura fica no cheio).
- 400 `{ "erro": "…" }` — documento, plano, ciclo ou forma inválidos, ou
  `aceitouTermos` ausente quando a conta seria criada.
- 5xx — falhou do lado de lá (Asaas fora etc.).

`erro` é uma frase pronta para a tela de quem chama.

Regras de quem recebe:

1. Nunca confia no preço de quem chama: calcula o próprio, pela própria tabela.
2. Conta achada pelo documento e com o mesmo e-mail (sem caixa, sem espaço) →
   usa. E-mail diferente → 409 `conta_de_outro_email`.
3. Sem conta pelo documento e e-mail livre → cria: sem senha utilizável, e-mail
   dado como confirmado (o link de criar senha é a prova), aceite dos termos
   registrado com `origem: "pacote"`, e o e-mail "sua conta está pronta, crie a
   sua senha".
4. Idempotente: pedido repetido com a assinatura já criada responde 409
   `ja_assina`, e quem chama trata como sucesso se ele mesmo acabou de pedir.

## A ordem de quem chama (o botão "Assinar o pacote")

1. Cria a PRÓPRIA assinatura pelo caminho de sempre, com a marca `· pacote` e
   no preço cheio (o parceiro ainda não existe).
2. Chama `POST /api/ponte/assinar` no outro, com `pacote: true`.
3. Deu certo → roda a própria conferência do combo (`recalcularCombo`): ela
   acha o parceiro marcado e baixa a própria assinatura, fatura emitida
   inclusive.
4. Deu errado → a própria assinatura fica no preço cheio (o certo, sem
   parceiro), PERDE a marca `· pacote` (senão o outro, assinado separado
   depois, contaria a nossa ainda não paga), e a tela diz o que houve e que
   dá para assinar o outro por lá. A conferência do passo 3 roda mesmo assim:
   um "não respondeu" pode ter sido uma assinatura que nasceu lá.

Assim nenhum dos dois fica com desconto sem o outro existir.

## A marca `· pacote`

- Vai no FIM da descrição da assinatura no Asaas, dos dois lados:
  `Galeria Átomo — Foto · 500 GB · combo com o Atomatiza · pacote`,
  `Atomatiza — plano solo · combo com a Galeria Átomo · pacote`.
- Lida por `/\bpacote\b/i`. As leituras de sempre (gigas e faixa) não mudam.
- Quem reescreve a descrição (conferência do combo, troca de plano) PRESERVA a
  marca que já estava lá.
- Só importa até o primeiro pagamento: depois dele a assinatura já conta pela
  regra de sempre.

## A conferência do combo, depois do pacote

A assinatura do outro conta quando:

- está ACTIVE e não apagada;
- tem a referência do outro produto (`atz:sub:` / `olumier:`);
- a descrição diz o plano (faixa / gigas);
- não tem cobrança vencida;
- **e** já foi paga ao menos uma vez **ou** tem a marca `· pacote`.

---

# Fatura única (30/09/2026, à noite) — SUBSTITUI "A ordem de quem chama"

> Juan, com gente assinando: "a cobrança tá indo separada, uma no boleto e
> outra no cartão". Felipe: "tem que permitir assinar juntos, e o Asaas ou o
> sistema fazer a separação depois que ele pagar".

O botão "Assinar o pacote" passa a criar **UMA assinatura no Asaas**, com uma
fatura por ciclo (um cartão, um Pix, um boleto). A separação é o split da
própria assinatura: a parte dos sócios de cada produto já sai dela no
pagamento. Cada sistema fica sabendo do pagamento pelo webhook, como sempre
(a conta do Asaas é a mesma, os dois recebem todos os eventos).

"Acrescentar o outro" (quem já assina um) continua como estava: duas
assinaturas, regra de sempre.

## Quem cria

Quem está com a pessoa na tela (**O**, de origem). O outro (**P**, parceiro)
prepara a conta dele e diz quanto cobra e como divide; O cria a assinatura
única no próprio cliente do Asaas e avisa P.

## A referência e a descrição

- `externalReference`: `pacote:<id da conta na Galeria>:<id do estúdio no Atomatiza>`
  (os dois UUIDs). É por ela que cada webhook acha a própria conta: a Galeria
  lê o 2º pedaço, o Atomatiza o 3º.
- `description`: `Pacote Galeria Átomo 1 TB + Atomatiza Solo · pacote`
  (o tamanho como `gbDaDescricaoGaleria` lê, a faixa como `plano solo` NÃO é
  exigida aqui — o pacote se lê pela referência).

## A ponte — duas rotas novas (mesma porta e mesmos 503/401/400 de sempre)

### `POST /api/ponte/pacote/preparar`

Pedido: o mesmo corpo de `/api/ponte/assinar` (documento, email, nome, plano
DE P, ciclo, forma, vencimento, parceiro = plano de O, aceitouTermos), sem
`pacote`.

P aplica as MESMAS regras de conta de `/api/ponte/assinar` (conta pelo
documento com o mesmo e-mail; `conta_de_outro_email`, `email_em_uso`,
`ja_assina`, `combinado`, aceite obrigatório para criar, convite de senha na
conta nova) e põe a conta no plano pedido — mas **não cria assinatura**.

Resposta 200:

```json
{
  "ok": true,
  "contaId": "uuid da conta/estúdio em P",
  "contaNova": true,
  "valorCentavos": 4991,
  "nome": "Atomatiza Solo",
  "split": [
    { "walletId": "…", "percentual": 30 },
    { "walletId": "…", "fixoCentavos": 1234 }
  ]
}
```

- `valorCentavos`: o preço de P NO CICLO, já com o combo do `parceiro`
  (anual = dez mensalidades com o desconto de dez meses).
- `nome`: como P aparece na descrição ("Atomatiza Solo", "Galeria Átomo 1 TB").
- `split`: as partes de P para ESSE valor, como P as mandaria numa assinatura
  só dele. `percentual` é % do valor de P (não do total); `fixoCentavos` é
  valor exato. Sem sócios configurados → `[]`.

### `POST /api/ponte/pacote/vincular`

Pedido: `{ "documento", "contaId", "assinaturaId", "clienteId", "valorCentavos", "ciclo" }`.

P grava na conta `contaId` (conferindo que o documento é o dela): o id da
assinatura, o cliente do Asaas, o ciclo, o plano preparado, status
"pendente" — exatamente o que gravaria numa assinatura dele — e a marca de
que a cobrança é do pacote (cada lado guarda do seu jeito). Responde
`{ "ok": true }`. Repetir com o mesmo `assinaturaId` é ok (idempotente).

## A ordem de O

1. Confere o próprio lado (documento, plano, sem assinatura viva).
2. `preparar` em P. Recusou → nada foi criado; a tela mostra o `erro`.
3. Cria a assinatura única: cliente do Asaas de O, valor = o de O (com o combo
   da faixa/tamanho de P) + `valorCentavos` de P, ciclo, vencimento de O,
   forma escolhida, a descrição e a referência acima, e o split:
   - as partes de O para o valor de O, como sempre;
   - as partes de P: `fixoCentavos` vai como `fixedValue`; `percentual` vira
     `percentual × valorDeP ÷ total` (% do TOTAL, que é o que o Asaas aplica);
   - a mesma carteira nos dois lados vira UMA parte: percentuais somados; se
     um lado é fixo e o outro percentual, o fixo entra como
     `fixo ÷ total × 100` somado ao percentual.
4. Grava a assinatura na própria conta (como a assinatura de sempre, com a
   marca de pacote).
5. `vincular` em P. Falhou → O CANCELA a assinatura única no Asaas, limpa a
   própria conta e mostra o erro: nunca fica uma fatura cobrando por um produto
   que não sabe dela.

## Depois

- **Webhook:** evento com referência `pacote:` → cada lado acha a própria conta
  pelo seu pedaço da referência e aplica o MESMO efeito que daria à própria
  assinatura (pagou, atrasou, cancelou, estornou). O e-mail 'pagou' do pacote
  sai só da Galeria; o Atomatiza não manda o dele para `pacote:`.
- **Combo:** a conferência (`recalcularCombo`) NÃO mexe em assinatura de
  pacote: o preço já é o do combo. O diagnóstico diz "pacote".
- **Mudar de plano / cancelar um produto só:** por enquanto, pelo WhatsApp.
  As duas telas trocam o botão por esse recado quando a assinatura é de
  pacote. (Cancelar o pacote inteiro também vai pelo WhatsApp nesta primeira
  versão — a devolução de um e de outro precisa de conta à mão.)
- **Situação (`/api/ponte/situacao`):** conta em pacote responde a assinatura
  como sempre (status pelo banco), e ganha `"pacote": true` dentro de
  `assinatura`.
- **TB adicional:** o desconto é calculado sobre o plano até 1 TB; cada tera acima entra na mesma fatura, no preço cheio (R$ 80), fora da divisão do desconto.
