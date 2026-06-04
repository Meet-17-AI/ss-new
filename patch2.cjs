const fs = require('fs');
let c = fs.readFileSync('panel-backend/src/index.ts', 'utf8');

const oldRoute = `app.get('/api/payment-settings/public', async (req, res) => {
  try {
    // Payments are temporarily disabled as per user request
    res.json({ paymentsEnabled: false });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});`;

const newRoute = `app.get('/api/payment-settings/public', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT active_gateway, razorpay_key_id FROM payment_settings ORDER BY id ASC LIMIT 1');
    if (rows.length > 0 && rows[0].active_gateway === 'razorpay' && rows[0].razorpay_key_id) {
      res.json({
        success: true,
        activeGateway: 'razorpay',
        publicKey: rows[0].razorpay_key_id,
        paymentsEnabled: true
      });
    } else {
      res.json({ paymentsEnabled: false });
    }
  } catch (error) {
    console.error('Error fetching public payment settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});`;

if (c.includes(oldRoute)) {
  c = c.replace(oldRoute, newRoute);
  fs.writeFileSync('panel-backend/src/index.ts', c);
  console.log("Patched public route successfully!");
} else {
  console.log("Old route not found.");
}
