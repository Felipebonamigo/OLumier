# Caddy — o que muda quando o DNS do galeriaatomo entrar

Pronto para colar, **não aplicado**. Aplicar antes de o DNS resolver faz o Caddy
tentar ACME para um domínio que não existe, falhar em laço e gastar tentativa
contra o limite do Let's Encrypt — que é por semana e não perdoa pressa.

Ordem: os três registros A primeiro (`@`, `www` e o **curinga** `*`), confirmar
que resolvem, e só então mexer aqui.

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

E o subdomínio: o matcher acima continua aceitando `olumier`, de propósito.
Enquanto houver link de galeria circulando com o endereço antigo, ele precisa
continuar abrindo com HTTPS válido — o redirecionamento do bloco nomeado não
cobre `estudio.olumier.com.br`, que passa pelo `@estudio`.
