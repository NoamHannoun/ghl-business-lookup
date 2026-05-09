/**
 * Florida Division of Corporations (Sunbiz) scraper.
 * Public data — no API key needed.
 * https://search.sunbiz.org
 */
const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://search.sunbiz.org';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Roles we consider "owners" — ordered by preference
const OWNER_ROLES = ['mgr', 'mgrm', 'authorized member', 'member', 'president', 'p', 'director', 'pa', 'vp'];

async function lookupFL(companyName) {
  try {
    const detailUrl = await searchForEntity(companyName);
    if (!detailUrl) return null;
    const html = await fetchPage(detailUrl);
    return parseOwner(html);
  } catch (err) {
    console.error(`[sunbiz] error: ${err.message}`);
    return null;
  }
}

async function searchForEntity(companyName) {
  const res = await axios.get(`${BASE}/Inquiry/CorporationSearch/SearchResults`, {
    params: {
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
    },
    headers: HEADERS,
    timeout: 15000,
  });

  const $ = cheerio.load(res.data);
  let href = null;

  // Prefer the first ACTIVE result; fall back to first result overall
  $('table.search-results tbody tr, table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) return;
    const link = $(row).find('a[href*="SearchResultDetail"]').first();
    if (!link.length) return;
    const status = cells.eq(4).text().trim().toUpperCase();
    if (!href) href = link.attr('href');          // first result fallback
    if (status === 'ACTIVE') { href = link.attr('href'); return false; } // stop on first active
  });

  // Broader fallback if table structure differs
  if (!href) href = $('a[href*="SearchResultDetail"]').first().attr('href');

  return href ? `${BASE}${href}` : null;
}

async function fetchPage(url) {
  const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  return res.data;
}

function parseOwner(html) {
  const $ = cheerio.load(html);

  // Strategy 1: structured detailSection divs (most common Sunbiz layout)
  const people = [];

  $('div.detailSection').each((_, section) => {
    const headerText = $(section).find('span.title').first().text().toLowerCase();

    const isOwnerSection =
      headerText.includes('officer') ||
      headerText.includes('director') ||
      headerText.includes('authorized person') ||
      headerText.includes('manager') ||
      headerText.includes('member');

    const isSkipSection =
      headerText.includes('registered agent') ||
      headerText.includes('annual report');

    if (!isOwnerSection || isSkipSection) return;

    // Each person occupies a pair of .col divs: [name+address] [title]
    const rows = $(section).find('div.row').toArray();
    for (const row of rows) {
      const cols = $(row).find('div.col').toArray();
      if (cols.length < 2) continue;

      const nameBlock = $(cols[0]).html() || '';
      const titleText = $(cols[1]).text().trim();

      // Split on <br> tags to get individual lines
      const lines = nameBlock
        .split(/<br\s*\/?>/i)
        .map(l => cheerio.load(l).text().trim())
        .filter(Boolean);

      if (!lines.length || lines[0].toLowerCase().includes('name & address')) continue;

      const raw = lines[0];
      const { firstName, lastName } = splitName(raw);
      const address = parseAddressLines(lines.slice(1));

      people.push({ firstName, lastName, title: titleText, ...address });
    }
  });

  if (people.length > 0) return selectBest(people);

  // Strategy 2: regex fallback on raw page text
  return regexFallback($.text());
}

function regexFallback(text) {
  // Look for a name followed by an address block near owner-role keywords
  const pattern =
    /(?:Manager|President|Director|Authorized Member|Member)\s*\n\s*([A-Z][A-Z\s'-]+?)\s*\n\s*(\d+[^\n]+)\n\s*([A-Za-z][^,\n]+),?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/gi;

  const match = pattern.exec(text);
  if (!match) return null;

  const [, rawName, address, city, state, zip] = match;
  const { firstName, lastName } = splitName(rawName.trim());
  return { firstName, lastName, address: address.trim(), city: city.trim(), state, zip };
}

function selectBest(people) {
  for (const role of OWNER_ROLES) {
    const match = people.find(p => (p.title || '').toLowerCase().includes(role));
    if (match) return match;
  }
  return people[0];
}

function parseAddressLines(lines) {
  if (!lines.length) return {};
  const address = lines[0] || '';

  // "MIAMI, FL 33101" or "MIAMI FL 33101"
  const last = lines[lines.length - 1] || '';
  const m = last.match(/^([A-Za-z\s]+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) {
    return { address, city: m[1].trim(), state: m[2], zip: m[3] };
  }

  // Sometimes city and zip are on separate lines
  if (lines.length >= 3) {
    const cityLine = lines[lines.length - 2];
    const stateZip = lines[lines.length - 1].match(/([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
    if (stateZip) {
      return { address, city: cityLine.trim(), state: stateZip[1], zip: stateZip[2] };
    }
  }

  return { address };
}

function splitName(raw) {
  const name = raw.replace(/\s+/g, ' ').trim();

  // "DOE, JOHN MICHAEL" format
  if (name.includes(',')) {
    const [last, rest] = name.split(',').map(s => s.trim());
    return { firstName: toTitle(rest), lastName: toTitle(last) };
  }

  const parts = name.split(' ');
  const lastName = toTitle(parts.pop() || '');
  const firstName = toTitle(parts.join(' '));
  return { firstName, lastName };
}

function toTitle(str) {
  return str
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { lookupFL };
