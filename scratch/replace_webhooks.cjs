require('dotenv').config();
const fs = require('fs');

const path = 'server/index.ts';
let content = fs.readFileSync(path, 'utf8');

const webhookRegex = /['"]https:\/\/n8n\.srv1169280\.hstgr\.cloud\/webhook\/([a-z0-9\-]+)([^'"]*)['"]/g;

const replacementMap = {
  'e7daacaf-fc75-4842-82d8-bb7ba392d178': 'process.env.N8N_WEBHOOK_ISSUE_REPORT',
  '424780e4-8e10-4308-84fd-5925450cc123': 'process.env.N8N_WEBHOOK_GET_SCHEDULE',
  '93c3afe0-88d2-47d0-8872-ab61c988bf20': 'process.env.N8N_WEBHOOK_UPDATE_SCHEDULE',
  '23f4ee75-55b4-4a65-8e5b-47838e816899': 'process.env.N8N_WEBHOOK_CANCEL_BOOKING',
  '9508e1da-b3b0-47d3-8c83-8a793281c1e2': 'process.env.N8N_WEBHOOK_RESCHEDULE_BOOKING',
  'efc4396f-401b-4d46-bfdb-e990a3ac3846': 'process.env.N8N_WEBHOOK_CRM_LEAD',
  'f1ee71f4-65e3-4246-baea-372e822faed7': 'process.env.N8N_WEBHOOK_SOS_EMAIL',
  '324275f9-00bd-4609-bdb0-307c301b322c': 'process.env.N8N_WEBHOOK_FETCH_SLOTS_PUBLIC',
  'ebc7a183-926b-4cdb-ad3b-27f335a02e17': 'process.env.N8N_WEBHOOK_FETCH_SLOTS_ADMIN_DIRECT',
  'b5ab584c-1203-41c0-b296-3107e2e6035e': 'process.env.N8N_WEBHOOK_FETCH_SLOTS_ADMIN_PAYMENT',
  'd7194a23-689f-4d95-bb35-d30fca3f15f9': 'process.env.N8N_WEBHOOK_CREATE_BOOKING_PUBLIC',
  '568038fa-d320-47da-8001-ea1ffeabde00': 'process.env.N8N_WEBHOOK_CREATE_BOOKING_ADMIN_DIRECT',
};

content = content.replace(webhookRegex, (match, id, queryParams) => {
  if (replacementMap[id]) {
    if (queryParams) {
      return `\`\${${replacementMap[id]}}${queryParams}\``;
    }
    return replacementMap[id];
  }
  return match;
});

fs.writeFileSync(path, content);
console.log('Replaced webhooks in server/index.ts');
