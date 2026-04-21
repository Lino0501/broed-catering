const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Catering-Bestellung Broed',
            description: data.bestellung ? data.bestellung.substring(0, 200) : 'Catering',
          },
          unit_amount: Math.round(data.total * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: data.email,
      metadata: {
        name: data.name || '',
        firma: data.firma || '',
        datum: data.datum || '',
        uhrzeit: data.uhrzeit || '',
        modus: data.modus || '',
        adresse: data.adresse || '',
        sonder: data.sonder || '',
      },
      success_url: 'https://teal-capybara-c25b9e.netlify.app/success.html',
      cancel_url: 'https://teal-capybara-c25b9e.netlify.app/',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, type: err.type }),
    };
  }
};
