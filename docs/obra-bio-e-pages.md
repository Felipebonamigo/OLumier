# Bio e Pages — paridade de marketing com a Lumi

Desenho aprovado em 26/08/2026. Ainda **não implementado**.

## Por que estas duas, e só estas

A Lumi vende onze coisas; onde ela realmente nos passa é em três:
site do estúdio, link-in-bio e landing de campanha. A primeira já existe
(`/e/<slug>`, migração 017). Faltam as outras duas.

O resto do que a Lumi tem — agenda, funil, contrato com assinatura,
financeiro, avisos por WhatsApp — **não entra no Olumier**. É o Atomatiza,
mesmo dono e mesmo comprador. Construir aqui seria fazer o mesmo produto duas
vezes, e transformaria o Olumier num pacote — a comparação que hoje ganhamos
(armazenamento e entrega) morre no dia em que virarmos "CRM com pouco
recurso". A resposta ao pacote da Lumi é comercial, não técnica: ver
`## O pacote`, no fim.

## Bio — a página de links

**Tamanho: pequeno.** Cabe inteiro no que a 017 já criou.

O `tenants.site` é JSONB de chave extensível justamente para isto: entra uma
chave nova, estúdio antigo cai no padrão de `lerSite()`, nenhuma migração.

```ts
// src/lib/site-estudio.ts — soma ao Site existente
export interface LinkBio {
  rotulo: string;   // LIMITES.rotuloBio = 60
  url: string;      // só https, validado na escrita E na leitura
}

// dentro de Site:
  bioLigada: boolean;
  bioLinks: LinkBio[];   // MAX_LINKS_BIO = 20
```

Reaproveita sem escrever nada novo: `logo_chave`, `cor_destaque`, `tema`,
`tipografia`, `whatsapp`, `instagram`, `email`, e as funções
`urlDoWhatsapp` / `urlDoInstagram` que já normalizam entrada hostil.

**Rota pública:** `/e/<slug>/bio`. Mora dentro da vitrine de propósito — um
domínio a menos para explicar, e o slug do estúdio já é único.

**Cuidado que não pode faltar:** `url` vira `href` numa página pública.
Aceitar só `https://`, recusar `javascript:` e `data:`, e sair com
`rel="noopener noreferrer"`. É a mesma regra que o comentário da 017 já
escreveu para whatsapp e instagram — vale igual aqui.

## Pages — a landing de campanha

**Tamanho: médio.** Aqui muda schema, e é o que torna esta obra
architectural.

Diferente de site e bio, que são **um por estúdio**, uma campanha é
**muitas por estúdio** e cada uma tem vida própria (prazo, vagas, leads).
JSONB no tenant não serve: viraria um array que cresce sem limite e sem
índice.

```sql
-- 020-paginas-campanha.sql  (017 site, 018 ciclo anual e 019 seleção já existem)
create table paginas (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  slug         text not null,
  titulo       text not null,
  conteudo     jsonb not null default '{}'::jsonb,  -- capa, texto, preço, vagas
  publicada    boolean not null default false,
  expira_em    timestamptz,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table leads (
  id         uuid primary key default gen_random_uuid(),
  pagina_id  uuid not null references paginas(id) on delete cascade,
  tenant_id  uuid not null,                 -- desnormalizado: a listagem é por estúdio
  nome       text not null,
  contato    text not null,                 -- e-mail ou telefone, como veio
  mensagem   text,
  ip_hash    text,                          -- mesmo esquema de `acessos`
  criado_em  timestamptz not null default now()
);
create index on leads (tenant_id, criado_em desc);
```

`conteudo` é JSONB pelo mesmo motivo da 002 e da 017: os campos de uma
campanha vão crescer, e cada um viraria migração.

**Rota pública:** `/e/<slug>/p/<slug-da-pagina>`.

**O que precisa existir antes de ir ao ar:**

1. **Freio de formulário.** Formulário público sem freio vira depósito de
   spam em uma semana. Reusar `lib/tentativas.ts`, que já faz isso na senha
   da galeria — a chave passa a ser `pagina:<id>`.
2. **Onde o lead aparece.** Um lead que ninguém lê é pior que nenhum
   formulário. Mínimo: lista no painel. Ideal: e-mail para o estúdio na hora,
   com `lib/email.ts`.
3. **LGPD.** Nome e contato de terceiro são dado pessoal. A página precisa
   dizer para que serve, e a lixeira do estúdio precisa apagar lead junto com
   a página (o `on delete cascade` acima já garante).
4. **Prazo.** `expira_em` fecha o formulário sozinho — "vagas até dia X" que
   continua aceitando inscrição no dia seguinte queima o estúdio com o cliente.

## Ordem

Bio antes de Pages: é menor, não mexe em schema, e prova o padrão de página
pública dentro da vitrine que Pages vai reusar.

E as duas **depois** da seleção de fotos. Em 26/08/2026 havia quatro frentes
abertas ao mesmo tempo neste repositório — site do estúdio (017), ciclo anual
(018), seleção (019) e a proposta de chave de API. Bio e Pages são as menos
urgentes das cinco: fecham comparação de tabela, não desbloqueiam entrega.
Entrar agora é somar uma quinta fila a um produto que ainda não tem cliente
pagando.

Nota de numeração: 017, 018 e 019 já estão tomadas. Pages é a **020**.

## O pacote — Olumier + Atomatiza

A Lumi cobra R$ 29,90 a R$ 79,90 por galeria + agenda + contrato +
financeiro. Nós temos as mesmas peças, em dois produtos.

O que **não** fazer: fundir os dois, ou reconstruir um dentro do outro.

O que dá para fazer sem engenharia:

- **Preço combinado.** Quem assina os dois paga menos que a soma. É mudança
  de tabela e de cobrança, não de código.
- **Uma página que conta a história dos dois.** O fotógrafo não procura
  "galeria" e "financeiro" separados; procura "organizar meu estúdio".
- **Indicação cruzada dentro do painel.** Uma linha no lugar certo, não um
  banner.

Login único e cadastro compartilhado são atraentes e são obra grande — ficam
para quando o pacote provar que vende, não antes.
