const moment = require('moment');
console.log(moment('07:24 PM', 'HH:mm').isValid());
console.log(moment('07:24 PM', 'HH:mm').format('HH:mm'));
