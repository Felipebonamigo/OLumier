# Subdomínio por estúdio

`siriusfotografia.fotonio.com.br/lu-marino` — cada estúdio com seu endereço.

## Estado

| Parte | Situação |
|---|---|
| Código (roteamento, página do estúdio, porteiro do certificado) | ✅ pronto e testado |
| Caddy no servidor | ✅ configurado, todos os sites verificados no ar |
| Registros DNS na Cloudflare + troca de nameservers | ✅ feito, delegação confirmada no `.br` |
| Bind do Next (`-H`) compatível com a reescrita | ✅ corrigido — ver armadilha #2 abaixo |
| Certificado emitido de ponta a ponta (tenant real) | ✅ testado com tenant descartável, depois removido |
| DNSSEC (DS novo publicado no Registro.br) | ❌ **opcional — falta você publicar** |

## DNSSEC — opcional, mas foi deixado pra trás na migração

A troca de nameservers para a Cloudflare tirou o DS antigo do Registro.br e o
novo nunca foi publicado. O site funciona normal assim (sem DNSSEC, não é
"quebrado" — só perdeu essa camada extra). Pra religar, no Registro.br, no
mesmo lugar onde os nameservers foram trocados, tem um bloco `+ DNSSEC`:

- **Keytag:** `2371`
- **Digest:** `03CACB526C0D9A80421A5D8268542720688B71864041F16BFE5274B7BD1002AF`
- Algoritmo `13`, tipo de digest `2` (SHA-256)

Conferir se ainda bate com a chave publicada antes de colar (a Cloudflare pode
ter rotacionado): `dig DNSKEY fotonio.com.br @dayana.ns.cloudflare.com` no
servidor, e recalcular com `dnssec-dsfromkey` se mudou.

## Como funciona o certificado (e por que NÃO é curinga)

Cada estúdio ganha seu próprio certificado na primeira visita (*on-demand TLS*).

**Por que não curinga:** um certificado `*.fotonio.com.br` exige desafio DNS-01,
que exige o módulo de DNS da Cloudflare compilado no Caddy. O binário do servidor
não tem esse módulo, e trocá-lo num servidor com sete sites em produção seria
risco desnecessário.

### ⚠️ A armadilha que já nos mordeu

A primeira tentativa usou `*.fotonio.com.br` como **endereço do site** no
Caddyfile. Isso faz o Caddy tentar obter um certificado curinga de verdade por
ACME — que falha sem o módulo de DNS — e **essa falha derrubou o TLS do
`www.fotonio.com.br`**, que estava funcionando.

A configuração correta usa `https://` genérico com **matcher de host**:

```caddy
https:// {
	tls {
		on_demand
	}
	@estudio header_regexp host Host ^[a-z0-9-]+\.fotonio\.com\.br$
	route @estudio {
		encode gzip
		reverse_proxy localhost:3300
	}
	route {
		abort
	}
}
```

Assim o Caddy não tenta certificado curinga; cada subdomínio recebe o seu.

### A armadilha que já nos mordeu (2): `-H 127.0.0.1` quebra a reescrita

Depois do DNS pronto, o primeiro acesso real a um subdomínio devolvia
**HTTP 500**, com esse erro no log do serviço:

```
Failed to proxy https://localhost:3300/e/estudio-teste Error: write EPROTO ...wrong version number...
```

O domínio principal funcionava normal — só a reescrita de subdomínio quebrava.
Causa: no Next 16, `proxy.ts` roda como uma camada de rede de verdade (não mais
in-process como o antigo `middleware.ts`). Quando `NextResponse.rewrite()`
aponta para o mesmo servidor, o Next decide isso comparando a origem da
reescrita com a URL "de si mesmo" que ele monta a partir do bind (`-H`) e do
`X-Forwarded-Proto` que o Caddy envia (`https`, já que o Caddy termina o TLS).

O problema: o Next normaliza `127.0.0.1` para `localhost` numa parte do
código, mas não na outra. Com `ExecStart` usando `-H 127.0.0.1`, as duas URLs
ficam diferentes (`https://127.0.0.1:3300` vs `https://localhost:3300`) — o
Next conclui que o destino é "externo" e tenta buscar a página com uma conexão
HTTPS de verdade contra a própria porta 3300, que só fala HTTP puro (quem
termina TLS é o Caddy). Daí o `wrong version number`.

**Correção:** usar `-H localhost` no `ExecStart` do systemd, não `-H 127.0.0.1`.
Mesma segurança (só escuta em loopback), mas sem a normalização inconsistente.

```
ExecStart=/usr/local/bin/node /opt/fotonio/node_modules/next/dist/bin/next start -H localhost -p 3300
```

Isso não está em nenhum script do repositório — foi criado à mão direto no
servidor. Se o serviço for recriado do zero, lembrar deste detalhe.

### O porteiro (`/api/tls/permitir`)

Sem ele, o Caddy tentaria emitir certificado para **qualquer** domínio apontado
ao nosso IP. Alguém apontando mil subdomínios nos levaria ao limite de emissão da
Let's Encrypt — derrubando a emissão de **todos os sites do servidor**.

Só respondemos "pode" para subdomínio de estúdio que existe no banco.

## Como conferir depois do DNS pronto

```bash
node --env-file=.env.local scripts/testar-subdominio.mjs
```

E na prática: criar uma conta em produção e abrir `<slug>.fotonio.com.br`.
O certificado é emitido na primeira visita (leva alguns segundos).

## Detalhes do comportamento

- A **raiz** do subdomínio lista as galerias públicas e **sem senha** do estúdio.
  Galeria protegida não aparece: listá-la entregaria a existência da entrega de
  um casal para qualquer visitante.
- O **painel** não abre por subdomínio de estúdio — redireciona para o domínio
  principal, senão haveria dois endereços para a mesma tela e o cookie de sessão
  não valeria nos dois.
- É **reescrita**, não redirecionamento: o visitante continua vendo o endereço
  bonito.
- Subdomínios reservados (`www`, `app`, `admin`, `api`…) nunca viram estúdio.

## Backups do Caddyfile no servidor

- `/etc/caddy/Caddyfile.antes-subdominio` — antes de qualquer mudança
- `/etc/caddy/Caddyfile.com-curinga` — a tentativa que quebrou o www (não usar)
