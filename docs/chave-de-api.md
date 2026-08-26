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
`/api/medias/:id/partes`. **Nada mais.** As rotas de cobrança, conta e exclusão
continuam só com cookie — não há motivo para um plugin alcançá-las, e cada rota que
aceita chave é superfície nova.

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
| `tenantDaRequisicao` e as 3 rotas | 1 noite |
| Tela na conta | 1 noite |
| Limite de uso e revisão de segurança | 1 noite |

Quatro a cinco noites. Zero custo de infraestrutura.

---

## A decisão

**Não implementar até a sessão do Lightroom decidir.** Se o plugin sair, isto é o
primeiro passo dele. Se não sair, vale a pena perguntar de novo se alguém pediu uma
chave de API — porque hoje ninguém pediu.
