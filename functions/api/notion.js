const NOTION_VERSION = '2022-06-28';
function json(data, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
function titleProp(title) { return { title: [{ text: { content: title } }] }; }
function richTextProp(text) { return { rich_text: text ? [{ text: { content: text } }] : [] }; }
function dateProp(date) { return { date: { start: date } }; }
async function notionFetch(env, path, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, { ...options, headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Notion API HTTP ${res.status}`);
  return data;
}
async function getDatabaseSchema(env, databaseId) { return notionFetch(env, `/databases/${databaseId}`, { method: 'GET' }); }
function findPropertyName(schema, types, preferredNames = []) {
  const props = schema.properties || {};
  for (const name of preferredNames) if (props[name] && types.includes(props[name].type)) return name;
  for (const [name, value] of Object.entries(props)) if (types.includes(value.type)) return name;
  return null;
}
function buildProperties(schema, input) {
  const titleName = findPropertyName(schema, ['title'], ['Name', '제목', 'Title']);
  const dateName = findPropertyName(schema, ['date'], ['Date', '날짜', '일정']);
  const statusName = findPropertyName(schema, ['status', 'select'], ['Status', '상태']);
  const memoName = findPropertyName(schema, ['rich_text'], ['Memo', '메모', 'Description', '설명']);
  if (!titleName) throw new Error('Notion DB에 title 속성이 필요합니다. 예: Name');
  if (!dateName) throw new Error('Notion DB에 date 속성이 필요합니다. 예: Date');
  const properties = { [titleName]: titleProp(input.title), [dateName]: dateProp(input.date) };
  if (statusName && input.status) {
    const type = schema.properties[statusName].type;
    properties[statusName] = type === 'status' ? { status: { name: input.status } } : { select: { name: input.status } };
  }
  if (memoName) properties[memoName] = richTextProp(input.memo || '');
  return properties;
}
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!env.NOTION_TOKEN) return json({ message: 'Cloudflare 환경변수 NOTION_TOKEN이 없습니다.' }, 500);
    const body = await request.json().catch(() => null);
    if (!body) return json({ message: '요청 body가 비어 있습니다.' }, 400);
    const action = body.action || 'query';
    const databaseId = String(body.databaseId || '').replace(/-/g, '');
    if (!databaseId) return json({ message: 'databaseId가 필요합니다.' }, 400);
    if (action === 'query') return json(await notionFetch(env, `/databases/${databaseId}/query`, { method: 'POST', body: JSON.stringify({ page_size: 100 }) }));
    if (action === 'create') {
      const schema = await getDatabaseSchema(env, databaseId);
      return json(await notionFetch(env, '/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: databaseId }, properties: buildProperties(schema, body) }) }));
    }
    if (action === 'update') {
      if (!body.pageId) return json({ message: 'pageId가 필요합니다.' }, 400);
      const schema = await getDatabaseSchema(env, databaseId);
      return json(await notionFetch(env, `/pages/${body.pageId}`, { method: 'PATCH', body: JSON.stringify({ properties: buildProperties(schema, body) }) }));
    }
    if (action === 'delete') {
      if (!body.pageId) return json({ message: 'pageId가 필요합니다.' }, 400);
      return json(await notionFetch(env, `/pages/${body.pageId}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }));
    }
    return json({ message: `지원하지 않는 action입니다: ${action}` }, 400);
  } catch (error) { return json({ message: error.message || '서버 오류가 발생했습니다.' }, 500); }
}
