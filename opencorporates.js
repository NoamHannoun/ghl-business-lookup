/**
 * OpenCorporates API — fallback for when Sunbiz doesn't return results.
 * Free trial: https://opencorporates.com/api_docs
 * Set OC_API_TOKEN in .env after signing up.
 */
const axios = require('axios');

const OC_BASE = 'https://api.opencorporates.com/v0.4';

const STATE_TO_JURISDICTION = {
  AL: 'us_al', AK: 'us_ak', AZ: 'us_az', AR: 'us_ar', CA: 'us_ca',
  CO: 'us_co', CT: 'us_ct', DE: 'us_de', FL: 'us_fl', GA: 'us_ga',
  HI: 'us_hi', ID: 'us_id', IL: 'us_il', IN: 'us_in', IA: 'us_ia',
  KS: 'us_ks', KY: 'us_ky', LA: 'us_la', ME: 'us_me', MD: 'us_md',
  MA: 'us_ma', MI: 'us_mi', MN: 'us_mn', MS: 'us_ms', MO: 'us_mo',
  MT: 'us_mt', NE: 'us_ne', NV: 'us_nv', NH: 'us_nh', NJ: 'us_nj',
  NM: 'us_nm', NY: 'us_ny', NC: 'us_nc', ND: 'us_nd', OH: 'us_oh',
  OK: 'us_ok', OR: 'us_or', PA: 'us_pa', RI: 'us_ri', SC: 'us_sc',
  SD: 'us_sd', TN: 'us_tn', TX: 'us_tx', UT: 'us_ut', VT: 'us_vt',
  VA: 'us_va', WA: 'us_wa', WV: 'us_wv', WI: 'us_wi', WY: 'us_wy',
};

// Officers weighted by most likely to be the real owner
const OWNER_ROLES = ['director', 'manager', 'president', 'member', 'secretary', 'agent'];

async function lookupOpenCorporates(companyName, state) {
  const token = process.env.OC_API_TOKEN;
  if (!token) {
    console.warn('[opencorporates] OC_API_TOKEN not set — skipping');
    return null;
  }

  const jurisdiction = STATE_TO_JURISDICTION[state?.toUpperCase()] || 'us_fl';

  try {
    // Search for the company
    const searchRes = await axios.get(`${OC_BASE}/companies/search`, {
      params: {
        q: companyName,
        jurisdiction_code: jurisdiction,
        api_token: token,
      },
      timeout: 12000,
    });

    const companies = searchRes.data?.results?.companies || [];
    if (!companies.length) return null;

    const company = companies[0]?.company;
    if (!company) return null;

    // Try to get officers from the full company record
    const companyRes = await axios.get(
      `${OC_BASE}/companies/${company.jurisdiction_code}/${company.company_number}`,
      {
        params: { api_token: token },
        timeout: 12000,
      }
    );

    const officers = companyRes.data?.results?.company?.officers || [];
    return extractOwner(officers);

  } catch (err) {
    if (err.response?.status === 401) {
      console.error('[opencorporates] invalid or expired API token');
    } else if (err.response?.status === 429) {
      console.error('[opencorporates] rate limit hit');
    } else {
      console.error(`[opencorporates] ${err.message}`);
    }
    return null;
  }
}

function extractOwner(officers) {
  if (!officers.length) return null;

  let best = null;
  for (const role of OWNER_ROLES) {
    best = officers.find(o => {
      const pos = (o.officer?.position || '').toLowerCase();
      return pos.includes(role) && o.officer?.name;
    });
    if (best) break;
  }
  if (!best) best = officers.find(o => o.officer?.name);
  if (!best) return null;

  const officer = best.officer;
  const { firstName, lastName } = splitName(officer.name || '');

  // OC sometimes has address as a single string — attempt to parse it
  const addr = parseOCAddress(officer.address || '');

  return { firstName, lastName, ...addr };
}

function parseOCAddress(raw) {
  if (!raw) return {};
  // "123 Main St, Miami, FL 33101, US"
  const parts = raw.split(',').map(s => s.trim());
  if (parts.length >= 4) {
    const address = parts[0];
    const city = parts[1];
    const stateZip = parts[2].match(/([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
    if (stateZip) {
      return { address, city, state: stateZip[1], zip: stateZip[2] };
    }
  }
  return { address: raw };
}

function splitName(raw) {
  const name = raw.replace(/\s+/g, ' ').trim();
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
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { lookupOpenCorporates };
