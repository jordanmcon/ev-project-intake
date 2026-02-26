// api/hubspot.js — Vercel serverless function
// Proxies HubSpot CRM requests from the browser.
// The token never leaves this server; it's injected from the HUBSPOT_TOKEN env variable.
//
// Required HubSpot token scopes:
//   crm.objects.contacts.write  crm.objects.contacts.read
//   crm.objects.deals.write     crm.objects.contacts.read

export default async function handler(req, res) {
  // Allow CORS for browser requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'HubSpot token not configured' });
  }

  // Ensure body is parsed
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email, properties, dealProperties } = body || {};

  if (!email || !properties) {
    return res.status(400).json({ error: 'Missing email or properties' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  try {
    // ── Step 1: Search for existing contact by email ──────────────────────────
    const searchRes = await fetch('https://api.hubspot.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        properties: ['email'],
        limit: 1,
      }),
    });

    if (!searchRes.ok) {
      const err = await searchRes.json().catch(() => ({}));
      return res.status(searchRes.status).json({ error: err.message || 'HubSpot search failed' });
    }

    const searchData = await searchRes.json();

    // ── Step 2: Upsert contact ────────────────────────────────────────────────
    let contactId;
    let apiRes;

    if (searchData.total > 0) {
      contactId = searchData.results[0].id;
      apiRes = await fetch(`https://api.hubspot.com/crm/v3/objects/contacts/${contactId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties }),
      });
    } else {
      apiRes = await fetch('https://api.hubspot.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ properties: { ...properties, email } }),
      });
    }

    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({}));
      return res.status(apiRes.status).json({ error: err.message || 'HubSpot contact API error' });
    }

    const contactData = await apiRes.json();
    contactId = contactId || contactData.id;

    // ── Step 3: Create Deal (only when dealProperties are provided) ───────────
    // dealProperties are only sent on the final quote submission, not step tracking.
    if (dealProperties && contactId) {
      const dealRes = await fetch('https://api.hubspot.com/crm/v3/objects/deals', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: dealProperties,
          associations: [
            {
              to: { id: contactId },
              types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
            },
          ],
        }),
      });

      if (!dealRes.ok) {
        // Log but don't fail the whole request — contact was already saved
        const dealErr = await dealRes.json().catch(() => ({}));
        console.error('Deal creation failed:', dealErr);
        return res.status(200).json({
          contact: contactData,
          dealError: dealErr.message || 'Deal creation failed',
        });
      }

      const dealData = await dealRes.json();
      return res.status(200).json({ contact: contactData, deal: dealData });
    }

    return res.status(200).json(contactData);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal proxy error' });
  }
}
