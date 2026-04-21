exports.handler = async (event) => {
  const { address } = JSON.parse(event.body);
  const origin = 'Taunusanlage 8, 60325 Frankfurt am Main, Germany';
  const key = process.env.GOOGLE_MAPS_KEY;

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(address)}&mode=driving&key=${key}`;

  const res = await fetch(url);
  const data = await res.json();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
};
