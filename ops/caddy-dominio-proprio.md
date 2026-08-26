# Caddy: aceitar domínio próprio de estúdio

**APLICADO em 26/08/2026**, com o Felipe acompanhando. Backup em
`/etc/caddy/Caddyfile.antes-dominio-proprio`.

Conferido depois do `reload`, contra a linha de base tirada antes:

| | antes | depois |
|---|---|---|
| padelizou.com.br | 200 | 200 |
| atomatiza.com.br | 307 | 307 |
| pokepanda.com.br | 200 | 200 |
| bonamigosystems.com.br | 200 | 200 |
| olumier.com.br | 200 | 200 |
| subdomínio de estúdio real | 200 | 200 |
| estúdio inexistente | recusado | **recusado no TLS** (`HTTP 000`) |

A última linha é a que prova que a troca não abriu nada: o `abort` saiu, e a
recusa passou a vir do porteiro — que nega antes do handshake, então a
requisição nem chega ao app.

O resto do arquivo é o passo a passo, mantido para a próxima vez.

O bloco final do `/etc/caddy/Caddyfile` só encaminha host que casa com a expressão
regular dos nossos domínios; qualquer outro cai em `abort`. Domínio próprio não casa.

## O que muda

```caddyfile
# ANTES
https:// {
	tls {
		on_demand
	}

	@estudio header_regexp host Host ^[a-z0-9-]+\.(fotonio|olumier)\.com\.br$
	route @estudio {
		encode gzip
		reverse_proxy localhost:3300
	}
	route {
		abort
	}
}

# DEPOIS
https:// {
	tls {
		on_demand
	}

	# A expressão regular saiu. Quem decide é o porteiro em /api/tls/permitir,
	# que o `on_demand` já consulta ANTES de emitir o certificado: se ele recusa,
	# o handshake falha e a requisição nunca chega aqui. Todo pedido que
	# aterrissa neste bloco já passou por lá.
	#
	# Manter a regex significaria mantê-la sincronizada com uma coluna do banco —
	# a pior parte possível desta obra, e desnecessária.
	#
	# O `abort` deixa de ser a última linha e a aplicação passa a ser: host que
	# não é subdomínio nosso nem domínio próprio verificado devolve 404.
	# `scripts/testar-subdominio.mjs` prende isso na etapa "domínio que ninguém
	# reclamou não serve nem libera".
	encode gzip
	reverse_proxy localhost:3300
}
```

## Como aplicar, sem derrubar os outros quatro produtos

Este arquivo serve Padelizou, Atomatiza, Poke Panda e Bonamigo Systems. Nenhum tem a
ver com esta obra, e um erro de sintaxe derruba os quatro junto.

```bash
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.antes-dominio-proprio
```

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

```bash
systemctl reload caddy
```

`reload` e nunca `restart`: recarrega sem derrubar conexão em andamento.

Depois, conferir que os quatro seguem no ar **antes** de comemorar:

```bash
for d in padelizou.com.br atomatiza.com.br pokepanda.com.br bonamigosystems.com.br olumier.com.br; do printf '%-26s ' "$d"; curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 "https://$d/"; done
```

Se algo sair errado:

```bash
cp /etc/caddy/Caddyfile.antes-dominio-proprio /etc/caddy/Caddyfile && systemctl reload caddy
```

## O ensaio, antes de oferecer a um estúdio de verdade

Foi assim que o subdomínio foi validado, e funcionou:

1. um domínio descartável (ou um subdomínio de um domínio que já é seu);
2. reclamar pelo painel, criar o TXT, conferir;
3. apontar o A para o IP do servidor;
4. abrir e ver o cadeado sair sozinho;
5. soltar o domínio no painel e conferir que sai do ar.

Só depois disso o recurso pode aparecer para um estúdio pagante.

## Uma variável de ambiente que falta

A tela mostra o registro A para o fotógrafo apontar, e lê o endereço de
`IP_PUBLICO`. Sem ela, a tela diz para falar com o suporte em vez de mostrar um
endereço em branco — mas o recurso fica pela metade.

No `.env.production` do servidor:

```
IP_PUBLICO=179.197.233.184
```

Não é segredo: é o mesmo endereço que qualquer `dig` no domínio devolve.

## O A vai direto para o VPS, sem proxy

Vale para a nossa zona e para a do fotógrafo. Dois motivos:

1. o certificado sob demanda é emitido pelo Caddy, **no VPS**. Com o proxy da
   Cloudflare na frente, quem termina o TLS é a Cloudflare, e o `on_demand`
   nunca é acionado;
2. evita a restrição de ToS da Cloudflare sobre servir imagem de origem externa
   pelo CDN gratuito — que é exatamente o que uma galeria faz.

**O risco não é o estado de hoje, é o de amanhã.** Medido em 26/08/2026, contra
`1.1.1.1` e pelo resolvedor local:

```
olumier.com.br                              -> 179.197.233.184
www.olumier.com.br                          -> 179.197.233.184
caroline-tedesco-fotografia.olumier.com.br  -> 179.197.233.184
```

Um endereço só, o do VPS. Hoje **não** há proxy no caminho.

A terceira linha é a mais útil das três, e vale como linha de base: ela é um
subdomínio de estúdio REAL, em produção, resolvendo direto para o VPS. Isso é a
prova de que o certificado sob demanda funciona hoje de verdade, e não só no
desenho — e é exatamente o que a zona do `galeriaatomo.com.br` precisa
reproduzir depois da troca de marca. Se depois da troca esse nome passar a
resolver para um endereço da Cloudflare, o TLS sob demanda parou, mesmo que a
página continue abrindo.

O perigo é que a Cloudflare cria registro novo **já com o proxy ligado por
padrão**. Quando a zona do `galeriaatomo.com.br` for montada, os A entram
laranja se ninguém disser o contrário — inclusive o curinga `*`, que é o que
serve os subdomínios de estúdio. E o defeito é traiçoeiro: a página abre normal,
com o certificado da Cloudflare, e só quebra no primeiro domínio próprio de
fotógrafo.

> Correção de 26/08/2026: este parágrafo dizia antes que parte da zona **já**
> estava proxiada, com base numa resolução minha que devolvia seis endereços da
> Cloudflare junto com o do VPS. Repetindo a medição com resolvedor explícito, o
> resultado é o de cima — um IP só. A recomendação não muda; a justificativa,
> sim, e ela passa a ser sobre o padrão da ferramenta, não sobre o estado atual.
