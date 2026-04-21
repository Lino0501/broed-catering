const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    
    console.log('Stripe Key exists:', !!process.env.STRIPE_SECRET_KEY);
    console.log('Total:', data.total);
    console.log('Email:', data.email);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Catering-Bestellung Broed',
          },
          unit_amount: Math.round(data.total * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: data.email,
      success_url: 'https://teal-capybara-c25b9e.netlify.app/success.html',
      cancel_url: 'https://teal-capybara-c25b9e.netlify.app/',
    });

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
