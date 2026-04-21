const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const data = JSON.parse(event.body);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'paypal'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Catering-Bestellung Broed',
            description: data.bestellung,
          },
          unit_amount: Math.round(data.total * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: data.email,
      metadata: {
        name: data.name,
        firma: data.firma,
        datum: data.datum,
        uhrzeit: data.uhrzeit,
        modus: data.modus,
        adresse: data.adresse,
        bestellung: data.bestellung,
        sonder: data.sonder,
      },
      invoice_creation: { enabled: true },
      success_url: `${process.env.URL}/success.html`,
      cancel_url: `${process.env.URL}/`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
