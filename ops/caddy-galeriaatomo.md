# Caddy — o que muda quando o DNS do galeriaatomo entrar

Pronto para colar, **não aplicado**. Aplicar antes de o DNS resolver faz o Caddy
tentar ACME para um domínio que não existe, falhar em laço e gastar tentativa
contra o limite do Let's Encrypt — que é por semana e não perdoa pressa.

Ordem: os três registros A primeiro (`@`, `www` e o **curinga** `*`), confirmar
que resolvem, e só então mexer aqui.

> **Os três em "DNS only" — nuvem cinza, não laranja.** A Cloudflare cria
> registro novo já com o proxy LIGADO, e é aí que a armadilha mora: com o proxy
> na frente quem termina o TLS é a Cloudflare, o Caddy nunca recebe o handshake,
> e o certificado sob demanda **nunca é emitido**. A página abre — pelo
> certificado da Cloudflare — e o defeito só aparece no primeiro domínio próprio
> de fotógrafo, que depende justamente do certificado sob demanda. O curinga `*`
> é o mais importante dos três aqui, porque é ele que serve os subdomínios de
> estúdio.
>
> Hoje o `olumier.com.br` está certo: `@`, `www` e `estudio` resolvem só para
> `179.197.233.184`, sem nenhum endereço da Cloudflare no meio. É esse o estado
> que o domínio novo tem que copiar.

## 1. Bloco novo

Vai junto dos outros, em `/etc/caddy/Caddyfile`. É cópia do bloco do olumier —
mesma porta, mesmo log, porque é o mesmo aplicativo servindo os dois nomes.

```caddy
galeriaatomo.com.br, www.galeriaatomo.com.br {
	reverse_proxy localhost:3300
	encode gzip
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
	}
	log {
		output file /var/log/caddy/fotonio.log
		format json
	}
}
```

> **O `www` não precisa de `redir` aqui.** Desde 26/09/2026 o próprio app
> manda `www.galeriaatomo.com.br` para a raiz com 308 (`src/proxy.ts`), menos a
> `/api`. Antes os dois nomes respondiam 200 com a mesma página, e para o
> buscador eram dois sites com o conteúdo copiado.

## 2. O matcher do subdomínio de estúdio — **não existe mais**

> **Nada a fazer aqui. Pule para a seção 3.**
>
> Em 26/08/2026, à tarde, `ops/caddy-dominio-proprio.md` foi aplicado com o
> Felipe acompanhando, e a linha `@estudio` **saiu do servidor**. Conferido:
> `grep` no `/etc/caddy/Caddyfile` não devolve mais a regex, e o comentário na
> linha 188 registra a troca. Versões anteriores deste documento mandavam
> procurar a linha e editá-la — quem seguir aquilo hoje vai caçar uma linha que
> não existe.
>
> Quem decide passou a ser o porteiro em `/api/tls/permitir`, que o
> `on_demand_tls { ask ... }` (linha 9 do Caddyfile) consulta **antes** de
> emitir cada certificado. E quem o porteiro consulta é `DOMINIOS_ATENDIDOS`
> em `src/config/dominios.ts`, que já lista `olumier.com.br` e
> `galeriaatomo.com.br`. Ou seja: **o domínio novo já está autorizado no lado
> do aplicativo, sem tocar em Caddy nenhum.** Falta só o DNS.

O texto abaixo fica como registro do que existia, e do porquê — a armadilha do
curinga continua verdadeira e vale para quem for mexer em TLS aqui um dia.

A linha era esta:

```caddy
@estudio header_regexp host Host ^[a-z0-9-]+\.(fotonio|olumier|galeriaatomo)\.com\.br$
```

**Não** troque por `*.galeriaatomo.com.br` como endereço de site. Endereço
curinga faz o Caddy pedir certificado curinga por ACME, que exige desafio DNS —
sem o módulo de DNS compilado no binário, a tentativa falha e derruba o TLS dos
outros nomes do domínio. Foi assim que o `www` caiu uma vez.

O que existe é certificado **sob demanda**, um por host, com o aplicativo
respondendo quem pode. Conferido por `scripts/testar-subdominio.mjs`.

### Medido na produção em 26/08/2026, antes do DNS existir

O porteiro já responde certo para o domínio novo — dá para conferir sem esperar
o DNS, porque a pergunta vai por parâmetro:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://olumier.com.br/api/tls/permitir?domain=SEU_HOST'
```

| host perguntado                                   | resposta |
|---------------------------------------------------|----------|
| `galeriaatomo.com.br`                             | `200`    |
| `www.galeriaatomo.com.br`                         | `200`    |
| `caroline-tedesco-fotografia.galeriaatomo.com.br` | `200`    |
| `caroline-tedesco-fotografia.olumier.com.br`      | `200`    |
| `teste.galeriaatomo.com.br`                       | `403`    |
| `olumier.com.br.golpe.net`                        | `403`    |

As duas recusas são o porteiro funcionando, não falha: `teste` não é estúdio
que existe, e o último é o ataque por sufixo que o `estudioDoHost` bloqueia
comparando com ponto em vez de `includes`.

Ou seja: **o lado do aplicativo está pronto e provado.** Quando os três A
entrarem em cinza, o certificado sobe na primeira visita, sem tocar em nada.

## 3. Aplicar

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

`validate` antes do `reload` porque `reload` com arquivo inválido mantém a
configuração velha rodando **e** falha em silêncio na saída — os quatro sites
seguem no ar com a configuração antiga, e é fácil achar que aplicou.

## 4. Depois — o olumier vira redirecionamento

Só quando o domínio novo estiver servindo de verdade. O bloco do olumier passa a
ser o que o do fotônio já é:

```caddy
olumier.com.br, www.olumier.com.br {
	redir https://galeriaatomo.com.br{uri} permanent
}
```

Isto edita registros **dentro** da zona existente na Cloudflare — não recria
zona, não troca provedor de DNS. Seguro apesar do DS publicado; a regra dura do
DNSSEC só vale para recriar ou mover a zona.

E o subdomínio: `estudio.olumier.com.br` precisa continuar abrindo com HTTPS
válido, de propósito. Enquanto houver link de galeria circulando com o endereço
antigo, o redirecionamento do bloco nomeado acima **não** cobre esse caso — ele
vale só para `olumier.com.br` e `www`, e o subdomínio passa por outro caminho.

Quem sustenta isso é `DOMINIOS_ATENDIDOS` em `src/config/dominios.ts`, que
mantém `olumier.com.br` ao lado do novo. **Tirar o olumier de lá derruba as
galerias antigas** — o porteiro passaria a recusar o certificado e o link que o
casal tem salvo pararia de abrir com HTTPS válido.

Não existe data para remover o olumier dessa lista, e é de propósito: link de
galeria entregue não expira, e ninguém controla quem guardou qual endereço. O
custo de manter o nome antigo na lista é uma linha; o de remover é uma galeria
que não abre na casa de um cliente, sem aviso e sem sintoma do nosso lado.
