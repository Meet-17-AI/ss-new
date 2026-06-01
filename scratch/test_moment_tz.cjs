const moment = require('moment-timezone');
console.log(moment.tz('2024-05-20 07:24 PM', 'YYYY-MM-DD HH:mm', 'Asia/Kolkata').isValid());
console.log(moment.tz('2024-05-20 07:24 PM', 'YYYY-MM-DD HH:mm', 'Asia/Kolkata').format());
