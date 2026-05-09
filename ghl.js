/**
 * GoHighLevel API client.
 * Updates owner custom fields on a contact after a successful lookup.
 *
 * GHL API key: Settings → API Keys → Location API Key
 * Custom field IDs: Settings → Custom Fields → click field → copy ID from URL or field list
 */
const axios = require('axios');

const GHL_BASE = 'https://rest.gohighlevel.com/v1';

async function updateGHLContact(contactId, ownerData) {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) throw new Error('GHL_API_KEY is not set in environment variables');

  // Map owner fields to GHL custom field IDs (set in .env)
  const fieldMap = {
    firstName: process.env.GHL_FIELD_OWNER_FIRST,
    lastName:  process.env.GHL_FIELD_OWNER_LAST,
    address:   process.env.GHL_FIELD_OWNER_ADDRESS,
    city:      process.env.GHL_FIELD_OWNER_CITY,
    state:     process.env.GHL_FIELD_OWNER_STATE,
    zip:       process.env.GHL_FIELD_OWNER_ZIP,
  };

  const customField = {};
  for (const [key, fieldId] of Object.entries(fieldMap)) {
    if (fieldId && ownerData[key]) {
      customField[fieldId] = ownerData[key];
    }
  }

  if (!Object.keys(customField).length) {
    console.warn('[ghl] no custom field IDs configured — skipping update');
    return;
  }

  await axios.put(
    `${GHL_BASE}/contacts/${contactId}`,
    { customField },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      timeout: 10000,
    }
  );

  console.log(`[ghl] updated contact ${contactId} — fields: ${Object.keys(customField).join(', ')}`);
}

module.exports = { updateGHLContact };
