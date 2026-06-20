const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function addToNotion(data, total) {
  const notionToken = process.env.NOTION_TOKEN;
  const databaseId = '2e133b0c9d9380e893d9d082a29bed96';

  const modus = data.modus && data.modus.includes('Lieferung') ? 'Catering' : 'Abholung';
  const netto = Math.round((total / 1.07) * 100) / 100;

  const datum = data.datum && data.uhrzeit
    ? new Date(`${data.datum}T${data.uhrzeit}:00`).toISOString()
    : new Date().toISOString();

  const kunde = [data.firma, data.name].filter(Boolean).join(' | ') || 'Unbekannt';

  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        Kunde: {
          title: [{ text: { content: kunde } }],
        },
        Datum: {
          date: { start: datum },
        },
        Event: {
          select: { name: modus },
        },
        Status: {
          status: { name: '100% bezahlt' },
        },
        Bruttosumme: {
          number: total,
        },
        Nettosumme: {
          number: netto,
        },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.log('Notion error:', err);
  } else {
    console.log('Notion entry created successfully');
  }
}

// Parst deutsche Adressen im Format "Straße Nr, PLZ Stadt" oder "Straße Nr PLZ Stadt"
function parseGermanAddress(addressStr) {
  if (!addressStr) return null;
  const match = addressStr.match(/^(.+?)[\s,]+(\d{5})\s+(.+?)$/);
  if (match) {
    return {
      line1: match[1].trim(),
      postal_code: match[2],
      city: match[3].trim(),
      country: 'DE',
    };
  }
  // Fallback: nur Straße, Rest muss in Stripe-Checkout ergänzt werden
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const data = JSON.parse(event.body);

    console.log('Stripe Key exists:', !!process.env.STRIPE_SECRET_KEY);
    console.log('Total:', data.total);
    console.log('Email:', data.email);

    // Empfängername bestimmen: Firma > Person > Fallback
    const recipientName = (data.firma && data.firma.trim())
      || (data.name && data.name.trim())
      || 'Kunde';

    // Adresse parsen, falls möglich
    const parsedAddress = parseGermanAddress(data.adresse);
    const hasCompleteAddress = !!parsedAddress;

    // Stripe-Kunden mit strukturierten Daten anlegen
    const customer = await stripe.customers.create({
      email: data.email,
      name: recipientName,
      phone: data.tel || undefined,
      address: hasCompleteAddress ? parsedAddress : undefined,
      metadata: {
        ansprechpartner: data.name || '',
        firma: data.firma || '',
      },
    });

    console.log('Customer created:', customer.id, 'as', recipientName);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'Catering' },
          unit_amount: Math.round(data.total * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      automatic_tax: { enabled: true },
      // Falls Adresse vollständig vorgeparst: 'auto', sonst noch abfragen
      billing_address_collection: hasCompleteAddress ? 'auto' : 'required',
      invoice_creation: { enabled: true },
      customer: customer.id,
      metadata: {
        name: data.name || '',
        firma: data.firma || '',
        datum: data.datum || '',
        uhrzeit: data.uhrzeit || '',
        modus: data.modus || '',
        adresse: data.adresse || '',
        tel: data.tel || '',
        bestellung: data.bestellung ? data.bestellung.substring(0, 500) : '',
        sonder: data.sonder || '',
      },
      success_url: 'https://teal-capybara-c25b9e.netlify.app/success.html',
      cancel_url: 'https://teal-capybara-c25b9e.netlify.app/',
    });

    // Notion-Eintrag erstellen (im Hintergrund, blockiert Checkout nicht)
    addToNotion(data, data.total).catch(err => console.log('Notion failed:', err.message));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.log('Stripe error:', err.message);
    console.log('Error type:', err.type);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
