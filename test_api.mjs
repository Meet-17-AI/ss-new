async function run() {
    const res1 = await fetch('http://localhost:3000/api/dashboard/stats');
    const stats = await res1.json();
    console.log('Dashboard stats bookings:', stats.bookings);

    const res2 = await fetch('http://localhost:3000/api/appointments');
    const apts = await res2.json();
    console.log('Appointments length:', apts.length);
}
run();
