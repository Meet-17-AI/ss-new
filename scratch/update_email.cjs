const fs = require('fs');
let c = fs.readFileSync('panel-backend/src/lib/email.ts', 'utf8');

// Replace imports
c = c.replace(/import nodemailer from 'nodemailer';/g, 'import { Resend } from \'resend\';');

// Replace transporter creation
c = c.replace(/const transporter = nodemailer\.createTransport\(\{[\s\S]*?\}\);/g, `const resend = new Resend(process.env.RESEND_API_KEY);`);

// Replace transporter.verify
c = c.replace(/await transporter\.verify\(\);/g, `// Resend doesn't require explicit verification`);

// Replace transporter.sendMail
c = c.replace(/const info = await transporter\.sendMail\(mailOptions\);/g, `const info = await resend.emails.send(mailOptions);`);
c = c.replace(/info\.messageId/g, `info.data?.id`);

fs.writeFileSync('panel-backend/src/lib/email.ts', c);
console.log('Updated email.ts');
