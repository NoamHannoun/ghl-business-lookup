const axios = require('axios');

const GHL_BASE = 'https://services.leadconnectorhq.com';

async function updateGHLContact(contactId, ownerData) {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) throw new Error('GHL_API_KEY is not set in environment variables');

  // Overwrite the contact's existing fields with the owner's info
  const payload = {};
  if (ownerData.firstName)  payload.firstName   = ownerData.firstName;
  if (ownerData.lastName)   payload.lastName    = ownerData.lastName;
  if (ownerData.address)    payload.address1    = ownerData.address;
  if (ownerData.city)       payload.city        = ownerData.city;
  if (ownerData.state)      payload.state       = ownerData.state;
  if (ownerData.zip)        payload.postalCode  = ownerData.zip;

  await axios.put(
    `${GHL_BASE}/contacts/${contactId}`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      timeout: 10000,
    }
  );

  console.log(`[ghl] overwrote contact ${contactId} with owner: ${ownerData.firstName} ${ownerData.lastName}`);
}

module.exports = { updateGHLContact };
