const fs = require('fs');
let c = fs.readFileSync('panel-backend/src/index.ts', 'utf8');

c = c.replace(/app\.get\('\/api\/therapy-services'/g, "app.get('/api/services'");
c = c.replace(/app\.post\('\/api\/therapy-services'/g, "app.post('/api/services'");
c = c.replace(/app\.put\('\/api\/therapy-services\/:id'/g, "app.put('/api/services/:id'");

const deleteRoute = `

app.delete('/api/services/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM therapy_services WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Therapy service not found' });
    }
    res.json({ message: 'Therapy service deleted successfully' });
  } catch (error) {
    console.error('Error deleting therapy service:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});`;

// Find where to insert the delete route. A good place is right before app.get('/api/public/services/:slug'
const insertAnchor = "app.get('/api/public/services/:slug'";
if (c.includes(insertAnchor) && !c.includes("app.delete('/api/services/:id'")) {
  c = c.replace(insertAnchor, deleteRoute.trim() + "\n\n" + insertAnchor);
}

fs.writeFileSync('panel-backend/src/index.ts', c);
console.log("Patched therapy services routes successfully!");
