const moment = require('moment-timezone');
const d = moment.tz('2024-05-20 10:30 AM', 'YYYY-MM-DD HH:mm', 'Asia/Kolkata');
console.log(d.isValid());
console.log(d.valueOf());
const cDate = new Date(d.valueOf());
console.log(cDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }));
