import { readFile } from 'node:fs/promises';
import { validateContent } from './content-rules.mjs';

const file = new URL('../src/content/site.json', import.meta.url);
const data = JSON.parse(await readFile(file, 'utf8'));
const errors = validateContent(data);
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Conteúdo válido.');
}
