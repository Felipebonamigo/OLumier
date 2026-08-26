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

## 2. O matcher do subdomínio de estúdio

> **Hoje esta seção VALE — faça o que ela diz.** Em 26/08/2026 a linha `@estudio`
> continua no servidor: `ops/caddy-dominio-proprio.md`, que a apagaria, **não foi
> aplicado** e não será sem o Felipe presente, porque o bloco final dele toca o
> arquivo que serve também Padelizou, Atomatiza, Poke Panda e Bonamigo. Este
> documento não depende daquele e não presume nada dele.
>
> A ressalva existe só para o dia em que a ordem se inverter: se aquele documento
> for aplicado antes deste, a regex some inteira e quem decide passa a ser só o
> porteiro em `/api/tls/permitir` — e aí **esta seção não tem mais o que fazer**,
> porque `config/dominios.ts` lista os dois domínios e o porteiro responde `200`
> para os subdomínios dos dois.
>
> Então: olhe o Caddyfile do servidor antes. Achou `@estudio`, siga daqui. Não
> achou, pule para a seção 3.

Uma linha, no bloco de TLS sob demanda que já existe:

```caddy
@estudio header_regexp host Host ^[a-z0-9-]+\.(fotonio|olumier|galeriaatomo)\.com\.br$
```

**Não** troque por `*.galeriaatomo.com.br` como endereço de site. Endereço
curinga faz o Caddy pedir certificado curinga por ACME, que exige desafio DNS —
sem o módulo de DNS compilado no binário, a tentativa falha e derruba o TLS dos
outros nomes do domínio. Foi assim que o `www` caiu uma vez.

O que existe aqui é certificado **sob demanda**, um por host, com o aplicativo
respondendo quem pode. O lado do aplicativo já está pronto: `config/dominios.ts`
lista os dois domínios, e `api/tls/permitir` responde `200` para os subdomínios
dos dois. Conferido por `scripts/testar-subdominio.mjs`.

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

Como isso se sustenta depende de qual versão do Caddyfile está no servidor:

- **Com a regex** (seção 2): ela lista `olumier` e continua listando.
- **Sem a regex** (depois de `ops/caddy-dominio-proprio.md`): quem sustenta é
  `DOMINIOS_ATENDIDOS` em `config/dominios.ts`, que mantém `olumier.com.br` ao
  lado do novo. Tirar o olumier de lá derruba as galerias antigas — é o mesmo
  cuidado, mudou só o arquivo onde ele mora.
