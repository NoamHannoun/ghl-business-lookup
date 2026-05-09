/**
 * Florida Division of Corporations (Sunbiz) scraper.
 * Public data — no API key needed.
 * https://search.sunbiz.org
 */
const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://search.sunbiz.org';

// Route requests through ScrapingBee to bypass Sunbiz bot protection
async function fetchUrl(url) {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (apiKey) {
    const res = await axios.get('https://app.scrapingbee.com/api/v1/', {
      params: { api_key: apiKey, url, render_js: false },
      timeout: 30000,
    });
    return res.data;
  }
  // Fallback: direct request (may 403 on server)
  const res = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    timeout: 15000,
  });
  return res.data;
}

async function lookupFL(companyName) {
  try {
    const detailUrl = await searchForEntity(companyName);
    if (!detailUrl) {
      console.log(`[sunbiz] no search result for: ${companyName}`);
      return null;
    }
    console.log(`[sunbiz] fetching detail: ${detailUrl}`);
    const html = await fetchPage(detailUrl);
    return parseOwner(html, companyName);
  } catch (err) {
    console.error(`[sunbiz] error: ${err.message}`);
    return null;
  }
}

async function searchForEntity(companyName) {
  const params = new URLSearchParams({
    inquiryType: 'EntityName',
    inquiryDirectionType: 'ForwardList',
    searchNameOrder: '',
    masterDatatoTransferCode: '',
    EntityName: companyName,
    fileNumber: '',
    directorName: '',
    raName: '',
    omni: '',
    searchTerm: 'EntityName',
    listNameOrder: '',
  });
  const searchUrl = `${BASE}/Inquiry/CorporationSearch/SearchResults?${params.toString()}`;
  const html = await fetchUrl(searchUrl);

  const $ = cheerio.load(html);
  let href = null;

  // Search results table — find first Active row
  $('table tr').each((_, row) => {
    if (href) return;
    const cells = $(row).find('td');
    if (cells.length < 3) return;

    const link = $(cells[0]).find('a').first();
    if (!link.length) return;

    // Check status column (last cell)
    const status = $(cells[cells.length - 1]).text().trim().toUpperCase();
    const rowHref = link.attr('href');

    // Prefer Active, but grab first result as fallback
    if (!href) href = rowHref;
    if (status === 'ACTIVE') {
      href = rowHref;
      return false; // break
    }
  });

  return href ? `${BASE}${href}` : null;
}

async function fetchPage(url) {
  return fetchUrl(url);
}

function parseOwner(html, companyName) {
  const $ = cheerio.load(html);

  console.log(`[sunbiz] parsing detail page, html length: ${html.length}`);

  // Strategy 1: Find Authorized Person / Officer / Manager sections
  // Sunbiz uses <div class="detailSection"> with <span class="title"> headers
  const ownerKeywords = ['authorized person', 'officer', 'director', 'manager', 'member'];
  const skipKeywords  = ['registered agent', 'principal address', 'mailing address'];

  let people = [];

  $('div.detailSection').each((_, section) => {
    const title = $(section).find('span.title').first().text().toLowerCase().trim();
    const isOwner = ownerKeywords.some(k => title.includes(k));
    const isSkip  = skipKeywords.some(k => title.includes(k));

    if (!isOwner || isSkip) return;
    console.log(`[sunbiz] found owner section: "${title}"`);

    // Each person block: two .col divs — [name+address] [title]
    $(section).find('div.row').each((_, row) => {
      const cols = $(row).find('div.col');
      if (cols.length < 1) return;

      const nameBlock = $(cols[0]).html() || '';
      const roleText  = cols.length > 1 ? $(cols[1]).text().trim() : '';

      const lines = nameBlock
        .split(/<br\s*\/?>/i)
        .map(l => cheerio.load(l).text().trim())
        .filter(l => l && !l.toLowerCase().includes('name & address'));

      if (!lines.length) return;

      const { firstName, lastName } = splitName(lines[0]);
      const addr = parseAddressLines(lines.slice(1));
      people.push({ firstName, lastName, role: roleText, ...addr });
    });
  });

  if (people.length > 0) {
    console.log(`[sunbiz] found ${people.length} people in owner sections`);
    return selectBest(people);
  }

  // Strategy 2: Registered Agent as fallback owner
  // For small LLCs the agent is often the owner
  $('div.detailSection').each((_, section) => {
    const title = $(section).find('span.title').first().text().toLowerCase().trim();
    if (!title.includes('registered agent')) return;

    const lines = $(section).text()
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.toLowerCase().includes('registered agent') && !l.toLowerCase().includes('name & address'));

    if (lines.length > 0) {
      const { firstName, lastName } = splitName(lines[0]);
      const addr = parseAddressLines(lines.slice(1));
      console.log(`[sunbiz] using registered agent as owner: ${lines[0]}`);
      people.push({ firstName, lastName, role: 'RA', ...addr });
    }
  });

  if (people.length > 0) return selectBest(people);

  // Strategy 3: Pure text regex fallback
  return regexFallback($.text(), companyName);
}

function regexFallback(text, companyName) {
  console.log('[sunbiz] trying regex fallback');

  // Look for ALL-CAPS name followed by address near ownership keywords
  const pattern = /(?:Manager|President|Director|Authorized|Member|Agent)[^\n]{0,50}\n\s*([A-Z][A-Z\s'-]{2,40})\n\s*(\d+[^\n]+)\n\s*([A-Za-z][^,\n]+),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/g;
  const match = pattern.exec(text);

  if (match) {
    const { firstName, lastName } = splitName(match[1].trim());
    return {
      firstName, lastName,
      address: match[2].trim(),
      city: match[3].trim(),
      state: match[4],
      zip: match[5],
    };
  }

  // Last resort: find any ALL-CAPS line that looks like a person name near an address
  const namePattern = /\n([A-Z]+(?:\s+[A-Z]+){1,3})\n(\d+[^\n]+)\n([A-Za-z][^,\n]+),?\s+([A-Z]{2})\s+(\d{5})/g;
  const nm = namePattern.exec(text);
  if (nm) {
    const { firstName, lastName } = splitName(nm[1].trim());
    return {
      firstName, lastName,
      address: nm[2].trim(),
      city: nm[3].trim(),
      state: nm[4],
      zip: nm[5],
    };
  }

  console.log('[sunbiz] regex fallback found nothing');
  return null;
}

function parseAddressLines(lines) {
  if (!lines.length) return {};
  const address = lines[0] || '';
  const last = lines[lines.length - 1] || '';

  // "CITY, ST 12345" or "CITY ST 12345"
  const m = last.match(/^([A-Za-z\s]+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) return { address, city: m[1].trim(), state: m[2], zip: m[3] };

  // City and state/zip on separate lines
  if (lines.length >= 3) {
    const sz = lines[lines.length - 1].match(/([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
    if (sz) return { address, city: lines[lines.length - 2].trim(), state: sz[1], zip: sz[2] };
  }

  return { address };
}

const ROLE_PRIORITY = ['mgr', 'mgrm', 'authorized member', 'member', 'president', 'p', 'director'];

function selectBest(people) {
  for (const role of ROLE_PRIORITY) {
    const match = people.find(p => (p.role || '').toLowerCase().includes(role));
    if (match) return match;
  }
  return people[0];
}

function splitName(raw) {
  const name = (raw || '').replace(/\s+/g, ' ').trim();
  if (!name) return { firstName: '', lastName: '' };

  // "LAST, FIRST" format
  if (name.includes(',')) {
    const [last, ...rest] = name.split(',').map(s => s.trim());
    return { firstName: toTitle(rest.join(' ')), lastName: toTitle(last) };
  }

  const parts = name.split(' ');
  const lastName = toTitle(parts.pop() || '');
  const firstName = toTitle(parts.join(' '));
  return { firstName, lastName };
}

function toTitle(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { lookupFL };
