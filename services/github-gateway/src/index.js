const apiVersion = '2026-03-10';
const contentPath = 'src/content/site.json';
const sessionTtl = 8 * 60 * 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/auth/login' && request.method === 'GET') return startLogin(url, env);
      if (url.pathname === '/auth/callback' && request.method === 'GET') return finishLogin(url, env);
      if (url.pathname === '/auth/logout' && request.method === 'POST') return logout(request, env, cors);
      if (url.pathname === '/health') return json({ ok: true }, 200, cors);

      const session = await requireSession(request, env);
      if (url.pathname === '/api/session' && request.method === 'GET') return json({ login: session.login }, 200, cors);
      if (url.pathname === '/api/content' && request.method === 'GET') return readContent(session, env, cors, url.searchParams.get('path'));
      if (url.pathname === '/api/content' && request.method === 'PUT') return writeContent(request, session, env, cors);
      if (url.pathname === '/api/assets' && request.method === 'GET') return listAssets(session, env, cors);
      if (url.pathname === '/api/assets' && request.method === 'POST') return uploadAsset(request, session, env, cors);
      if (url.pathname === '/api/workflow' && request.method === 'GET') return workflowStatus(session, env, cors);
      if (url.pathname === '/api/changes' && request.method === 'GET') return recentChanges(session, env, cors);
      return json({ error: 'Rota não encontrada.' }, 404, cors);
    } catch (error) {
      const status = error.status || 500;
      return json({ error: status === 500 ? 'Falha interna no gateway.' : error.message }, status, cors);
    }
  },
};

async function startLogin(url, env) {
  const returnTo = url.searchParams.get('return_to');
  if (!isAllowedReturn(returnTo, env)) throw httpError(400, 'Destino de retorno inválido.');
  const state = randomToken();
  await env.SESSIONS.put(`state:${state}`, JSON.stringify({ returnTo }), { expirationTtl: 600 });
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
  authorize.searchParams.set('state', state);
  return Response.redirect(authorize, 302);
}

async function finishLogin(url, env) {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const pending = state && await env.SESSIONS.get(`state:${state}`, 'json');
  if (!state || !code || !pending) throw httpError(400, 'Solicitação de login inválida ou expirada.');
  await env.SESSIONS.delete(`state:${state}`);

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${url.origin}/auth/callback` }),
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) throw httpError(401, 'O GitHub recusou a autenticação.');

  const userResponse = await github('/user', token.access_token);
  const user = await userResponse.json();
  if (!userResponse.ok || user.login?.toLowerCase() !== env.ADMIN_LOGIN.toLowerCase()) throw httpError(403, 'Esta conta não está autorizada.');

  const sessionId = randomToken();
  const now = Date.now();
  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify({
    login: user.login,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || null,
    accessTokenExpiresAt: token.expires_in ? now + token.expires_in * 1000 : null,
    refreshTokenExpiresAt: token.refresh_token_expires_in ? now + token.refresh_token_expires_in * 1000 : null,
  }), { expirationTtl: sessionTtl });
  const destination = new URL(pending.returnTo);
  destination.hash = `session=${encodeURIComponent(sessionId)}`;
  return Response.redirect(destination, 302);
}

async function requireSession(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const sessionId = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!sessionId || !/^[A-Za-z0-9_-]{32,}$/.test(sessionId)) throw httpError(401, 'Sessão inválida.');
  let session = await env.SESSIONS.get(`session:${sessionId}`, 'json');
  if (!session) throw httpError(401, 'Sessão expirada.');
  if (session.accessTokenExpiresAt && session.accessTokenExpiresAt < Date.now() + 60_000) {
    session = await refreshSession(session, env);
    await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: sessionTtl });
  }
  return { ...session, sessionId };
}

async function refreshSession(session, env) {
  if (!session.refreshToken || (session.refreshTokenExpiresAt && session.refreshTokenExpiresAt <= Date.now())) throw httpError(401, 'Sessão expirada.');
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: session.refreshToken }),
  });
  const token = await response.json();
  if (!response.ok || !token.access_token) throw httpError(401, 'Não foi possível renovar a sessão.');
  return { ...session, accessToken: token.access_token, refreshToken: token.refresh_token, accessTokenExpiresAt: Date.now() + token.expires_in * 1000, refreshTokenExpiresAt: Date.now() + token.refresh_token_expires_in * 1000 };
}

async function logout(request, env, cors) {
  const authorization = request.headers.get('Authorization') || '';
  const sessionId = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (sessionId) await env.SESSIONS.delete(`session:${sessionId}`);
  return json({ ok: true }, 200, cors);
}

async function readContent(session, env, cors, requestedPath) {
  if (requestedPath && requestedPath !== contentPath) throw httpError(400, 'Arquivo não permitido.');
  const response = await github(`/repos/${env.GITHUB_REPOSITORY}/contents/${contentPath}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, session.accessToken);
  const file = await response.json();
  if (!response.ok) throw githubError(response, file);
  return json({ path: contentPath, sha: file.sha, content: JSON.parse(decodeBase64(file.content)) }, 200, cors);
}

async function writeContent(request, session, env, cors) {
  const body = await request.json();
  if (body.path !== contentPath || !body.sha || typeof body.content !== 'object') throw httpError(400, 'Alteração inválida.');
  const validationErrors = validatePortalContent(body.content);
  if (validationErrors.length) throw httpError(422, `Conteúdo inválido: ${validationErrors[0]}`);
  const serialized = JSON.stringify(body.content, null, 2) + '\n';
  if (serialized.length > 2_000_000) throw httpError(413, 'O arquivo de conteúdo excedeu o limite.');
  const response = await github(`/repos/${env.GITHUB_REPOSITORY}/contents/${contentPath}`, session.accessToken, {
    method: 'PUT',
    body: JSON.stringify({ message: cleanMessage(body.message), content: encodeBase64(serialized), sha: body.sha, branch: env.GITHUB_BRANCH }),
  });
  const result = await response.json();
  if (!response.ok) throw githubError(response, result);
  return json({ sha: result.content.sha, commit: result.commit.sha }, 200, cors);
}

async function uploadAsset(request, session, env, cors) {
  const body = await request.json();
  const allowed = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' };
  const extension = allowed[body.mime];
  if (!extension || typeof body.content !== 'string') throw httpError(400, 'Formato de imagem não permitido.');
  if (body.content.length > 5_600_000) throw httpError(413, 'A imagem excedeu o limite de 4 MB.');
  const stem = String(body.name || 'imagem').replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'imagem';
  const filename = `${new Date().toISOString().slice(0, 10)}-${randomToken().slice(0, 8)}-${stem}.${extension}`;
  const path = `public/uploads/${filename}`;
  const response = await github(`/repos/${env.GITHUB_REPOSITORY}/contents/${path}`, session.accessToken, {
    method: 'PUT', body: JSON.stringify({ message: `asset: add ${filename}`, content: body.content, branch: env.GITHUB_BRANCH }),
  });
  const result = await response.json();
  if (!response.ok) throw githubError(response, result);
  return json({ path: `/uploads/${filename}`, sha: result.content.sha, commit: result.commit.sha }, 201, cors);
}

async function listAssets(session, env, cors) {
  const response = await github(`/repos/${env.GITHUB_REPOSITORY}/contents/public/uploads?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, session.accessToken);
  if (response.status === 404) return json({ assets: [] }, 200, cors);
  const result = await response.json();
  if (!response.ok) throw githubError(response, result);
  const assets = result.filter((entry) => entry.type === 'file' && /\.(?:png|jpe?g|webp|avif)$/i.test(entry.name)).map((entry) => ({ name: entry.name, path: `/uploads/${entry.name}`, size: entry.size }));
  return json({ assets }, 200, cors);
}

async function workflowStatus(session, env, cors) {
  const response = await github(`/repos/${env.GITHUB_REPOSITORY}/actions/runs?branch=${encodeURIComponent(env.GITHUB_BRANCH)}&per_page=1`, session.accessToken);
  const result = await response.json();
  if (!response.ok) throw githubError(response, result);
  const run = result.workflow_runs?.[0];
  const label = !run ? 'Sem publicação' : run.status !== 'completed' ? 'Em andamento' : run.conclusion === 'success' ? 'Concluída' : 'Com erro';
  return json({ label, status: run?.status || null, conclusion: run?.conclusion || null, url: run?.html_url || null }, 200, cors);
}

async function recentChanges(session, env, cors) {
  const query = new URLSearchParams({ sha: env.GITHUB_BRANCH, path: contentPath, per_page: '5' });
  const response = await github(`/repos/${env.GITHUB_REPOSITORY}/commits?${query}`, session.accessToken);
  const result = await response.json();
  if (!response.ok) throw githubError(response, result);
  const changes = result.map((entry) => ({
    sha: entry.sha.slice(0, 7),
    message: String(entry.commit?.message || 'Alteração editorial').split('\n')[0].slice(0, 120),
    author: entry.author?.login || entry.commit?.author?.name || 'GitHub',
    committedAt: entry.commit?.author?.date || null,
    url: entry.html_url,
  }));
  return json({ changes }, 200, cors);
}

function github(path, token, init = {}) {
  return fetch(`https://api.github.com${path}`, { ...init, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': apiVersion, 'User-Agent': 'Bruno-Menezes-Professional-Portal', ...(init.headers || {}) } });
}
function githubError(response, body) { return httpError(response.status === 409 ? 409 : 502, response.status === 409 ? 'O conteúdo mudou no GitHub. Recarregue antes de salvar.' : (body.message || 'Falha ao comunicar com o GitHub.')); }
function cleanMessage(message) { return String(message || 'content: update portal').replace(/[\r\n]+/g, ' ').slice(0, 120); }
function validatePortalContent(data) {
  const errors = [];
  const ids = new Set();
  if (!data?.profile?.name) errors.push('perfil sem nome público');
  for (const locale of ['pt-BR', 'en']) {
    const profile = data?.profile?.translations?.[locale];
    if (!profile || !['draft', 'published'].includes(profile.status)) errors.push(`perfil ${locale} inválido`);
    if (profile?.status === 'published' && (!profile.headline || !profile.bio)) errors.push(`perfil ${locale} incompleto`);
    if (profile?.status === 'published' && data?.profile?.photo && !profile.photoAlt) errors.push(`perfil ${locale} com fotografia sem texto alternativo`);
  }
  if (data?.profile?.photo && !/^\/uploads\/[a-zA-Z0-9._-]+$/.test(data.profile.photo)) errors.push('perfil com fotografia inválida');
  if (!Array.isArray(data?.profile?.links)) errors.push('links profissionais devem ser uma lista');
  for (const link of data?.profile?.links ?? []) {
    if (!link.id || ids.has(link.id)) errors.push(`link com id ausente ou duplicado: ${link.id}`); ids.add(link.id);
    if (!['draft', 'published'].includes(link.status)) errors.push(`link ${link.id} com estado inválido`);
    if (link.status === 'published' && (!link.label || !validPublicUrl(link.url))) errors.push(`link ${link.id} publicado incompleto`);
  }
  for (const type of ['experiences', 'education', 'skills', 'certifications']) {
    const items = data?.resume?.[type];
    if (!Array.isArray(items)) { errors.push(`resume.${type} deve ser uma lista`); continue; }
    for (const item of items) {
      if (!item.id || ids.has(item.id)) errors.push(`${type} com id ausente ou duplicado: ${item.id}`); ids.add(item.id);
      if (!Number.isInteger(item.order) || item.order < 1) errors.push(`${type}/${item.id} com ordem inválida`);
      if (['experiences', 'education'].includes(type)) {
        if (item.startDate && !/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(item.startDate)) errors.push(`${type}/${item.id} com início inválido`);
        if (item.endDate && !/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(item.endDate)) errors.push(`${type}/${item.id} com fim inválido`);
      }
      if (type === 'certifications' && item.credentialUrl && !validPublicUrl(item.credentialUrl)) errors.push(`${type}/${item.id} com credencial inválida`);
      for (const locale of ['pt-BR', 'en']) {
        const version = item.translations?.[locale];
        if (!version || !['draft', 'published'].includes(version.status)) { errors.push(`${type}/${item.id} com tradução ${locale} inválida`); continue; }
        const title = type === 'skills' ? version.name : version.title;
        if (version.status === 'published' && !title) errors.push(`${type}/${item.id} publicado sem título em ${locale}`);
        if (version.status === 'published' && ['experiences', 'education'].includes(type) && (!version.organization || !item.startDate)) errors.push(`${type}/${item.id} publicado incompleto em ${locale}`);
      }
    }
  }
  for (const collection of ['projects', 'articles', 'posts']) {
    if (!Array.isArray(data?.[collection])) { errors.push(`${collection} deve ser uma lista`); continue; }
    const slugs = new Set();
    for (const item of data[collection]) {
      if (!item.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug || '')) errors.push(`${collection} contém id ou slug inválido`);
      if (ids.has(item.id)) errors.push(`id duplicado: ${item.id}`); ids.add(item.id);
      if (slugs.has(item.slug)) errors.push(`slug duplicado em ${collection}: ${item.slug}`); slugs.add(item.slug);
      if (item.cover && !/^\/uploads\/[a-zA-Z0-9._-]+$/.test(item.cover)) errors.push(`${collection}/${item.slug} com imagem inválida`);
      for (const link of item.links ?? []) if (!link.label || !validPublicUrl(link.url)) errors.push(`${collection}/${item.slug} com link inválido`);
      for (const locale of ['pt-BR', 'en']) {
        const version = item.translations?.[locale];
        if (!version || !['draft', 'published'].includes(version.status)) { errors.push(`tradução ${locale} inválida em ${item.slug}`); continue; }
        if (version.status === 'published' && (!version.title || !version.summary || !version.publishedAt)) errors.push(`publicação ${locale} incompleta em ${item.slug}`);
        if (version.status === 'published' && item.cover && !version.coverAlt) errors.push(`imagem de ${item.slug} sem texto alternativo em ${locale}`);
      }
    }
  }
  return errors;
}
function validPublicUrl(value) { try { return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol); } catch { return false; } }
function corsHeaders(request, env) { const origin = request.headers.get('Origin'); return origin === env.ALLOWED_ORIGIN ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', Vary: 'Origin' } : {}; }
function isAllowedReturn(value, env) { try { return new URL(value).origin === env.ALLOWED_ORIGIN; } catch { return false; } }
function randomToken() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decodeBase64(value) { const bytes = Uint8Array.from(atob(value.replace(/\s/g, '')), (char) => char.charCodeAt(0)); return new TextDecoder().decode(bytes); }
function encodeBase64(value) { const bytes = new TextEncoder().encode(value); let binary = ''; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(binary); }
function json(body, status, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } }); }
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
