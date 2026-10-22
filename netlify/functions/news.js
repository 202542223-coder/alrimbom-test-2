// 복지관 이름으로 최신 뉴스 기사를 찾아 주는 함수 (Google 뉴스 RSS 사용, 외부 라이브러리 없음)
// 호출 예: /.netlify/functions/news?q=안양시관악장애인종합복지관
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=600'
};

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, '').trim();

const pick = (xml, tag) => {
  const m = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>'));
  return m ? decode(m[1]) : '';
};

function parseRss(xml, limit) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1];
    let title = pick(block, 'title');
    const source = pick(block, 'source');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const link = pick(block, 'link');
    const d = new Date(pick(block, 'pubDate'));
    if (!title || !/^https?:\/\//.test(link)) continue;
    items.push({ title, link, source, date: isNaN(d) ? '' : d.toISOString() });
  }
  return items;
}

exports.parseRss = parseRss;

exports.handler = async (event) => {
  const q = String((event.queryStringParameters || {}).q || '').trim().slice(0, 60);
  if (!q) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'q required', items: [] }) };
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent('"' + q + '" when:365d') + '&hl=ko&gl=KR&ceid=KR:ko';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (alrimbom news bot)' } });
    if (!res.ok) throw new Error('upstream ' + res.status);
    const xml = await res.text();
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ q, items: parseRss(xml, 8) }) };
  } catch (e) {
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'fetch failed', items: [] }) };
  }
};
