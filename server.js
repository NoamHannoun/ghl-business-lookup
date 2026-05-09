require('dotenv').config();
const express = require('express');
const { lookupFL } = require('./sunbiz');
const { lookupOpenCorporates } = require('./opencorporates');
const { updateGHLContact } = require('./ghl');

const app = express();
app.use(express.json());

// Health check for Railway
app.get('/health', (_, res) => res.json({ ok: true }));

app.post('/lookup', async (req, res) => {
  const {
    contact_id,
    company_name,
    mailing_state,
  } = req.body;

  if (!contact_id || !company_name) {
    return res.status(400).json({ error: 'contact_id and company_name are required' });
  }

  console.log(`[lookup] ${company_name} | ${mailing_state} | contact: ${contact_id}`);

  try {
    let ownerData = null;
    const state = (mailing_state || '').toUpperCase().replace(/\./g, '').trim();

    // FL: hit Sunbiz first (authoritative, free, no rate limits)
    if (state === 'FL' || state === 'FLORIDA') {
      ownerData = await lookupFL(company_name);
      if (ownerData) console.log(`[sunbiz] found: ${ownerData.firstName} ${ownerData.lastName}`);
    }

    // Fallback: OpenCorporates (covers all states, needs free trial token)
    if (!ownerData) {
      ownerData = await lookupOpenCorporates(company_name, state || 'FL');
      if (ownerData) console.log(`[opencorporates] found: ${ownerData.firstName} ${ownerData.lastName}`);
    }

    if (!ownerData) {
      console.log(`[lookup] no owner found for: ${company_name}`);
      return res.json({ status: 'not_found', company: company_name });
    }

    // Write owner data back to GHL contact custom fields
    await updateGHLContact(contact_id, ownerData);
    return res.json({ status: 'found', owner: ownerData });

  } catch (err) {
    console.error(`[error] ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
