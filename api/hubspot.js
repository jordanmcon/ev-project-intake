// api/hubspot.js — Vercel serverless function
// Proxies HubSpot CRM upsert requests from the browser.
// The token never leaves this server; it's injected from the HUBSPOT_TOKEN env variable.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'HubSpot token not configured' });
  }

  const { email, properties } = req.body;

  if (!email || !properties) {
    return res.status(400).json({ error: 'Missing email or properties' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  try {
    // Step 1: Search for existing contact by email
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

    // Step 2: Update or create
    let apiRes;
    if (searchData.total > 0) {
      const contactId = searchData.results[0].id;
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
      return res.status(apiRes.status).json({ error: err.message || 'HubSpot API error' });
    }

    const data = await apiRes.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal proxy error' });
  }
}
