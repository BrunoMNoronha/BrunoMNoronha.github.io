(() => {
  const root = document.querySelector('[data-admin-app]');
  if (!root) return;

  const $ = (selector) => root.querySelector(selector);
  const gatewayKey = 'portal.gatewayUrl';
  const sessionKey = 'portal.session';
  const contentPath = 'src/content/site.json';
  const editorialTypes = new Set(['projects', 'articles', 'posts']);
  const resumeTypes = new Set(['experiences', 'education', 'skills', 'certifications']);
  let gateway = localStorage.getItem(gatewayKey) || 'https://bruno-portfolio-github-gateway.bruno-portal-github-gateway.workers.dev';
  let session = sessionStorage.getItem(sessionKey) || '';
  let data = null;
  let sha = '';
  let activeType = 'profile';
  let activeId = 'profile';
  let dirty = false;
  let assets = [];

  const hashSession = new URLSearchParams(location.hash.slice(1)).get('session');
  if (hashSession) {
    session = hashSession;
    sessionStorage.setItem(sessionKey, session);
    history.replaceState(null, '', location.pathname + location.search);
  }

  function show(name) {
    for (const section of ['setup', 'login', 'dashboard']) $(`[data-${section}]`).hidden = section !== name;
  }

  function normalizedGateway(value) { return value.trim().replace(/\/$/, ''); }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (session) headers.set('Authorization', `Bearer ${session}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${gateway}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Falha (${response.status})`);
    return payload;
  }

  $('[data-gateway-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    gateway = normalizedGateway(new FormData(event.currentTarget).get('gateway'));
    localStorage.setItem(gatewayKey, gateway);
    boot();
  });

  $('[data-login-button]').addEventListener('click', () => {
    location.href = `${gateway}/auth/login?return_to=${encodeURIComponent(location.href)}`;
  });

  $('[data-logout]').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    sessionStorage.removeItem(sessionKey);
    session = '';
    location.reload();
  });

  $('[data-content-type]').addEventListener('change', (event) => {
    preserveActiveForm();
    activeType = event.target.value;
    activeId = activeType === 'profile' ? 'profile' : itemsFor(activeType)[0]?.id;
    renderEditor(dirty);
  });
  $('[data-field="locale"]').addEventListener('change', (event) => {
    const nextLocale = event.target.value;
    event.target.value = event.target.dataset.previousLocale || 'pt-BR';
    preserveActiveForm();
    event.target.value = nextLocale;
    renderEditor(dirty);
  });
  $('[data-new]').addEventListener('click', createItem);
  $('[data-delete]').addEventListener('click', deleteItem);
  $('[data-preview-button]').addEventListener('click', updatePreview);
  $('[data-editor-form]').addEventListener('input', () => { dirty = true; updatePreview(); });
  $('[data-editor-form]').addEventListener('submit', saveContent);
  $('[data-image-input]').addEventListener('change', uploadImage);
  $('[data-image-library]').addEventListener('change', selectExistingImage);
  addEventListener('beforeunload', (event) => { if (dirty) event.preventDefault(); });

  function itemsFor(type = activeType) {
    if (type === 'profile') return [data.profile];
    if (type === 'links') return data.profile.links;
    if (resumeTypes.has(type)) return data.resume[type];
    return data[type];
  }

  function setItems(type, items) {
    if (type === 'links') data.profile.links = items;
    else if (resumeTypes.has(type)) data.resume[type] = items;
    else data[type] = items;
  }

  function labelFor(item, locale) {
    if (activeType === 'links') return item.label;
    if (activeType === 'skills') return item.translations[locale]?.name || item.translations['pt-BR']?.name;
    if (activeType === 'profile') return 'Perfil público';
    return item.translations[locale]?.title || item.translations['pt-BR']?.title || 'Novo conteúdo';
  }

  function translationStats() {
    let published = 0, drafts = 0, pending = 0;
    for (const type of [...editorialTypes, ...resumeTypes]) {
      for (const item of itemsFor(type)) {
        const versions = Object.values(item.translations);
        published += versions.filter((version) => version.status === 'published').length;
        drafts += versions.filter((version) => version.status === 'draft').length;
        if (versions.some((version) => version.status === 'published') && versions.some((version) => version.status !== 'published')) pending++;
      }
    }
    for (const version of Object.values(data.profile.translations)) version.status === 'published' ? published++ : drafts++;
    for (const link of data.profile.links) link.status === 'published' ? published++ : drafts++;
    return { published, drafts, pending };
  }

  function renderDashboard() {
    const stats = translationStats();
    $('[data-published-count]').textContent = stats.published;
    $('[data-draft-count]').textContent = stats.drafts;
    $('[data-translation-count]').textContent = stats.pending;
    renderEditor();
  }

  function renderRecentChanges(changes) {
    const list = $('[data-recent-changes]');
    list.textContent = '';
    if (!changes.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Nenhuma alteração editorial registrada.';
      list.append(empty);
      return;
    }
    const formatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
    for (const change of changes) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = change.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = change.message;
      const sha = document.createElement('code');
      sha.textContent = change.sha;
      const meta = document.createElement('small');
      const committedAt = change.committedAt ? formatter.format(new Date(change.committedAt)) : 'data indisponível';
      meta.textContent = `${change.author} · ${committedAt}`;
      item.append(link, sha, meta);
      list.append(item);
    }
  }

  async function loadWorkflowStatus() {
    try {
      const workflow = await api('/api/workflow');
      $('[data-workflow-state]').textContent = workflow.label;
    } catch { $('[data-workflow-state]').textContent = 'Indisponível'; }
  }

  async function loadRecentChanges() {
    try {
      const result = await api('/api/changes');
      renderRecentChanges(result.changes);
    } catch {
      const list = $('[data-recent-changes]');
      list.textContent = '';
      const item = document.createElement('li');
      item.textContent = 'Histórico indisponível no momento.';
      list.append(item);
    }
  }

  function renderEditor(preserveDirty = false) {
    const localeControl = $('[data-field="locale"]');
    const locale = localeControl.value;
    localeControl.dataset.previousLocale = locale;
    const isProfile = activeType === 'profile';
    const isLink = activeType === 'links';
    const isSkill = activeType === 'skills';
    const isResume = resumeTypes.has(activeType);
    const isEditorial = editorialTypes.has(activeType);
    const list = $('[data-content-list]');
    list.innerHTML = '';

    for (const item of itemsFor()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.id = item.id || 'profile';
      button.setAttribute('aria-current', String((item.id || 'profile') === activeId));
      const status = isLink ? item.status : item.translations[locale]?.status;
      button.innerHTML = `<strong>${escapeHtml(labelFor(item, locale) || 'Sem título')}</strong><small>${status === 'published' ? 'Publicado' : 'Rascunho'}</small>`;
      button.addEventListener('click', () => {
        preserveActiveForm();
        activeId = item.id || 'profile';
        renderEditor(dirty);
      });
      list.append(button);
    }

    const item = isProfile ? data.profile : itemsFor().find((entry) => entry.id === activeId);
    if (!item && !isProfile) {
      $('[data-editor-title]').textContent = 'Nenhum item';
      $('[data-editor-form]').hidden = false;
      clearForm();
      configureFields({ isProfile, isLink, isSkill, isResume, isEditorial, hasItem: false });
      return;
    }
    const version = isLink ? null : item.translations[locale];
    $('[data-editor-title]').textContent = labelFor(item, locale) || 'Novo conteúdo';
    field('status', isLink ? item.status : (version.status || 'draft'));
    field('slug', isEditorial ? item.slug : '');
    field('title', isProfile ? version.headline : isLink ? item.label : isSkill ? version.name : version.title);
    field('displayName', isProfile ? item.name : '');
    field('location', isProfile ? (version.location || '') : '');
    field('organization', isResume && !isSkill ? version.organization : '');
    field('summary', isProfile ? version.bio : (isLink || isSkill ? '' : version.summary));
    field('body', isEditorial ? (version.body || []).join('\n\n') : (isResume && !isSkill ? (version.highlights || []).join('\n') : ''));
    field('publishedAt', isEditorial ? (version.publishedAt || '') : '');
    field('tags', isEditorial ? (item.technologies || item.tags || []).join(', ') : '');
    field('coverAlt', isProfile ? (version.photoAlt || '') : isEditorial ? (version.coverAlt || '') : '');
    field('startDate', isResume && !isSkill && activeType !== 'certifications' ? (item.startDate || '') : '');
    field('endDate', isResume && !isSkill && activeType !== 'certifications' ? (item.endDate || '') : '');
    field('order', (isResume || isLink) ? (item.order || '') : '');
    field('url', isLink ? item.url : activeType === 'certifications' ? (item.credentialUrl || '') : '');
    field('category', isSkill ? (item.category || '') : '');
    configureFields({ isProfile, isLink, isSkill, isResume, isEditorial, hasItem: true });
    const currentImage = isProfile ? item.photo : isEditorial ? item.cover : null;
    $('[data-image-status]').textContent = currentImage || 'Nenhuma imagem selecionada.';
    renderAssetOptions(currentImage);
    if (!preserveDirty) dirty = false;
    updatePreview();
  }

  function configureFields({ isProfile, isLink, isSkill, isResume, isEditorial, hasItem }) {
    $('[data-field="locale"]').closest('label').hidden = isLink;
    $('[data-slug-field]').hidden = !isEditorial;
    $('[data-name-field]').hidden = !isProfile;
    $('[data-location-field]').hidden = !isProfile;
    $('[data-organization-field]').hidden = !isResume || isSkill;
    $('[data-field="summary"]').closest('label').hidden = isLink || isSkill;
    $('[data-body-field]').hidden = !(isEditorial || (isResume && !isSkill));
    $('[data-body-help]').textContent = isEditorial ? 'Um parágrafo por bloco' : 'Um destaque por linha';
    $('[data-date-field]').hidden = !isEditorial;
    $('[data-tags-field]').hidden = !isEditorial;
    $('[data-start-field]').hidden = !(activeType === 'experiences' || activeType === 'education');
    $('[data-end-field]').hidden = !(activeType === 'experiences' || activeType === 'education');
    $('[data-order-field]').hidden = !(isResume || isLink);
    $('[data-url-field]').hidden = !(isLink || activeType === 'certifications');
    $('[data-category-field]').hidden = !isSkill;
    $('[data-image-field]').hidden = !(isEditorial || isProfile);
    $('[data-library-field]').hidden = !(isEditorial || isProfile);
    $('[data-alt-field]').hidden = !(isEditorial || isProfile);
    $('[data-delete]').hidden = isProfile || !hasItem;
    $('[data-new]').hidden = isProfile;
    $('[data-field="title"]').required = true;
    $('[data-field="summary"]').required = !(isLink || isSkill);
  }

  function clearForm() {
    for (const name of ['status', 'slug', 'title', 'displayName', 'location', 'organization', 'summary', 'body', 'publishedAt', 'tags', 'coverAlt', 'startDate', 'endDate', 'order', 'url', 'category']) field(name, name === 'status' ? 'draft' : '');
  }

  function field(name, fieldValue) { $(`[data-field="${name}"]`).value = fieldValue ?? ''; }
  function value(name) { return $(`[data-field="${name}"]`).value.trim(); }

  function createItem() {
    if (activeType === 'profile') return;
    preserveActiveForm();
    const id = crypto.randomUUID();
    const order = itemsFor().length + 1;
    let item;
    if (activeType === 'links') {
      item = { id, order, label: 'Novo link', url: '', kind: 'professional', status: 'draft' };
    } else if (activeType === 'skills') {
      item = { id, order, category: '', translations: { 'pt-BR': { name: 'Nova habilidade', status: 'draft' }, en: { name: 'New skill', status: 'draft' } } };
    } else if (resumeTypes.has(activeType)) {
      item = { id, order, translations: {
        'pt-BR': { title: 'Novo registro', organization: '', summary: '', highlights: [], status: 'draft' },
        en: { title: 'New entry', organization: '', summary: '', highlights: [], status: 'draft' },
      }};
      if (activeType === 'experiences' || activeType === 'education') Object.assign(item, { startDate: '', endDate: null });
      if (activeType === 'certifications') item.credentialUrl = null;
    } else {
      item = { id, slug: `novo-${activeType.slice(0, -1)}-${Date.now().toString().slice(-6)}`, featured: false, cover: null, translations: {
        'pt-BR': { title: 'Novo conteúdo', summary: '', coverAlt: '', body: [], status: 'draft', publishedAt: null },
        en: { title: 'New content', summary: '', coverAlt: '', body: [], status: 'draft', publishedAt: null },
      }};
      item[activeType === 'projects' ? 'technologies' : 'tags'] = [];
    }
    const items = itemsFor();
    items.unshift(item);
    activeId = id;
    dirty = true;
    renderEditor(true);
  }

  function deleteItem() {
    const item = itemsFor().find((entry) => entry.id === activeId);
    if (!item || !confirm(`Excluir “${labelFor(item, 'pt-BR')}”? O histórico continuará disponível no Git.`)) return;
    const nextItems = itemsFor().filter((entry) => entry.id !== activeId).map((entry, index) => ({ ...entry, order: entry.order ? index + 1 : entry.order }));
    setItems(activeType, nextItems);
    activeId = nextItems[0]?.id;
    dirty = true;
    renderEditor(true);
  }

  function preserveActiveForm() {
    if (!dirty || !data) return;
    const current = activeType === 'profile' ? data.profile : itemsFor().find((entry) => entry.id === activeId);
    if (current) applyForm();
  }

  function applyForm() {
    const locale = value('locale');
    if (activeType === 'profile') {
      data.profile.name = value('displayName');
      Object.assign(data.profile.translations[locale], { headline: value('title'), location: value('location'), bio: value('summary'), photoAlt: value('coverAlt'), status: value('status') });
      return data.profile;
    }
    const item = itemsFor().find((entry) => entry.id === activeId);
    if (!item) return null;
    if (activeType === 'links') {
      Object.assign(item, { label: value('title'), url: value('url'), status: value('status'), order: Number(value('order')) || 1 });
    } else if (activeType === 'skills') {
      Object.assign(item, { category: value('category'), order: Number(value('order')) || 1 });
      Object.assign(item.translations[locale], { name: value('title'), status: value('status') });
    } else if (resumeTypes.has(activeType)) {
      item.order = Number(value('order')) || 1;
      Object.assign(item.translations[locale], { title: value('title'), organization: value('organization'), summary: value('summary'), highlights: value('body').split(/\n+/).map((line) => line.trim()).filter(Boolean), status: value('status') });
      if (activeType === 'experiences' || activeType === 'education') Object.assign(item, { startDate: value('startDate'), endDate: value('endDate') || null });
      if (activeType === 'certifications') item.credentialUrl = value('url') || null;
    } else {
      item.slug = value('slug');
      Object.assign(item.translations[locale], { title: value('title'), summary: value('summary'), coverAlt: value('coverAlt'), body: value('body').split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean), status: value('status'), publishedAt: value('publishedAt') || null });
      item[activeType === 'projects' ? 'technologies' : 'tags'] = value('tags').split(',').map((tag) => tag.trim()).filter(Boolean);
    }
    return item;
  }

  async function saveContent(event) {
    event.preventDefault();
    const message = $('[data-form-message]');
    try {
      const item = applyForm();
      if (!item) throw new Error('Crie um item antes de salvar.');
      if (editorialTypes.has(activeType) && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) throw new Error('Use um slug com letras minúsculas, números e hífens.');
      const locale = value('locale');
      const version = activeType === 'links' ? item : item.translations[locale];
      if (editorialTypes.has(activeType) && version.status === 'published' && !version.publishedAt) throw new Error('Informe a data antes de publicar.');
      if (editorialTypes.has(activeType) && version.status === 'published' && item.cover && !version.coverAlt) throw new Error('Descreva a imagem de capa antes de publicar.');
      if (activeType === 'profile' && version.status === 'published' && item.photo && !version.photoAlt) throw new Error('Descreva a fotografia antes de publicar.');
      if (activeType === 'links' && version.status === 'published' && !version.url) throw new Error('Informe o endereço antes de publicar o link.');
      message.textContent = 'Salvando…';
      const result = await api('/api/content', { method: 'PUT', body: JSON.stringify({ path: contentPath, sha, content: data, message: `content(${locale}): update ${activeType}/${item.id || 'profile'}` }) });
      sha = result.sha;
      dirty = false;
      message.textContent = 'Alteração registrada no GitHub. A publicação foi iniciada.';
      renderDashboard();
      loadRecentChanges();
      loadWorkflowStatus();
    } catch (error) { message.textContent = error.message; }
  }

  function updatePreview() {
    const organization = value('organization');
    $('[data-preview-title]').textContent = value('title') || 'Título';
    $('[data-preview-summary]').textContent = [organization, value('summary')].filter(Boolean).join(' — ') || 'Resumo do conteúdo.';
    $('[data-preview-status]').textContent = value('status') === 'published' ? 'Publicado' : 'Rascunho';
    const body = $('[data-preview-body]');
    body.innerHTML = '';
    for (const paragraph of value('body').split(editorialTypes.has(activeType) ? /\n\s*\n/ : /\n+/).filter(Boolean)) {
      const p = document.createElement('p');
      p.textContent = paragraph;
      body.append(p);
    }
  }

  async function uploadImage(event) {
    const file = event.target.files?.[0];
    if (!file || !(editorialTypes.has(activeType) || activeType === 'profile')) return;
    const status = $('[data-image-status]');
    if (file.size > 4 * 1024 * 1024) { status.textContent = 'A imagem deve ter no máximo 4 MB.'; return; }
    status.textContent = 'Enviando imagem…';
    try {
      const content = await fileToBase64(file);
      const result = await api('/api/assets', { method: 'POST', body: JSON.stringify({ name: file.name, mime: file.type, content }) });
      const item = itemsFor().find((entry) => (entry.id || 'profile') === activeId);
      if (activeType === 'profile') item.photo = result.path;
      else item.cover = result.path;
      if (!assets.some((asset) => asset.path === result.path)) assets.unshift({ path: result.path, name: result.path.split('/').pop() });
      renderAssetOptions(result.path);
      dirty = true;
      status.textContent = result.path;
    } catch (error) { status.textContent = error.message; }
  }

  function selectExistingImage(event) {
    if (!(editorialTypes.has(activeType) || activeType === 'profile')) return;
    const item = itemsFor().find((entry) => (entry.id || 'profile') === activeId);
    if (activeType === 'profile') item.photo = event.target.value || null;
    else item.cover = event.target.value || null;
    $('[data-image-status]').textContent = event.target.value || 'Nenhuma imagem selecionada.';
    dirty = true;
  }

  function renderAssetOptions(selected) {
    const select = $('[data-image-library]');
    select.innerHTML = '<option value="">Nenhuma imagem</option>';
    for (const asset of assets) {
      const option = document.createElement('option');
      option.value = asset.path;
      option.textContent = asset.name;
      option.selected = asset.path === selected;
      select.append(option);
    }
  }

  function fileToBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }
  function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

  async function boot() {
    if (!gateway) { show('setup'); return; }
    $('[data-gateway-form] [name="gateway"]').value = gateway;
    if (!session) { show('login'); return; }
    try {
      const current = await api('/api/session');
      $('[data-session-state]').textContent = current.login;
      $('[data-logout]').hidden = false;
      const payload = await api(`/api/content?path=${encodeURIComponent(contentPath)}`);
      data = payload.content;
      sha = payload.sha;
      assets = (await api('/api/assets')).assets;
      show('dashboard');
      renderDashboard();
      loadWorkflowStatus();
      loadRecentChanges();
    } catch (error) {
      sessionStorage.removeItem(sessionKey);
      session = '';
      show('login');
      $('[data-session-state]').textContent = error.message;
    }
  }

  boot();
})();
