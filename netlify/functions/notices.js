// 복지관 이름(또는 주소)만으로 홈페이지를 찾고, 그 홈페이지의 "공지사항" 목록을 읽어 오는 함수
// 호출 예: /.netlify/functions/notices?q=안양시관악장애인종합복지관
//          /.netlify/functions/notices?q=이름&url=https://복지관주소  (주소를 알고 있으면 더 빠르고 정확)
// 외부 라이브러리 없음 (Node 18+ 의 fetch 사용)
//
// [선택] 네이버 검색 API 키가 있으면 홈페이지 찾기가 더 안정적입니다.
//   Netlify → Site configuration → Environment variables 에
//   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 를 넣어 주세요. (없어도 동작합니다)
const dns = require('dns').promises;
const net = require('net');

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=600'
};
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const DEADLINE_MS = 9000;
const BLOCK_HOSTS = /(naver\.com|daum\.net|kakao\.com|google\.|bing\.com|youtube\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|tistory\.com|namu\.wiki|wikipedia\.org|blog\.|cafe\.|news|mapstory|kakaomap|map\.|bokjiro\.go\.kr|work24|saramin|jobkorea|incruit|tripadvisor|dcinside|ruliweb|brunch\.co\.kr)/i;

/* ---------- 안전장치: 내부망 주소 접근 차단 ---------- */
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) return /^(::1|fc|fd|fe80)/i.test(ip) || ip === '::';
  const p = ip.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}
async function assertPublic(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol)) throw new Error('bad protocol');
  const h = url.hostname;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) throw new Error('blocked host');
  if (net.isIP(h)) { if (isPrivateIp(h)) throw new Error('blocked ip'); return; }
  const addrs = await dns.lookup(h, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('blocked ip');
}

/* ---------- 페이지 가져오기 (인코딩 자동 판별: UTF-8 / EUC-KR) ---------- */
async function fetchPage(u, opts = {}) {
  let url = u;
  for (let i = 0; i < 5; i++) {
    await assertPublic(url);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout || 4000);
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual', signal: ctl.signal,
        headers: Object.assign({ 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5', 'Upgrade-Insecure-Requests': '1', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin', 'Referer': new URL(url).origin + '/' }, opts.headers || {})
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url).href; clearTimeout(timer); continue;
      }
      if (!res.ok) throw new Error('http ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      clearTimeout(timer);
      return { url, html: decodeBuf(buf.subarray(0, 2 * 1024 * 1024), res.headers.get('content-type') || '') };
    } catch (e) { clearTimeout(timer); throw e; }
  }
  throw new Error('too many redirects');
}
function decodeBuf(buf, contentType) {
  let cs = (contentType.match(/charset=([\w-]+)/i) || [])[1];
  if (!cs) { const head = buf.subarray(0, 3000).toString('latin1'); cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1]; }
  cs = (cs || 'utf-8').toLowerCase();
  if (cs === 'ks_c_5601-1987' || cs === 'euc_kr' || cs === 'cp949' || cs === 'ms949') cs = 'euc-kr';
  try { return new TextDecoder(cs).decode(buf); } catch (e) { return new TextDecoder('utf-8').decode(buf); }
}

/* ---------- HTML 다루기 ---------- */
const decodeEnt = s => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const clean = s => decodeEnt(String(s || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (attrs, name) => { const m = attrs.match(new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? decodeEnt(m[2] ?? m[3] ?? m[4] ?? '') : ''; };
const abs = (href, base) => { try { return new URL(href, base).href; } catch (e) { return ''; } };

/* ---------- 1) 홈페이지 찾기 ---------- */
function decodeBingHref(h) {
  try {
    const u = new URL(h);
    if (/bing\.com$/.test(u.hostname) && u.pathname.startsWith('/ck/')) {
      const v = u.searchParams.get('u') || '';
      if (v.startsWith('a1')) return Buffer.from(v.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    }
  } catch (e) {}
  return h;
}
async function searchLinks(name) {
  const query = name + ' 공식 홈페이지';
  const found = [];
  const id = process.env.NAVER_CLIENT_ID, secret = process.env.NAVER_CLIENT_SECRET;
  if (id && secret) {
    try {
      const r = await fetch('https://openapi.naver.com/v1/search/webkr.json?display=10&query=' + encodeURIComponent(query), { headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret } });
      if (r.ok) { const d = await r.json(); (d.items || []).forEach(i => found.push(i.link)); }
    } catch (e) {}
  }
  if (found.length < 3) {
    try {
      const { html } = await fetchPage('https://html.duckduckgo.com/html/?kl=kr-kr&q=' + encodeURIComponent(query), { timeout: 3500 });
      for (const m of html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)) {
        let h = decodeEnt(m[1]); if (h.startsWith('//')) h = 'https:' + h;
        try { const u = new URL(h); if (u.searchParams.get('uddg')) h = u.searchParams.get('uddg'); } catch (e) {}
        found.push(h);
      }
    } catch (e) {}
  }
  if (found.length < 3) {
    try {
      const { html } = await fetchPage('https://www.bing.com/search?setlang=ko&cc=kr&q=' + encodeURIComponent(query), { timeout: 3500 });
      for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?<a[^>]+href="([^"]+)"/g)) found.push(decodeBingHref(decodeEnt(m[1])));
    } catch (e) {}
  }
  return found;
}
function rankHomepages(links, name) {
  const key = name.replace(/\s+/g, '').slice(0, 4);
  const seen = new Set(), out = [];
  for (const l of links) {
    let u; try { u = new URL(l); } catch (e) { continue; }
    if (!/^https?:$/.test(u.protocol) || BLOCK_HOSTS.test(u.hostname)) continue;
    if (seen.has(u.hostname)) continue; seen.add(u.hostname);
    let s = 0;
    if (/\.or\.kr$/.test(u.hostname)) s += 4;
    if (/\.(go\.kr|org|kr)$/.test(u.hostname)) s += 1;
    if (u.pathname.length <= 1) s += 2;                       // 메인 주소일수록 가산
    if (/(board|bbs|view|read|article|download)/i.test(u.pathname + u.search)) s -= 3; // 개별 글 주소는 감점
    if (key && decodeURIComponent(l).includes(key)) s += 1;
    out.push({ url: u.pathname.length > 1 && s < 4 ? u.origin + '/' : l, s });
  }
  return out.sort((a, b) => b.s - a.s).map(o => o.url);
}

/* 찾은 홈페이지가 정말 그 복지관인지 확인 (지역명 + 이름 핵심어가 페이지에 있어야 함) */
const GENERIC = /(장애인|종합|사회|복지관|복지센터|복지재단|사회복지|법인|재단|센터|노인|청소년|아동|가족|지역)/g;
function verifyHome(name, html) {
  const n = name.replace(/\s+/g, '');
  const text = clean(html).replace(/\s+/g, '');
  const reg = n.match(/^[가-힣]{1,4}?(특별시|광역시|특별자치시|특별자치도|시|군|구)/);
  let rest = n;
  if (reg) {
    const stem = reg[0].replace(/(특별시|광역시|특별자치시|특별자치도|시|군|구)$/, '');
    if (stem && !text.includes(stem)) return false;           // 예) '안양'이 없으면 다른 지역 복지관
    rest = n.slice(reg[0].length);
  }
  const core = rest.replace(GENERIC, '');
  if (core.length >= 2 && !text.includes(core.slice(0, 4))) return false;   // 예) '관악'
  return true;
}

/* ---------- 2) 홈페이지에서 공지사항 게시판 주소 찾기 ---------- */
const BOARD_WORDS = [['공지사항', 10], ['공지', 8], ['새소식', 7], ['알림마당', 6], ['알림', 4], ['소식', 3], ['복지관소식', 6], ['게시판', 2]];
const BOARD_NEG = /(채용|입찰|후원|자원봉사|갤러리|사진|동영상|faq|자주|설문|이용안내|오시는|개인정보|저작권|로그인|회원|사이트맵)/i;
function boardCandidates(html, base) {
  const scored = new Map();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], 'href'); if (!href || /^(javascript|mailto|tel):|^#/i.test(href)) continue;
    const text = clean(m[2]).replace(/\s+/g, ''); if (!text || text.length > 14) continue;
    let s = 0; for (const [w, v] of BOARD_WORDS) if (text.includes(w)) s = Math.max(s, v);
    if (!s || BOARD_NEG.test(text)) continue;
    if (text === '공지사항') s += 3;
    const u = abs(href, base); if (!u) continue;
    if (!scored.has(u) || scored.get(u) < s) scored.set(u, s);
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 4);
}

/* ---------- 3) 게시판 목록 읽기 (제목 + 날짜가 같이 있는 줄만 공지로 인정) ---------- */
// 날짜 표기가 2026-10-15 / 26-10-15 / 10-15(그누보드 기본: 올해 글은 월-일만 표시) 모두 가능
const pad2 = n => String(n).padStart(2, '0');
function findDate(block) {
  const text = clean(block.replace(/<a\b[\s\S]*?<\/a>/gi, ' '));   // 제목 속 숫자와 헷갈리지 않게 링크 밖에서만 찾기
  let m = text.match(/(20\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = text.match(/(?<!\d)(\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `20${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = text.match(/(?<![\d])(\d{1,2})\s*[-./]\s*(\d{1,2})(?![\d])/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
    const now = new Date(Date.now() + 9 * 3600 * 1000);                 // 한국 시간 기준
    let y = now.getUTCFullYear();
    if (Date.UTC(y, +m[1] - 1, +m[2]) > now.getTime() + 2 * 86400000) y -= 1;   // 미래 날짜면 작년 글
    return `${y}-${pad2(m[1])}-${pad2(m[2])}`;
  }
  m = clean(block).match(/(20\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
  return m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : '';
}
// 항목별 칸(분류·상태·작성자·조회수·마감일)을 뽑아 내기 위한 도우미
const STATUS_RE = /^(모집중|진행중|접수중|채용중|마감|모집마감|접수마감|채용마감|종료|완료|채용완료|상시)$/;
function findDeadline(text, date) {
  const m = text.match(/(?:~|∼|마감|까지)\s*:?\s*(?:(20\d{2})\s*[-./년]\s*)?(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!m) return '';
  const mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  let y = m[1] ? +m[1] : +date.slice(0, 4);
  let out = `${y}-${pad2(mo)}-${pad2(d)}`;
  if (!m[1] && out < date) out = `${y + 1}-${pad2(mo)}-${pad2(d)}`;   // 12월 글의 1월 마감 등
  return out;
}
function rowExtras(b, bestText) {
  const x = { cat: '', writer: '', views: '', status: '', pinned: false };
  for (const a of b.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const t = clean(a[2]);
    if (t && t !== bestText && t.length <= 12 && (/cate/i.test(attr(a[1], 'class')) || /[?&]sca=/.test(attr(a[1], 'href')))) { x.cat = t.replace(/^\[|\]$/g, ''); break; }
  }
  let numSeen = false;
  for (const c of b.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
    const cls = attr(c[1], 'class');
    const t = clean(c[2]);
    if (/td_num2/.test(cls)) { numSeen = true; if (/공지/.test(t)) x.pinned = true; continue; }          // 그누보드: 번호 칸
    if (t === '공지') { numSeen = true; x.pinned = true; continue; }                                 // 번호 칸에 '공지'
    if (!t || t.includes(bestText.slice(0, 12))) continue;
    if (/\d\s*[-./]\s*\d/.test(t)) continue;                       // 날짜 칸
    if (STATUS_RE.test(t)) { x.status = t; continue; }
    if (/cate|gubun|type|part/i.test(cls) && t.length <= 12) { x.cat = x.cat || t; continue; }
    if (/name|writer|author/i.test(cls)) { x.writer = t.slice(0, 20); continue; }
    if (/hit|view|read|count/i.test(cls) && /^\d+$/.test(t)) { x.views = t; continue; }
    if (/^\d{1,7}$/.test(t)) { if (!numSeen) numSeen = true; else x.views = x.views || t; continue; }   // 번호 → 조회수 순서
    if (!x.writer && t.length <= 20 && !/^(공지|NEW)$/i.test(t)) x.writer = t;
  }
  return x;
}
function parseList(html, base) {
  const rows = [], seen = new Set();
  const blocks = html.match(/<tr\b[\s\S]*?<\/tr>|<li\b[\s\S]*?<\/li>|<dl\b[\s\S]*?<\/dl>/gi) || [];
  for (const b of blocks) {
    if (b.length > 4000) continue;
    const date = findDate(b);
    if (!date) continue;
    let best = null;
    for (const a of b.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const text = clean(a[2]).replace(/^(공지|NEW|new|N)\s+/, '').replace(/\s*(NEW|new)$/, '');
      if (text.length < 4 || /^(이전|다음|목록|more|더보기|처음|마지막)/i.test(text)) continue;
      if (!best || text.length > best.text.length) best = { text, attrs: a[1] };
    }
    if (!best || seen.has(best.text)) continue;
    seen.add(best.text);
    const href = attr(best.attrs, 'href');
    const link = (!href || /^(javascript|#)/i.test(href)) ? base : abs(href, base);   // 글 주소를 알 수 없으면 목록 주소로
    const ex = rowExtras(b, best.text);
    let title = best.text;
    const bm = title.match(/^\[([^\]]{1,10})\]\s*(.+)$/);
    if (bm) { if (!ex.cat) ex.cat = bm[1]; title = bm[2]; }
    const sm = title.match(/^[\(\[](마감|모집중|접수중|진행중|모집마감|접수마감|종료)[\)\]]\s*(.+)$/);
    if (sm) { if (!ex.status) ex.status = sm[1]; title = sm[2]; }
    const deadline = findDeadline(clean(b), date);
    rows.push({ title: title.slice(0, 120), link: link || base, date, cat: ex.cat, status: ex.status, writer: ex.writer, views: ex.views, deadline, pinned: ex.pinned });
  }
  rows.sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date));
  return rows;
}

/* ---------- 전체 흐름 ---------- */
async function discover(name, given, fixed) {
  const t0 = Date.now(), left = () => DEADLINE_MS - (Date.now() - t0);
  const tryBoard = async (boardUrl, depth, min = 2) => {
    if (left() < 1200) return null;
    const { url, html } = await fetchPage(boardUrl, { timeout: Math.min(4000, left() - 500) });
    const items = parseList(html, url);
    if (items.length >= min) return { board: url, items };
    if (depth < 1) { // 목록이 아니라 메뉴 페이지면 한 번 더 들어가 본다
      for (const c of boardCandidates(html, url).filter(c => c !== url).slice(0, 2)) {
        try { const r = await tryBoard(c, depth + 1); if (r) return r; } catch (e) {}
      }
    }
    return null;
  };
  const tryHome = async (homeUrl, verify) => {
    const { url, html } = await fetchPage(homeUrl, { timeout: Math.min(4000, left() - 500) });
    if (verify && !verifyHome(name, html)) return { rejected: true, home: '', board: '', items: [] };
    const home = new URL(url).origin === new URL(homeUrl).origin ? url : url;
    for (const c of boardCandidates(html, url)) {
      try { const r = await tryBoard(c, 0); if (r) return { home, ...r }; } catch (e) {}
      if (left() < 1500) break;
    }
    return { home, board: '', items: [] };
  };

  // 앱에 등록된 공지사항 주소(fixed)는 홈페이지 탐색 없이 그 게시판만 읽는다
  if (given && fixed) {
    const origin = new URL(given).origin + '/';
    try {
      const r = await tryBoard(given, 1, 1);
      if (r) return { status: 'ok', home: origin, ...r };
      return { status: 'no_board', reason: 'parse', home: origin, board: given, items: [] };   // 받았지만 목록 모양을 못 읽음
    } catch (e) {
      return { status: 'no_board', reason: String((e && e.message) || e).slice(0, 60), home: origin, board: given, items: [] };   // 접속 자체가 막힘 등
    }
  }
  // 사용자가 주소를 줬거나 이전에 찾아 둔 주소가 있을 때
  if (given) {
    try {
      const direct = await tryBoard(given, 1);               // 게시판 주소였다면 바로 성공
      if (direct) return { status: 'ok', home: new URL(given).origin + '/', ...direct };
      const r = await tryHome(given);
      if (r.items.length) return { status: 'ok', ...r };
      return { status: 'no_board', home: r.home, board: '', items: [] };
    } catch (e) { /* 주소가 틀렸을 수 있으니 이름으로 다시 찾아본다 */ }
  }
  const links = rankHomepages(await searchLinks(name), name).slice(0, 5);
  if (!links.length) return { status: 'no_home', home: '', board: '', items: [] };
  let firstHome = '';
  for (const l of links) {
    if (left() < 1800) break;
    try {
      const r = await tryHome(l, true);
      if (r.rejected) continue;
      if (!firstHome) firstHome = r.home;
      if (r.items.length) return { status: 'ok', ...r };
    } catch (e) {}
  }
  return { status: firstHome ? 'no_board' : 'no_home', home: firstHome, board: '', items: [] };
}

exports.verifyHome = verifyHome;
exports.parseList = parseList;
exports.boardCandidates = boardCandidates;
exports.rankHomepages = rankHomepages;

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const q = String(qs.q || '').trim().slice(0, 60);
  let url = String(qs.url || '').trim().slice(0, 300);
  if (!q && !url) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'q required', status: 'error', items: [] }) };
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { if (url) new URL(url); } catch (e) { url = ''; }
  try {
    const r = await discover(q, url, qs.fixed === '1' && !!url);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ q, ...r, items: r.items.slice(0, 10) }) };
  } catch (e) {
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'failed', status: 'error', items: [] }) };
  }
};
