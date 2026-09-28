# Chave de API por estúdio — desenho e obra

**Estado: CONSTRUÍDO em 26/08/2026, menos o limite de uso (ver o fim).**
O plugin do Lightroom continua sem existir — isto é a porta que ele vai usar.

| Peça | Onde |
|---|---|
| Tabela | `db/migracoes/022-chaves-api.sql` |
| Credencial | `src/lib/chaves-api.ts` |
| Porta e portão | `src/lib/auth-api.ts` |
| Rotas de galeria | `src/app/api/galerias/route.ts`, `…/[id]/secoes/route.ts` |
| Republicar | `src/app/api/medias/[id]/arquivo/route.ts` |
| Tela | `src/components/chaves-api.tsx` |
| Testes | `testar-chave-api`, `testar-api-galerias`, `testar-republicar`, `testar-derivadas-formato` |

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
  prefixo      text not null,              -- "ga_a1b2c3" — o que a tela mostra
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
ga_a1b2c3_<32 bytes aleatórios em base62>
```

O prefixo legível na frente faz duas coisas: permite achar a linha no banco com um
índice em vez de comparar hash contra todas, e deixa a chave reconhecível se cair num
log ou num print.

**`ga_` é decisão fechada, de Galeria Átomo, tomada em 26/08/2026.** O desenho dizia
`olu_` até então, herdado do nome anterior — e o prefixo é a única coisa deste
documento que fica cara se for decidida depois. Vale a mesma regra do escopo: chave já
distribuída não muda de prefixo sem quebrar quem a usa, porque o prefixo não é
enfeite, é a coluna indexada pela qual a linha é encontrada.

Escolher agora custou uma linha. Se o produto trocar de nome uma terceira vez, **o
prefixo não acompanha** — ele entra na mesma lista de identificadores que a troca de
marca não pode arrastar, junto com nome de bucket, prefixo do Asaas e nome do banco
(ver `src/config/marca.ts`).

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

1. `Authorization: Bearer ga_…` → confere hash, escopo e `revogada_em`;
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

### Adição de 28/08/2026 — a conexão com o Atomatiza

O primeiro consumidor de verdade da chave não foi o plugin do Lightroom: foi o
**Atomatiza**, o outro produto da casa (contratos, agenda, cobrança). O contrato nasce
lá; a entrega mora aqui. O fotógrafo cola a chave lá, e o contrato ganha um botão
"criar a galeria desta venda".

Três coisas entraram para isso, todas dentro do desenho que já existia:

| Rota | Para quê | Escopo |
|---|---|---|
| `GET /api/conta` | o aperto de mão: a quem esta chave pertence (`tenantId`, `slug`, `nomeEstudio`, `dominio`, `escopo`) — é o que o outro lado mostra na tela antes de gravar a conexão, e o `escopo` deixa recusar chave de leitura na hora | `leitura` |
| `GET /api/galerias/:id` | como está a entrega: estado, contagem, endereço canônico e o `noAr` **calculado** (a régua da página pública, nunca a coluna `publicada` crua) | `leitura` |
| `POST /api/galerias` + `referenciaExterna` | criar a galeria de um contrato, com **idempotência**: a mesma referência devolve a mesma galeria (200), nunca uma `ana-pedro-2` | `envio` |

A procedência fica em `galerias.origem`/`origem_ref` (migração 045), com índice único
parcial por `(tenant, origem, origem_ref)` que deixa a lixeira de fora — apagar a
galeria errada não pode trancar o contrato até a purga. A referência é **opaca**:
guardamos e devolvemos, nunca interpretamos. Nenhum dado do contrato (valor, cliente,
telefone) atravessa; senha de galeria não entra em URL nem em resposta.

O `GET /api/conta` não fere o "conta exige cookie" desta página: ele não expõe nada
que dê poder — nem e-mail, nem plano, nem cobrança. Só a identidade que a tela de
conexão do outro lado precisa confirmar, e o `tenantId`, que é a âncora estável do
pareamento (o slug pode mudar — migração 025; o id não).

Prova em `scripts/testar-conexao-atomatiza.mjs`.

### Camada 4 — o canal de avisos (a galeria falando primeiro)

As três rotas acima são de PUXAR: o outro lado pergunta, a gente responde. Fica
um buraco, e ele é o do dia a dia — o fotógrafo publica a galeria aqui e o
contrato lá continua dizendo "fora do ar" até alguém lembrar de clicar em
conferir.

| Rota | Para quê | Escopo |
|---|---|---|
| `POST /api/avisos` | registra PARA ONDE avisar e com que segredo | `envio` |
| `GET /api/avisos` | o estado do canal (endereço e última tentativa) — o segredo nunca volta | `leitura` |
| `DELETE /api/avisos` | desfaz o canal | `envio` |

**Quem inventa o segredo é quem RECEBE**, e registra aqui — o desenho do
webhook do Asaas. Assim o outro lado gira o segredo quando quiser sem pedir
nada a ninguém. Ele fica cifrado (`src/lib/cripto.ts`, `AVISOS_ENC_KEY`, próprio
deste canal — nunca o `SESSION_SECRET`).

**E o dono do estúdio vê o canal na tela**, em `Painel → Conta → Avisos de
entrega`: para onde está avisando, desde quando, o último aviso e a última
falha — e um botão para desligar. Só aparece para quem tem canal.

A tela **não cria** canal, e a ausência do botão é a arquitetura aparecendo:
criar exigiria inventar um segredo aqui e mostrá-lo para alguém copiar, ou
seja, fazer o segredo passar por dentro de um HTML. Desligar, sim — é a conta
deste estúdio mandando coisa para fora, e cortar não pode depender de o outro
sistema estar de pé. Mesma assimetria de "revogar chave".

O que a tela mostra vem de `estadoDoCanal()`, que existe separada de
`canalDoEstudio()` por um motivo só: aquela decifra o segredo porque vai
assinar com ele; esta serve uma página, e o `select` dela nem pede a coluna do
segredo. `testar-tela-avisos.mjs` procura o segredo — em claro e cifrado — no
HTML da página, e foi conferido que ele reprova com o vazamento plantado.

`POST` exige escopo **envio**, e não leitura: registrar um canal é dizer para
onde os eventos deste estúdio saem. "Quem lê" e "quem redireciona" não podem ser
o mesmo poder. O endereço precisa ser **https** — é o nosso servidor fazendo
requisição para um endereço que outra pessoa escolheu, e em `http` o segredo
viajaria em claro.

**O que sai no aviso** (`src/lib/avisos.ts`), e o que não sai:

```json
{ "evento": "entrega.mudou", "ocorridoEm": "…", "galeriaId": "…",
  "referenciaExterna": "…", "noAr": true, "totalMedias": 230 }
```

Sem título, sem endereço, sem nada do casal. Em especial **sem a URL**: quem
recebe já a tem, do pareamento — aceitar endereço por aviso deixaria um aviso
forjado apontar o casal para outro lugar, e é justamente esse o dado que vai
parar num grupo de WhatsApp.

Quatro regras sustentam o canal, e cada uma tem passo em
`scripts/testar-conexao-atomatiza.mjs`:

1. **Avisar nunca derruba o que o disparou.** Mesmo `catch` vazio de
   `registrarEvento`, e pelo mesmo motivo: o outro sistema fora do ar não pode
   impedir o fotógrafo de publicar aqui.
2. **O `noAr` é calculado**, pela mesma régua da página pública — trial
   abandonado incluído. Aviso dizendo "no ar" sobre galeria que não abre é pior
   que aviso nenhum: o outro lado escreve isso na tela de quem vende.
3. **`ocorridoEm` vai junto**, e é por ele que o outro lado ordena. Rede
   reordena; sem a hora do fato, o último a chegar venceria.
4. **A assinatura é HMAC-SHA256 sobre o corpo cru**, com o `tenant_id` em claro
   no cabeçalho dizendo qual segredo usar.

Só galeria com procedência gera aviso: a criada no painel não representa
registro nenhum lá.

### Limite de uso — NÃO construído, e de propósito

O desenho pedia reaproveitar `src/lib/tentativas.ts` com este argumento: *"sem freio,
uma chave vazada sobe lixo até estourar a quota do estúdio"*.

Ao construir, esse argumento não sobreviveu ao primeiro degrau da escada do
`CLAUDE.md` — **isso precisa existir?**

- **Estourar a quota já é impossível.** Todo envio passa por
  `bytesUsados + bytes > quota` antes de assinar qualquer URL. O teto que o freio
  ia defender já é defendido, por código que existe e é testado.
- **Adivinhar chave não é ameaça.** O segredo é 32 bytes aleatórios. Não há
  dicionário, não há força bruta — freio de tentativa protege senha curta, e isto
  não é senha.
- **O escopo já tirou o que dói.** Chave vazada não apaga galeria, não mexe na
  conta, não vê cobrança.

O que um freio ainda compraria é modesto e real: conter volume de requisição
(carga de banco, custo de CPU) de uma chave vazada em laço, principalmente no
`GET /api/galerias`, que não passa por quota nenhuma.

**Teto do atalho:** se aparecer chave vazada em laço, ou se o `GET /api/galerias`
virar caminho quente, o freio entra — por prefixo de chave, em `tentativas.ts`, uma
noite. A saída está escrita para a próxima sessão não ler isto como esquecimento.

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

## Quando a conta ainda não existe — `POST /api/provisionar`

Tudo acima supõe que o estúdio já é cliente daqui: ele gera a chave no painel e
cola do outro lado. Isso resolve quem já usa os dois, e deixa de fora
exatamente quem a gente quer atrair — o fotógrafo que já usa o Atomatiza e
**ainda não tem galeria**. Para ele, ligar os dois era preencher um segundo
cadastro aqui, voltar lá, gerar chave, colar. Quatro passos para dizer "sim".

Esta rota faz o caminho inteiro a partir de um gesto só, do lado de lá.

```http
POST /api/provisionar
x-provisionamento-segredo: <segredo de plataforma>

{ "nomeEstudio": "Sirius Fotografia",
  "email": "contato@sirius.com.br",
  "referenciaExterna": "<id do estúdio no Atomatiza>" }
```

Devolve `tenantId`, `slug`, `nomeEstudio`, `dominio`, `escopo` e a **chave** —
que sai uma vez e nunca mais, igual à criação pelo painel.

**O que muda na lei do pareamento:** a posse da chave deixa de ser a única
prova. O que entra no lugar é um segredo de **plataforma**, não de estúdio, e
ele autoriza uma coisa só — criar conta nova em teste. Não lê nada, não mexe em
conta existente, não publica galeria. Sem ele configurado a porta responde 503
e fica fechada; nunca aberta por omissão.

**O que não muda:** dinheiro não atravessa (a conta nasce no plano inicial, em
teste). PII do casal não atravessa — o que vem é o nome e o e-mail do
**estúdio**, que é a mesma pessoa dos dois lados. E senha não atravessa em
direção nenhuma: a conta nasce com uma senha aleatória que ninguém guarda, e o
acesso vem por um link de definir senha enviado ao fotógrafo. O outro produto
nunca sabe a senha daqui — e não teria como perguntar.

**Repetir é seguro, e é por isso que a referência é obrigatória.** A resposta
pode se perder depois de a conta nascer; o fotógrafo clica de novo. A mesma
referência devolve o **mesmo** estúdio e uma chave nova (migração 047, índice
único parcial). Sem isso, a segunda tentativa esbarraria no e-mail único e ele
ficaria com uma conta que não consegue ligar.

**Quem já tem conta com aquele e-mail é recusado com 409**, nunca duplicado — a
alternativa seria o fotógrafo com as galerias espalhadas em dois estúdios, sem
jeito de juntar depois. O recado diz o que fazer: entre, gere uma chave, cole.

`scripts/testar-provisionamento.mjs` prende as nove pontas, e foi conferido que
reprova com o defeito plantado (ignorar a referência): acusa *"recusou o retry:
email_ja_usado"*, que é o sintoma exato que o fotógrafo veria.

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
de verdade pela Galeria Átomo e **pedir** o plugin.
