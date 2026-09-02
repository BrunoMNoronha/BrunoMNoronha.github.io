# Portal profissional Bruno Menezes

Portal bilíngue, currículo, portfólio e plataforma de conteúdo publicados como site estático no GitHub Pages.

## Estado do MVP

- Site público responsivo em PT-BR e inglês.
- Páginas de perfil, currículo, projetos, artigos e posts.
- Conteúdo estruturado com rascunho, publicação, data e relação entre traduções.
- SEO, Open Graph, sitemap e página 404.
- Painel editorial com preview e gravação versionada.
- Migração segura do currículo legado como rascunhos editáveis, sem exposição pública.
- Gateway separado para autenticação pela GitHub App, sem credenciais no navegador.
- Testes e publicação automática no GitHub Pages.

Os dados do currículo legado não foram publicados: permanecem material de migração até serem confirmados pelo proprietário.

## Uso local

Requer Node.js 22.12 ou superior.

```sh
npm install
npm run dev
```

Para validar a versão de produção:

```sh
npm test
npm run build
```

O conteúdo editorial fica em `src/content/site.json`. O painel fica em `/admin/` e só se torna operacional depois que o gateway em `services/github-gateway` for configurado e publicado.

No painel, as áreas **Perfil e currículo** permitem revisar, traduzir e publicar gradualmente experiências, formação, habilidades, certificações e links profissionais. Enquanto cada versão permanecer como rascunho, ela não aparece no site público.

## Publicação

O workflow `deploy.yml` gera o site apenas depois que testes e validações passam. No GitHub, configure **Settings → Pages → Source** como **GitHub Actions**. Se um build falhar, a implantação não ocorre e a última versão válida permanece no ar.
