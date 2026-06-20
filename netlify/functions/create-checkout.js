const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function addToNotion(data, total, nettoSpeisen, nettoGetraenke) {
  const notionToken = process.env.NOTION_TOKEN;
  const databaseId = '2e133b0c9d9380e893d9d082a29bed96';

  const modus = data.modus && data.modus.includes('Lieferung') ? 'Catering' : 'Abholung';
  // Netto sauber aus den getrennten Bruttosummen rechnen
  const netto = Math.round((nettoSpeisen + nettoGetraenke) * 100) / 100;

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
    console.log('Speisen:', data.speisen_sum, 'Getränke:', data.getraenke_sum, 'Lieferung:', data.lieferung_sum);
    console.log('Email:', data.email);

    // Empfängername: Firma > Person > Fallback
    const recipientName = (data.firma && data.firma.trim())
      || (data.name && data.name.trim())
      || 'Kunde';

    // Rechnungsadresse bevorzugt, Fallback auf Lieferadresse
    const billingAddressStr = (data.rechnungsadresse && data.rechnungsadresse.trim())
      || data.adresse
      || '';
    const parsedAddress = parseGermanAddress(billingAddressStr);
    // Platzhalter für automatic_tax wenn Parsing fehlschlägt
    const customerAddress = parsedAddress || {
      line1: billingAddressStr || 'Wird im Checkout ergänzt',
      postal_code: '60311',
      city: 'Frankfurt am Main',
      country: 'DE',
    };

    const customer = await stripe.customers.create({
      email: data.email,
      name: recipientName,
      phone: data.tel || undefined,
      address: customerAddress,
      metadata: {
        ansprechpartner: data.name || '',
        firma: data.firma || '',
      },
    });

    console.log('Customer created:', customer.id, 'as', recipientName);

    // Line Items dynamisch zusammenbauen (je nach Bestellinhalt)
    const lineItems = [];

    // Speisen (7% MwSt)
    if (data.speisen_sum && data.speisen_sum > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Speisen', tax_code: 'txcd_40060002' },
          unit_amount: Math.round(data.speisen_sum * 100),
        },
        quantity: 1,
      });
    }

    // Getränke (19% MwSt)
    if (data.getraenke_sum && data.getraenke_sum > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Getränke', tax_code: 'txcd_99999999' },
          unit_amount: Math.round(data.getraenke_sum * 100),
        },
        quantity: 1,
      });
    }

    // Lieferung (7% MwSt, folgt dem Speisen-Catering)
    if (data.lieferung_sum && data.lieferung_sum > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Lieferung', tax_code: 'txcd_40060002' },
          unit_amount: Math.round(data.lieferung_sum * 100),
        },
        quantity: 1,
      });
    }

    // Backwards-Compat: Wenn nichts gesplittet ankommt, klassisches Single-Line-Item
    if (lineItems.length === 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Catering', tax_code: 'txcd_40060002' },
          unit_amount: Math.round((data.total || 0) * 100),
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'never' },
      invoice_creation: { enabled: true },
      customer: customer.id,
      metadata: {
        name: data.name || '',
        firma: data.firma || '',
        datum: data.datum || '',
        uhrzeit: data.uhrzeit || '',
        modus: data.modus || '',
        adresse: data.adresse || '',
        rechnungsadresse: data.rechnungsadresse || '',
        tel: data.tel || '',
        bestellung: data.bestellung ? data.bestellung.substring(0, 500) : '',
        sonder: data.sonder || '',
      },
      success_url: 'https://teal-capybara-c25b9e.netlify.app/success.html',
      cancel_url: 'https://teal-capybara-c25b9e.netlify.app/',
    });

    // Netto pro Steuersatz für Notion
    const nettoSpeisen = ((data.speisen_sum || 0) + (data.lieferung_sum || 0)) / 1.07;
    const nettoGetraenke = (data.getraenke_sum || 0) / 1.19;

    addToNotion(data, data.total, nettoSpeisen, nettoGetraenke)
      .catch(err => console.log('Notion failed:', err.message));

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
