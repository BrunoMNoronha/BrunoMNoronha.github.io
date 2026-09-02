# Gateway seguro do painel

Este Worker mantém as credenciais da GitHub App fora do navegador. Ele autentica exclusivamente o login configurado, guarda tokens em sessões temporárias no KV e limita a escrita ao conteúdo e às imagens do portal.

## Preparação

1. Crie uma GitHub App com callback `https://SEU-WORKER.workers.dev/auth/callback` e instale-a somente no repositório do portal.
2. Conceda permissões de repositório `Contents: Read and write`, `Metadata: Read-only` e `Actions: Read-only`.
3. Crie um namespace Workers KV para as sessões.
4. Informe o ID do KV em `wrangler.jsonc` e revise login, origem, repositório e branch.
5. Cadastre `GITHUB_CLIENT_ID` e `GITHUB_CLIENT_SECRET` como secrets do Worker; não os grave em arquivos versionados.
6. Publique o Worker e configure o endereço gerado como padrão do painel `/admin/`.

O gateway também expõe ao painel o estado da última publicação e os cinco commits editoriais mais recentes do arquivo de conteúdo.

Para desenvolvimento local, copie `.dev.vars.example` para `.dev.vars`. Os dois arquivos reais estão ignorados pelo Git.
