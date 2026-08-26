# Domínio próprio do estúdio

**Estado: CONSTRUÍDO, menos o Caddy.** Aprovado e implementado em 26/08/2026.

| Peça | Situação |
|---|---|
| Migração `023-dominio-proprio.sql` | ✅ aplicada no dev |
| `src/lib/dominio-proprio.ts` | ✅ `testar-dominio-proprio.mjs`, 20/20 |
| Porteiro (`api/tls/permitir`) | ✅ com teste HTTP |
| Roteamento (`proxy.ts`) e a armadilha do item 6 | ✅ com teste HTTP |
| Tela em `/painel/site` | ✅ conferida no navegador |
| **Bloco do Caddy** | ❌ **não feito** — toca os 4 produtos do servidor |
| Ensaio com domínio real | ❌ não feito |

## O que a construção mudou no desenho

**Duas validades de cache, não uma.** O desenho previa 60s para tudo. Virou 60s para
acerto e **5s para erro**: o cache negativo existe só para conter varredura, e cinco
segundos já colapsam a enxurrada. Guardar o erro por um minuto tem um caso ruim de
verdade — o estúdio acaba de provar a posse, alguém já perguntou por aquele host
antes, e ele vê "não encontrado" sem saber por quanto tempo.

**As actions não moram em `painel/actions.ts`.** Aquele arquivo passa de 700 linhas e é
editado por várias sessões ao mesmo tempo. As três funções desta obra vivem em
`src/app/painel/site/actions.ts`, ao lado da tela que as usa.

**A tela não lê o tenant inteiro.** As três colunas vêm de uma consulta própria na
página, em vez de crescer a interface `Tenant` em `lib/tenants.ts` — arquivo disputado.

## Um erro meu, registrado de propósito

Durante a construção eu concluí que o Next cacheava a resposta do porteiro por URL, e
escrevi no código que "um estúdio apagado continuaria liberando certificado". **Era
falso.** GET de route handler é dinâmico por padrão desde a v15.0.0-RC, e medi com a
linha removida: mesma URL, 403 → 200 acompanhando o banco.

O que eu tinha visto era outra coisa: uma segunda sessão rodava a suíte a cada dois
minutos contra o mesmo banco, e o `finally` de um teste limpava `dominio_proprio`
segundos depois do meu probe gravá-lo. Somado a um teste meu que comparava `Ana &
Pedro` com o HTML `Ana &amp; Pedro`, cada rodada dava um resultado diferente.

Fica escrito porque o custo real não foi o erro — foi ter costurado uma explicação
sobre medição contaminada em vez de desconfiar da medição. O `force-dynamic` continua
lá por outro motivo, honesto e menor, explicado no próprio arquivo.

---

## Desenho original (aprovado)

`carolinetedesco.com.br` servindo a vitrine e as galerias do estúdio, no lugar de
`caroline-tedesco-fotografia.olumier.com.br`.

É *architectural* pela régua do `CLAUDE.md`: mexe em roteamento e em emissão de
certificado, e o raio de dano não para no Olumier — o mesmo Caddy serve Padelizou,
Atomatiza, Poke Panda e Bonamigo Systems no mesmo servidor.

---

## Por que vale a pena

Único item onde a Lumi ganha de nós e dói. Eles vendem com a frase certa: *"100% seu,
ninguém toma"*. O GoFotógrafo não tem site nenhum, então isto também vira distância
sobre ele.

E encaixa no que já somos: a vitrine com portfólio que se atualiza sozinho fica muito
melhor no nome do estúdio do que num subdomínio nosso. Não é recurso de CRM — é a
entrega e a marca do fotógrafo, que é a coisa que este produto vende.

**A parte cara já está construída.** O porteiro de certificado sob demanda
(`api/tls/permitir`) está em produção desde a obra do subdomínio.

---

## O que existe hoje

| Peça | Onde | O que faz |
|---|---|---|
| Lista de domínios atendidos | `src/config/dominios.ts` | `as const`, dois domínios, em tempo de compilação |
| `estudioDoHost(host)` | idem | **função pura**: casa sufixo `.olumier.com.br` e devolve o slug |
| Roteamento | `src/proxy.ts` | subdomínio → reescreve para `/e/<slug>` ou `/g/<slug>/<galeria>` |
| Porteiro do certificado | `src/app/api/tls/permitir/route.ts` | o Caddy pergunta antes de emitir; só passa subdomínio de estúdio real |
| Caddy | `/etc/caddy/Caddyfile`, bloco final | `on_demand` + matcher `^[a-z0-9-]+\.(fotonio\|olumier)\.com\.br$` → `:3300`; **todo o resto: `abort`** |

Duas coisas dessa tabela decidem o desenho:

1. **`estudioDoHost` é pura e síncrona.** Domínio próprio não se resolve por sufixo —
   exige consulta. Confirmado na documentação da versão instalada: *"Proxy defaults to
   using the Node.js runtime"* (Next 16). O proxy PODE consultar o banco. Mas ele roda
   em quase toda requisição, então consulta por requisição não serve.

2. **O matcher do Caddy é uma expressão regular fixa.** Domínio de fora não casa e cai
   no `abort`. Manter uma regex sincronizada com uma tabela do banco seria a pior parte
   deste desenho — e não é preciso, como está abaixo.

---

## O desenho

### 1. Onde o domínio mora

```sql
alter table tenants
  add column if not exists dominio_proprio      text,
  add column if not exists dominio_token        text,
  add column if not exists dominio_verificado_em timestamptz;

create unique index if not exists idx_tenants_dominio_proprio
  on tenants(lower(dominio_proprio)) where dominio_proprio is not null;
```

**Um domínio por estúdio**, não uma tabela. É o que a Lumi oferece, é o que resolve o
caso real, e uma tabela para uma linha é degrau a mais da escada. Se um dia alguém
precisar de dois, a tabela nasce aí — com o problema já entendido.

O índice único é a trava contra dois estúdios reivindicarem o mesmo endereço. `lower()`
porque domínio não tem caixa.

### 2. Prova de posse — o coração do desenho

Sem ela, um estúdio digita `padelizou.com.br` e o nosso porteiro autoriza o Caddy a
tentar emitir certificado para um domínio alheio. Duas consequências, e a segunda é a
que assusta:

- a emissão falha (o DNS não aponta para nós) e **queima cota da Let's Encrypt** — que
  é exatamente o que o porteiro existe para evitar, e o limite é por servidor, com
  Padelizou e Atomatiza no mesmo;
- se o domínio *já* apontar para o nosso IP por qualquer motivo, o estúdio sequestra o
  endereço de outro.

**Só dizemos "pode" depois de o dono provar que é dono.** Registro TXT:

```
_olumier.carolinetedesco.com.br   TXT   "olumier-verificacao=<token>"
```

O token nasce no cadastro do domínio (`dominio_token`), e a verificação é
`dns.resolveTxt` do Node — sem dependência nova. Só depois de casar é que
`dominio_verificado_em` é preenchido, e **é essa coluna, não `dominio_proprio`, que o
porteiro consulta**.

A ordem importa: TXT primeiro, apontar o site depois. Assim nenhum certificado é
tentado para domínio que o estúdio não controla.

### 3. O porteiro

Em `api/tls/permitir`, depois das duas checagens que já existem:

```ts
const proprio = await consultarUm(
  `select id from tenants
    where lower(dominio_proprio) = $1 and dominio_verificado_em is not null`,
  [dominio],
);
if (proprio) return new NextResponse("ok", { status: 200 });
```

Nada mais muda ali. A recusa continua sendo o padrão.

### 4. O Caddy

O matcher fixo sai, e a decisão passa a ser inteiramente do porteiro:

```caddyfile
https:// {
	tls {
		on_demand
	}
	encode gzip
	reverse_proxy localhost:3300
}
```

**Por que isso é seguro, e não uma abertura:** com `on_demand`, o certificado é obtido
DURANTE o handshake. Se o porteiro recusa, o handshake falha e a requisição nunca
chega. Todo pedido HTTPS que aterrissa aqui já passou pelo porteiro.

**O que isso muda de fato:** o `abort` deixa de ser a última linha e a aplicação passa a
ser. Host desconhecido tem de virar 404 no app — está no item 5.

**A ressalva que precisa estar escrita:** certificado emitido fica em cache. Estúdio que
remove o domínio continua com certificado válido até expirar. Por isso a régua de
verdade é a resolução no app, que lê o banco a cada minuto — não o porteiro, que só
decide emissão.

### 5. A resolução no app

`estudioDoHost` continua pura e intocada — ela resolve os nossos subdomínios, que são o
caminho comum e não podem ficar mais lentos. Ao lado dela nasce:

```ts
// src/lib/dominio-proprio.ts
export async function estudioDoHostCompleto(host: string): Promise<string | null>
```

1. tenta `estudioDoHost(host)` — acerto, devolve sem tocar o banco;
2. procura no cache em memória (`Map<host, {slug, ate}>`);
3. erro de cache → consulta o banco e guarda.

**TTL de 60s para acerto e 60s para ERRO.** O cache negativo não é detalhe: sem ele, um
robô varrendo com `Host` aleatório vira uma consulta ao banco por requisição. Cache
negativo curto é o que impede o proxy de virar amplificador.

O cache é por processo. Com um processo só (é o caso hoje), a mudança aparece em até um
minuto. Com vários, cada um expira o seu — e um minuto de divergência num endereço que
muda uma vez na vida é preço nenhum.

### 6. A armadilha que o desenho tem de resolver, não herdar

`proxy.ts` redireciona para `marca.dominio` em três lugares (painel, `/g/`, `/e/`), e um
deles reescreve o endereço curto:

```ts
return NextResponse.redirect(new URL(curto + search, `https://${estudio}.${marca.dominio}`));
```

Com domínio próprio isso **joga o visitante de volta para o olumier.com.br** no meio da
navegação — o estúdio paga por um endereço e o nome dele desaparece na primeira
normalização de link. É o defeito mais provável desta obra, e é silencioso: a página
abre, só que no endereço errado.

Regra: **o host que chegou é o host que volta.** O redirecionamento do painel continua
indo para `marca.dominio` de propósito (o painel mora num lugar só, e o cookie de sessão
não vale em dois). O resto preserva o host da requisição.

O mesmo vale para o "copiar link" do painel, que hoje monta o endereço com
`marca.dominio` — com domínio próprio ligado, tem de entregar o endereço do estúdio,
senão o link que o fotógrafo manda para o casal nunca usa o domínio que ele comprou.

### 7. A tela

Em `/painel/site`, junto do resto da vitrine. Três estados, e o texto de cada um importa
mais que o layout — quem vai ler isso não sabe o que é CNAME:

| Estado | O que a tela mostra |
|---|---|
| sem domínio | campo + explicação de que precisa já ter um domínio comprado |
| aguardando prova | o registro TXT para copiar, e um botão "conferir agora" |
| verificado | o registro A/CNAME para apontar, e o aviso de que o certificado sai sozinho na primeira visita |

O botão "conferir agora" usa `lib/tentativas.ts`, que já existe: consulta DNS é chamada
externa, e botão sem freio é botão que alguém segura apertado.

---

## O que fica de fora, de propósito

- **Mais de um domínio por estúdio.** Ninguém pediu, e o índice único fica mais simples.
- **`www` automático.** O apex resolve o caso; `www` entra quando alguém reclamar.
- **Comprar domínio pelo painel.** Isso é revenda, com cobrança e renovação — outro
  produto.
- **Apontar DNS pela API do registrador.** Só compensa com muitos estúdios.
- **Domínio por galeria.** Nunca. Certificado por casamento é absurdo operacional.

---

## O que os testes precisam prender

`scripts/testar-subdominio.mjs` já trava o essencial e **não pode ficar verde por
acidente**: o teste do parecido (`estudio.olumier.com.br.golpe.net`) tem de continuar
barrado depois de o matcher do Caddy sair.

Novos:

- domínio verificado libera o certificado; **o mesmo domínio sem `dominio_verificado_em`
  é recusado**;
- domínio de um estúdio não resolve para outro;
- host desconhecido devolve 404 no app (a rede que substitui o `abort`);
- o redirecionamento do endereço curto **preserva o domínio próprio** — este é o teste
  que pega a armadilha do item 6;
- cache negativo: host desconhecido repetido não gera consulta por requisição.

---

## Custo

| Parte | Tamanho |
|---|---|
| Migração + `lib/dominio-proprio.ts` + verificação TXT + testes | 1 noite |
| Porteiro, resolução no app com cache, host desconhecido → 404 | 1 noite |
| A armadilha do item 6 (redirecionamentos e "copiar link") + testes | 1 noite |
| Tela no painel | 1 noite |
| Caddy e ensaio com domínio real | meia noite |

**Quatro a cinco noites.** Zero custo de infraestrutura — o certificado é Let's Encrypt,
já automatizado.

---

## O risco, dito em voz alta

A mudança no Caddy toca o arquivo que serve **quatro produtos em produção**. Um erro de
sintaxe ali derruba Padelizou, Atomatiza, Poke Panda e Bonamigo junto — nenhum deles tem
a ver com esta obra.

Mitigação, e nenhuma é opcional:

1. `caddy validate` antes de qualquer `reload`;
2. `caddy reload` (nunca `restart`) — recarrega sem derrubar conexão;
3. cópia do Caddyfile antes, com o caminho anotado no commit;
4. ensaio com um domínio descartável antes de oferecer a um estúdio de verdade — foi
   assim que o subdomínio foi validado, e funcionou.

---

## A decisão

Recomendo **fazer**, e depois da chave de API se o Lightroom sair — mas antes de
link-in-bio e de landing de campanha, que puxam o produto para virar CRM.

Este não puxa: é o endereço da entrega, com o nome de quem entrega.
