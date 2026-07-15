const test = async () => {
  const req1 = await fetch('http://localhost:3002/api/admin/generate-payment-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      therapistName: "muskan",
      clientName: "meet",
      clientEmail: "pmeet8926@gmail.com",
      clientPhone: "+917775897124",
      date: "2026-07-20",
      time: "10:00",
      serviceType: "Individual Therapy Session",
      amount: 100,
      isAdmin: true,
      sessionMode: "online",
      timezone: "Asia/Kolkata"
    })
  });
  
  const res1 = await req1.json();
  console.log("Generate Link Response:", res1);
  
  if (res1.success && res1.bookingId) {
    const bookingId = res1.bookingId;
    
    // confirm payment
    const req2 = await fetch('http://localhost:3002/api/confirm-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        razorpayPaymentId: 'pay_mock_' + Math.random().toString(36).substring(7),
        razorpayOrderId: 'order_mock_' + Math.random().toString(36).substring(7)
      })
    });
    
    const res2 = await req2.json();
    console.log("Confirm Payment Response:", res2);
  }
};

test().catch(console.error);
