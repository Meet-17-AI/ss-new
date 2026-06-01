async function check() {
  const live = await fetch('http://localhost:3002/api/therapists-live-status').then(r=>r.json());
  console.log("Live:", live);
  const services = await fetch('http://localhost:3002/api/services').then(r=>r.json());
  console.log("Services count:", services.length);
}
check();
