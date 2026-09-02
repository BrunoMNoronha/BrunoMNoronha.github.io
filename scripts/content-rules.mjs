export const collections = ['projects', 'articles', 'posts'];
export const locales = ['pt-BR', 'en'];

export function isPublished(item, locale, today = new Date()) {
  const translation = item.translations?.[locale];
  if (!translation || translation.status !== 'published' || !translation.publishedAt) return false;
  const publishDate = new Date(`${translation.publishedAt}T00:00:00Z`);
  return Number.isFinite(publishDate.valueOf()) && publishDate <= today;
}

export function isResumePublished(item, locale) {
  return item.translations?.[locale]?.status === 'published';
}

function validUrl(value) {
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol); } catch { return false; }
}

export function validateContent(data) {
  const errors = [];
  const ids = new Set();
  if (!data.profile?.name) errors.push('perfil: nome público ausente');
  for (const locale of locales) {
    const profile = data.profile?.translations?.[locale];
    if (!profile || !['draft', 'published'].includes(profile.status)) errors.push(`perfil ${locale}: estado inválido`);
    if (profile?.status === 'published' && (!profile.headline || !profile.bio)) errors.push(`perfil ${locale}: campos públicos incompletos`);
    if (profile?.status === 'published' && data.profile?.photo && !profile.photoAlt) errors.push(`perfil ${locale}: fotografia sem texto alternativo`);
  }
  if (data.profile?.photo && !/^\/uploads\/[a-zA-Z0-9._-]+$/.test(data.profile.photo)) errors.push('perfil: fotografia com caminho inválido');
  if (!Array.isArray(data.profile?.links)) errors.push('profile.links: deve ser uma lista');
  for (const link of data.profile?.links ?? []) {
    if (!link.id || ids.has(link.id)) errors.push(`link: id ausente ou duplicado ${link.id}`);
    ids.add(link.id);
    if (!['draft', 'published'].includes(link.status)) errors.push(`link ${link.id}: estado inválido`);
    if (link.status === 'published' && (!link.label || !validUrl(link.url))) errors.push(`link ${link.id}: publicação inválida`);
  }

  for (const type of ['experiences', 'education', 'skills', 'certifications']) {
    const items = data.resume?.[type];
    if (!Array.isArray(items)) { errors.push(`resume.${type}: deve ser uma lista`); continue; }
    for (const item of items) {
      if (!item.id || ids.has(item.id)) errors.push(`resume.${type}: id ausente ou duplicado ${item.id}`);
      ids.add(item.id);
      if (!Number.isInteger(item.order) || item.order < 1) errors.push(`resume.${type}/${item.id}: ordem inválida`);
      if (['experiences', 'education'].includes(type)) {
        if (item.startDate && !/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(item.startDate)) errors.push(`resume.${type}/${item.id}: início inválido`);
        if (item.endDate && !/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(item.endDate)) errors.push(`resume.${type}/${item.id}: fim inválido`);
      }
      if (type === 'certifications' && item.credentialUrl && !validUrl(item.credentialUrl)) errors.push(`resume.${type}/${item.id}: credencial inválida`);
      for (const locale of locales) {
        const version = item.translations?.[locale];
        if (!version || !['draft', 'published'].includes(version.status)) { errors.push(`resume.${type}/${item.id}: tradução ${locale} inválida`); continue; }
        const title = type === 'skills' ? version.name : version.title;
        if (version.status === 'published' && !title) errors.push(`resume.${type}/${item.id}: publicação ${locale} sem título`);
        if (version.status === 'published' && ['experiences', 'education'].includes(type) && (!version.organization || !item.startDate)) errors.push(`resume.${type}/${item.id}: publicação ${locale} incompleta`);
      }
    }
  }

  for (const collection of collections) {
    if (!Array.isArray(data[collection])) { errors.push(`${collection}: deve ser uma lista`); continue; }
    const slugs = new Set();
    for (const item of data[collection]) {
      if (!item.id || !item.slug) errors.push(`${collection}: item sem id ou slug`);
      if (ids.has(item.id)) errors.push(`id duplicado: ${item.id}`);
      ids.add(item.id);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug ?? '')) errors.push(`${collection}: slug inválido ${item.slug}`);
      if (slugs.has(item.slug)) errors.push(`${collection}: slug duplicado ${item.slug}`);
      slugs.add(item.slug);
      if (item.cover && !/^\/uploads\/[a-zA-Z0-9._-]+$/.test(item.cover)) errors.push(`${collection}/${item.slug}: imagem com caminho inválido`);
      for (const link of item.links ?? []) if (!link.label || !validUrl(link.url)) errors.push(`${collection}/${item.slug}: link inválido`);
      for (const locale of locales) {
        const translation = item.translations?.[locale];
        if (!translation) { errors.push(`${collection}/${item.slug}: tradução ${locale} ausente`); continue; }
        if (!['draft', 'published'].includes(translation.status)) errors.push(`${collection}/${item.slug}: estado ${locale} inválido`);
        if (translation.status === 'published' && (!translation.title || !translation.summary || !translation.publishedAt)) {
          errors.push(`${collection}/${item.slug}: versão ${locale} publicada incompleta`);
        }
        if (translation.status === 'published' && item.cover && !translation.coverAlt) errors.push(`${collection}/${item.slug}: imagem publicada sem texto alternativo em ${locale}`);
      }
    }
  }
  return errors;
}
