const dateStr = '2026-07-22';
async function test() {
  try {
    const res = await fetch('http://localhost:3002/api/fetch-slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedTherapist: 'Ambika Vaidya',
        selectedDate: dateStr,
        timezone: 'Asia/Calcutta'
      })
    });
    
    console.log(`Fetching: http://localhost:3002/api/fetch-slots for Ambika ${dateStr}`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err);
  }
}
test();
