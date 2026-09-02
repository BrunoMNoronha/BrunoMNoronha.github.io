import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isPublished, isResumePublished, validateContent } from '../scripts/content-rules.mjs';

const data = JSON.parse(await readFile(new URL('../src/content/site.json', import.meta.url), 'utf8'));

test('o conteúdo estruturado respeita o contrato editorial', () => {
  assert.deepEqual(validateContent(data), []);
});

test('rascunhos nunca são considerados públicos', () => {
  assert.equal(isPublished(data.articles[0], 'pt-BR', new Date('2030-01-01')), false);
  assert.equal(isPublished(data.posts[0], 'en', new Date('2030-01-01')), false);
});

test('publicações futuras permanecem privadas', () => {
  const item = structuredClone(data.projects[0]);
  item.translations['pt-BR'].publishedAt = '2030-01-01';
  assert.equal(isPublished(item, 'pt-BR', new Date('2026-09-02')), false);
});

test('publicações válidas aparecem no idioma correspondente', () => {
  assert.equal(isPublished(data.projects[0], 'pt-BR', new Date('2026-09-02T23:59:59Z')), true);
  assert.equal(isPublished(data.projects[0], 'en', new Date('2026-09-02T23:59:59Z')), true);
});

test('currículo legado foi migrado sem tornar dados não confirmados públicos', () => {
  assert.equal(data.resume.experiences.length, 7);
  assert.equal(data.resume.education.length, 1);
  assert.equal(data.resume.skills.length, 12);
  assert.equal(data.resume.certifications.length, 2);
  for (const type of ['experiences', 'education', 'skills', 'certifications']) {
    for (const item of data.resume[type]) {
      assert.equal(isResumePublished(item, 'pt-BR'), false);
      assert.equal(isResumePublished(item, 'en'), false);
    }
  }
});

test('validação rejeita currículo incompleto que tente ser publicado', () => {
  const invalid = structuredClone(data);
  invalid.resume.experiences[0].translations.en.status = 'published';
  assert.match(validateContent(invalid).join('\n'), /publicação en sem título/);
});

test('validação rejeita links publicados com protocolo inseguro', () => {
  const invalid = structuredClone(data);
  invalid.profile.links.push({ id: 'unsafe-link', order: 1, label: 'Inválido', url: 'javascript:alert(1)', status: 'published' });
  assert.match(validateContent(invalid).join('\n'), /publicação inválida/);
});

test('imagem editorial publicada exige caminho seguro e texto alternativo', () => {
  const missingAlt = structuredClone(data);
  missingAlt.projects[0].cover = '/uploads/capa.webp';
  assert.match(validateContent(missingAlt).join('\n'), /sem texto alternativo/);

  const unsafePath = structuredClone(data);
  unsafePath.projects[0].cover = 'https://terceiro.example/capa.webp';
  assert.match(validateContent(unsafePath).join('\n'), /caminho inválido/);
});

test('fotografia do perfil exige referência local segura e descrição nos dois idiomas', () => {
  const invalid = structuredClone(data);
  invalid.profile.photo = '/uploads/foto.webp';
  assert.match(validateContent(invalid).join('\n'), /fotografia sem texto alternativo/);
});
