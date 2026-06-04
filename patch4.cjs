const fs = require('fs');

// Patch PublicDirectory.tsx
let pd = fs.readFileSync('components/PublicDirectory.tsx', 'utf8');
pd = pd.replace("fetch('/api/therapy-services')", "fetch('/api/services')");
fs.writeFileSync('components/PublicDirectory.tsx', pd);

// Patch TherapyCalendarDetails.tsx
let tcd = fs.readFileSync('components/TherapyCalendarDetails.tsx', 'utf8');
tcd = tcd.replace("fetch('/api/therapy-services')", "fetch('/api/services')");
tcd = tcd.replace("`/api/therapy-services/${id}`", "`/api/services/${id}`");
tcd = tcd.replace("'/api/therapy-services'", "'/api/services'");
fs.writeFileSync('components/TherapyCalendarDetails.tsx', tcd);

console.log("Patched both files successfully!");
