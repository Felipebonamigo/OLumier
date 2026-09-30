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
  `max(vencimento, hoje)`.
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
