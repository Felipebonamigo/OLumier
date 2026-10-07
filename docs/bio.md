# A página-ponte do Instagram (`/bio`)

*Pedido do Juan em 07/10/2026. Esta é a avaliação técnica que o pedido pedia
**antes** de implementar, e o registro do que foi feito.*

O perfil do Instagram passa a falar de dois produtos — **Atomatiza** (gestão) e
**Galeria Átomo** (entrega) — e o link da bio não pode cair direto em nenhum.
A página é um seletor: a pessoa escolhe, e a gente mede o que chegou, para onde
foi e de onde veio quem criou conta.

```
Instagram ──► /bio ──► /bio/ir/galeria ──► galeriaatomo.com.br        (cookie de origem)
                  └──► /bio/ir/atomatiza ──► atomatiza.com.br?utm_…   (origem na URL)
```

## O que já existia (e o que isso decidiu)

| Havia | Serve? | Decisão |
|---|---|---|
| Ferramenta de análise (GA4, Plausible, pixel da Meta) | **Não existe nenhuma.** A Privacidade até diz "não temos pixel de rede social". | Medição própria, mínima, no nosso banco. Pôr uma ferramenta de terceiros pede conta, tag, ajuste da Privacidade e perde 20–30% para bloqueadores. |
| `eventos` (auditoria) | **Não.** É imutável, feito para provar quem fez o quê numa disputa. O próprio código diz que "registrar cada clique encheria a tabela e afogaria os eventos que importam". | Tabela à parte: `bio_eventos` (migração 063). |
| `acessos` | Não: é por galeria. | — |
| `admin` (só leitura) | Sim. | Uma tela: `/painel/admin/bio`. Sem dashboard novo. |
| `tenants` / `conta.criada` | Sim: é onde nasce a conta. | Coluna `origem` (+ `origem_campanha`). |
| A "ponte" com a Atomatiza (`lib/ponte-atomatiza.ts`) | Só diz "esta pessoa tem conta nas duas?". Não carrega origem. | Não reaproveitar. |

## As decisões

**URL: `galeriaatomo.com.br/bio`.** É o único domínio que este repositório
controla, o Juan não quer domínio novo, e `/bio` é o que a pessoa já associa a
"link da bio". Os produtos moram em `/bio/ir/<produto>`.

**Todo botão passa por `/bio/ir/…`, que conta no servidor e redireciona (302).**
Contar em JavaScript antes de sair perde cliques (o navegador de dentro do
Instagram descarta a requisição quando a página muda), e não funciona sem JS.
No servidor o clique já chegou. Bônus: o endereço de cada produto mora em
`config/bio.ts` — mudar o destino não mexe na página nem no que o Instagram
divulga. Os botões são `<a>`, nunca `<Link>`: o Link pré-carregaria o
redirecionador e contaria um clique que ninguém deu.

**A visita é contada por um aviso do navegador (`/api/bio/evento`).** Só quem
rodou o JavaScript chega lá — o que separa gente de robô e de pré-visualização
de link (WhatsApp, Instagram, Slack), que baixam o HTML e nunca executam. Uma
vez por aba.

**Hierarquia e ordem: `config/bio.ts`.** A ordem da página é a ordem da lista;
inverter é trocar duas linhas de lugar. O selo "Lançamento" é um campo do
produto **com data para acabar** (`ate`, hoje 31/12/2026) e some sozinho.
Produto novo é um objeto novo: página, redirecionador, eventos e leitura saem
da lista.

**Visual:** uma tela de celular, sem imagem, uma fonte, o símbolo do Átomo que
as duas marcas dividem. Os dois cartões têm o mesmo peso; a Galeria vem
primeiro e leva o selo. Não é uma terceira home.

## Mensuração

Eventos, com os nomes do pedido: `page_view`, `click_galeria_atomo`,
`click_atomatiza`, `click_login_galeria`, `click_login_atomatiza`.

Cada linha guarda o evento, a hora, a **fonte / meio / campanha** (o vocabulário
do UTM, para qualquer ferramenta futura entender) e um **código do visitante que
muda todo dia** (hash de IP + navegador + data, sem cookie). Nenhum IP, nenhum
e-mail.

A tela `/painel/admin/bio` mostra, por período (7 / 30 / 90 dias / tudo):
acessos, pessoas, cliques por produto com a fatia de cada um e a taxa sobre os
acessos, cliques em "Entrar", dia a dia, fonte × campanha e **contas criadas
vindas da bio**.

### Limites (e a tela diz)

- **"Pessoas" é estimativa.** O código muda todo dia: a mesma pessoa em dois dias
  conta duas vezes; duas pessoas na mesma rede móvel com o mesmo modelo de celular
  contam uma. Para número exato seria preciso um cookie de identificação — não
  vale a troca de privacidade por um relatório de 1.000 acessos.
- **Robô não entra:** agente de robô, `HEAD`, adiantamento do navegador
  (`Sec-Purpose: prefetch`) e a visita sem JavaScript.
- **Duplo toque** no mesmo botão (3 s) conta uma vez.

## Atribuição

Dois casos, porque são dois domínios — e **cookie não atravessa domínio**.

### Galeria Átomo (o mesmo domínio): fecha o ciclo

Clicou num produto → cookie `origem_bio` (httpOnly, 30 dias, ex.:
`instagram~bio~lancamento~galeria`) → ao criar a conta, o cadastro o confere
(`lerCookieDaBio`, nunca o grava cru) e grava `tenants.origem =
instagram/bio/galeria` e `origem_campanha`; a `conta.criada` também. O cookie é
apagado depois de usado. **Instagram → Galeria → conta de teste está medido.**

O cookie nasce também no clique da Atomatiza (`instagram/bio/atomatiza`): uma
conta da Galeria com essa origem é alguém que veio da ponte, clicou na Atomatiza
e acabou criando conta aqui. É um dado, e o admin mostra separado.

**Não pega:** quem abre o link no navegador de dentro do Instagram e cria a conta
depois, no Safari/Chrome (o cookie de um não é o do outro), ou volta depois de 30
dias. É a limitação de qualquer atribuição por cookie.

### Atomatiza (outro domínio): **a nossa metade está pronta, a deles não**

A origem sai na URL, em UTM:
`https://atomatiza.com.br/?utm_source=instagram&utm_medium=bio&utm_campaign=<campanha>&utm_content=ponte`.
A gente mede o clique até ali. **Quem diz se a pessoa criou conta é o sistema da
Atomatiza**, e este repositório não o enxerga. Para fechar o ciclo lá, o lado da
Atomatiza precisa:

1. na primeira página, ler `utm_source`, `utm_medium`, `utm_campaign` e
   `utm_content` e guardá-los num cookie próprio (30 dias, primeiro toque — não
   sobrescrever se já existir);
2. na criação da conta (ou do lead), gravar esses valores junto;
3. (opcional) nos relatórios deles, agrupar por `utm_source/utm_campaign`.

Os nomes e o vocabulário são os do UTM padrão de propósito — se hoje a Atomatiza
já guarda UTM, **nada precisa mudar do lado deles**. Vale perguntar.

## "Já sou cliente → Entrar"

Não existe um "entrar" só: **são dois sistemas, com contas e senhas separadas**
(a "ponte" só descobre quem tem as duas). Um botão único teria de perguntar
"qual?", o que é um segundo clique para o mesmo resultado. Por isso a página tem
dois links pequenos, "Entrar na Galeria Átomo" e "Entrar na Atomatiza", no pé. O
login não leva UTM e não grava cookie: quem já é cliente não está sendo
conquistado.

## Como usar

1. Na bio do Instagram, o link com UTM (a tela do admin mostra o pronto):
   `https://galeriaatomo.com.br/bio?utm_source=instagram&utm_medium=bio&utm_campaign=link-da-bio`
2. Para separar posts, anúncios ou stories, troque o `utm_campaign`
   (`lancamento-galeria`, `story-outubro`). Só minúsculas, números, `.`, `-`, `_`.
3. **Por que o UTM no link:** o navegador de dentro do Instagram nem sempre diz de
   onde a pessoa veio. Sem UTM, a visita vira "direto" quando ele omite — com
   UTM, a origem fica certa de qualquer jeito. Sem UTM e com o endereço de origem
   (`l.instagram.com`), a fonte é inferida como `instagram`.
4. Ler em `/painel/admin/bio` (só admin).

## Privacidade

Mexeu na **Política de Privacidade** (versão 2026-10-07): uma seção para os
visitantes da `/bio`, o cookie de origem na lista de cookies, e a origem entre os
dados do fotógrafo. A frase "nenhum cookie de publicidade" continua verdadeira:
este cookie não identifica ninguém, só diz "instagram", e é lido uma vez.

## Fora do escopo, de propósito

- **GA4 / Plausible / pixel da Meta.** Não há conta nem tag, e cada um pede
  decisão sobre consentimento. Se um dia entrar, o vocabulário (`utm_*`, os nomes
  dos cinco eventos) já é o que eles esperam — é um mapeamento de um para um.
- **Retenção/purga de `bio_eventos`.** A tabela não tem dado pessoal e cresce
  uma linha por acesso; revisar quando passar de milhões.
- **Painel editável pelo admin** (ordem e textos). Reordenar é uma linha de
  código e uma publicação; editar em tela pediria uma tabela e uma tela para uma
  coisa que muda poucas vezes por ano.

## Arquivos

`src/app/bio/` (página, aviso de visita, redirecionador) ·
`src/app/api/bio/evento/` · `src/config/bio.ts` · `src/lib/bio-regras.ts`
(regras puras) · `src/lib/bio.ts` (banco) · `src/app/painel/admin/bio/` ·
`db/migracoes/063-link-da-bio.sql` · teste: `scripts/testar-bio.mjs`.
