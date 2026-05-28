const fs = require('fs');
const path = 'server/index.ts';
let content = fs.readFileSync(path, 'utf8');

// 1. Add imports
content = content.replace("import pool from '../lib/db';", "import pool from '../lib/db';\nimport { createServer } from 'http';\nimport { Server as SocketIOServer } from 'socket.io';");

// 2. Replace app.listen with httpServer + socket.io
const bottomStr = `const PORT = 3002;
const httpServer = createServer(app);

export const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.on('connection', (socket) => {
  console.log('[Socket.io] Client connected:', socket.id);
  socket.on('join_room', (data) => {
    if (data?.role === 'admin') socket.join('admin_room');
    else if (data?.role === 'therapist' && data?.userId) socket.join('therapist_room_' + data.userId);
  });
});

httpServer.listen(PORT, () => {
  console.log(\`\\nAPI server running on http://localhost:\${PORT}\`);
  startDashboardApiBookingSync();
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error('Port is in use.');
  else console.error('Server error', err);
  process.exit(1);
});
`;

content = content.replace(/const PORT = 3002;[\s\S]+/, bottomStr);

// 3. Inject booking_updated emit on booking creation
content = content.split("console.log(`[Create Booking] \u2705 Booking ${bookingId} saved to database successfully.`);").join("console.log(`[Create Booking] \u2705 Booking ${bookingId} saved to database successfully.`);\n    if (io) io.emit('booking_updated');");

// 4. Inject booking_updated emit on cancellation success
content = content.split("res.json({ success: true, message: 'Booking cancellation completed successfully', refund_status: refundStatus, refund_amount: refundAmount });").join("if (io) io.emit('booking_updated');\n    res.json({ success: true, message: 'Booking cancellation completed successfully', refund_status: refundStatus, refund_amount: refundAmount });");

// 5. Add null guards for booking_invitee_time .match() calls
// Pattern: row.booking_invitee_time.match(  =>  (row.booking_invitee_time || '').match(
content = content.split('row.booking_invitee_time.match(').join('(row.booking_invitee_time || \'\').match(');

// Pattern: row.session_timings.match(  =>  (row.session_timings || '').match(
content = content.split('row.session_timings.match(').join('(row.session_timings || \'\').match(');

fs.writeFileSync(path, content);
console.log("Successfully patched server/index.ts!");
