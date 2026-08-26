# Chave de API por estúdio — desenho para aprovação

**Estado: PROPOSTA. Nada disto foi construído.**

Pela régua do `CLAUDE.md`, contrato de API com consumidor externo é *architectural*:
design escrito e aprovado antes de qualquer código. Este arquivo é esse design.

---

## Por que parei aqui em vez de construir

Duas razões, e a segunda é a que pesa.

A primeira é a regra acima. A segunda é o primeiro degrau da escada: **isso precisa
existir?** Hoje a chave de API tem um consumidor concreto — o plugin do Lightroom — e
esse plugin está *adiado para uma sessão de avaliação*, onde a pergunta é justamente
"vale a pena?". Construir a chave antes dessa resposta é montar o encanamento de uma
casa que talvez não seja construída.

E chave de API não é código que se joga fora depois. Uma vez publicada, alguém tem
script rodando contra ela. Ela vira compromisso permanente no dia em que a primeira
pessoa usa.

Se a resposta do Lightroom for "não vamos fazer", este documento provavelmente deve
morrer junto — e o custo de tê-lo escrito foi uma hora, não duas semanas.

---

## O problema real

Toda rota do sistema hoje se autoriza por `sessaoAtual()`, que lê um cookie assinado
(`src/lib/auth.ts`). Isso serve para navegador e não serve para mais nada:

| Quem | Como se autentica hoje | Funciona? |
|---|---|---|
| Fotógrafo no painel | cookie `olumier_sessao` | sim |
| Cliente na galeria | link + senha + cookie de acesso | sim |
| Plugin do Lightroom | — | **não existe caminho** |
| Script do próprio fotógrafo | — | **não existe caminho** |

Um plugin em Lua não faz login de navegador, não guarda cookie de sessão e não
sobrevive à expiração dele.

---

## O desenho

### Tabela

```sql
create table chaves_api (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  nome         text not null,              -- "Lightroom do notebook"
  prefixo      text not null,              -- "olu_a1b2c3" — o que a tela mostra
  hash         text not null,              -- SHA-256 do segredo inteiro
  escopo       text not null default 'envio',
  ultimo_uso_em timestamptz,
  criada_em    timestamptz not null default now(),
  revogada_em  timestamptz
);
create unique index on chaves_api(prefixo);
create index on chaves_api(tenant_id) where revogada_em is null;
```

**O segredo nunca é guardado.** Só o hash. A tela mostra a chave inteira **uma vez**,
no momento da criação, e nunca mais — igual ao que a Backblaze faz, e pela mesma razão:
um vazamento do banco não pode virar acesso às galerias de ninguém.

O `prefixo` existe para a tela poder dizer *qual* chave é qual sem guardar o segredo.

### Formato

```
olu_a1b2c3_<32 bytes aleatórios em base62>
```

O prefixo legível na frente faz duas coisas: permite achar a linha no banco com um
índice em vez de comparar hash contra todas, e deixa a chave reconhecível se cair num
log ou num print.

### Escopos — e por que mais de um desde o começo

| Escopo | Pode | Não pode |
|---|---|---|
| `envio` | criar galeria, subir arquivo, criar capítulo | apagar nada, ver cobrança, mexer em conta |
| `leitura` | listar galerias e mídias | escrever qualquer coisa |

Uma chave que faz tudo é a que vaza e custa caro. O plugin do Lightroom precisa de
`envio` e de mais nada — em particular, **não precisa apagar**, e é justamente o
apagar que transforma um vazamento em perda de dado.

Começar com escopo único e "adicionar depois" não funciona: chave já distribuída não
se reescopa sem quebrar quem a usa.

### Como as rotas passam a autorizar

Uma função só, no lugar de `sessaoAtual()` nas rotas que o plugin usa:

```ts
// src/lib/auth-api.ts
export async function tenantDaRequisicao(
  req: Request,
  escopo: Escopo,
): Promise<string | null>
```

Ela tenta, nesta ordem:

1. `Authorization: Bearer olu_…` → confere hash, escopo e `revogada_em`;
2. cookie de sessão → o painel segue funcionando exatamente como hoje.

Rotas que mudam: `POST /api/galerias/:id/upload`, `POST /api/medias/:id/confirmar`,
`/api/medias/:id/partes`. As rotas de cobrança, conta e exclusão continuam só com
cookie — não há motivo para um plugin alcançá-las, e cada rota que aceita chave é
superfície nova.

Nessas três, trocar `sessaoAtual()` por `tenantDaRequisicao()` **na linha da
autorização e em nenhum outro lugar** preserva de graça o portão de cobrança: o
`situacaoDoTenant(...).podeEnviar` que devolve 402 mora no corpo da rota, depois do
tenant resolvido (`upload/route.ts:102`). Chave de API não pode virar desvio do
paywall, e não vira — desde que a troca seja só essa linha.

### Correção de 26/08/2026 — as três rotas não bastam

O parágrafo acima dizia "nada mais", e isso estava errado. O escopo `envio` promete
*criar galeria* e *criar capítulo*, e **não existe rota para nenhum dos dois**: os dois
vivem como server action em `src/app/painel/actions.ts` (`criarGaleriaAction`,
`criarSecaoAction`), que usam `redirect()` e `revalidatePath`. Lua não chama server
action — nem Lua, nem `curl`, nem nada fora do React.

Do jeito que estava escrito, a chave autorizava um plugin que não teria onde publicar.
Faltam três rotas, e elas são parte deste desenho, não um detalhe de implementação:

| Rota | Para quê | Escopo |
|---|---|---|
| `GET /api/galerias` | o plugin lista as galerias para o fotógrafo escolher | `leitura` |
| `POST /api/galerias` | criar a galeria a partir da coleção publicada | `envio` |
| `POST /api/galerias/:id/secoes` | criar o capítulo a partir da subcoleção | `envio` |

**Cada uma precisa repetir o portão de cobrança.** Nas três rotas antigas ele vem de
graça porque já está no corpo; estas nascem vazias, e uma rota nova que esquece o
`podeEnviar` é exatamente o desvio do paywall que o parágrafo anterior evita.

O ganho de escrevê-las: elas servem ao painel também, e encolhem `actions.ts`.

### Limite de uso

Reaproveitar `src/lib/tentativas.ts`, que já existe e já é usado no portão da galeria.
Chave é credencial de longa duração: sem freio, uma chave vazada sobe lixo até estourar
a quota do estúdio.

### Tela

Em `/painel/conta`, abaixo da marca:

- lista das chaves ativas: nome, prefixo, criada em, último uso
- **criar** → mostra o segredo uma vez, com aviso de que não aparece de novo
- **revogar** → imediato, sem confirmação em duas etapas (revogar por engano custa
  criar outra; não revogar a tempo custa mais)

---

## A armadilha que a chave destrava — republicar sem trocar o id

Achado em 26/08/2026, revisando este desenho contra o código.

O motivo de existir do plugin é o *republicar*: o fotógrafo reedita uma foto já
entregue, clica Publicar, e só ela sobe. Hoje o sistema tem **criar** e **apagar**, e
não tem **substituir**. A saída óbvia — apagar e criar de novo — é uma perda de dado:

```sql
-- db/migracoes/010-favoritas.sql
media_id uuid not null references medias(id) on delete cascade
```

A seleção do álbum, entregue em `019-selecao.sql`, mora em cima de `favoritas`. Então
apagar a mídia apaga **a escolha do casal**. A noiva marca as 40 fotos do álbum, o
fotógrafo clareia uma e republica, e a lista some — sem erro, sem aviso, do jeito mais
silencioso possível. A capa da galeria (`galerias.capa_media_id`) quebra junto.

Portanto o desenho precisa de uma quarta rota, e ela é condição para o plugin, não
enfeite:

| Rota | O que faz | Escopo |
|---|---|---|
| `PUT /api/medias/:id/arquivo` | troca o objeto no armazém e **mantém o id** | `envio` |

Ela reabre o ciclo de upload da mídia que já existe (nova chave assinada, novo
`confirmar` com o tamanho real) sem tocar na linha de `medias` além de `bytes`,
`largura`, `altura` e as chaves das derivadas. O id fica. As favoritas ficam. A capa
fica.

Vale notar o que isto revela: a chave de API é a porta, mas o que faz o plugin valer
alguma coisa é esta rota. Se um dia o plugin for descartado e a chave continuar, esta
rota continua útil de qualquer jeito — reenviar um arquivo corrigido é pedido normal.

---

## O que fica de fora, de propósito

- **Refresh token / expiração automática.** Chave que expira sozinha quebra o plugin
  do fotógrafo no meio de um casamento. Revogação manual é suficiente enquanto não
  houver terceiros distribuindo integrações.
- **OAuth.** Faz sentido quando existe um terceiro pedindo acesso à conta de outra
  pessoa. Aqui o dono da chave é o dono dos dados.
- **Documentação pública da API.** Só quando houver um consumidor de fora. Documentar
  cedo demais congela decisões que ainda vão mudar.

---

## Custo

| Parte | Tamanho |
|---|---|
| Migração + `lib/chaves-api.ts` + testes | 1–2 noites |
| `tenantDaRequisicao` e as 3 rotas existentes | 1 noite |
| As 3 rotas novas (listar/criar galeria, criar capítulo) | 1–2 noites |
| `PUT /api/medias/:id/arquivo` — republicar sem trocar o id | 1 noite |
| Tela na conta | 1 noite |
| Limite de uso e revisão de segurança | 1 noite |

Seis a oito noites — não quatro a cinco. A diferença são as quatro rotas que faltavam
no desenho original. Zero custo de infraestrutura.

Tudo isso se prova com `curl`, sem Lightroom, sem licença: gerar chave, criar galeria,
subir foto, republicar a mesma foto e conferir que o id não mudou e que as favoritas
continuam lá.

---

## A decisão — respondida em 26/08/2026

A sessão do Lightroom aconteceu. Resposta: **aprovado como desenho, adiado como obra.**

O que mudou desde a proposta: a avaliação do plugin mostrou que ele é mais barato do
que parecia (o Lightroom exporta AVIF, então as derivadas não engordam; as rotas de
envio já existem e estão testadas; a licença de teste é a da Carol, então o custo em
dinheiro é zero). Continua sendo Lua, linguagem nova, com manutenção eterna contra as
atualizações da Adobe.

O que **não** mudou é o número que decide: produção segue com **1 estúdio, 1 galeria e
zero fotos entregues**. Construir a porta de entrada de um plugin para um sistema que
ninguém usou ainda é o mesmo erro que a seção "Por que parei aqui" já nomeia.

Este documento fica de pé e correto, pronto para o dia em que a resposta virar sim. O
gatilho para reabrir não é o concorrente lançar nada: é a Carol entregar um casamento
de verdade pelo Olumier e **pedir** o plugin.
