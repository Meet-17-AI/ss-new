const fs = require('fs');
let code = fs.readFileSync('panel-backend/src/index.ts', 'utf8');

// The first block
const regex1 = /\} else \{\s*let current = new Date\(`\$\{payload\.selectedDate\}T10:00:00`\);\s*const end = new Date\(`\$\{payload\.selectedDate\}T18:00:00`\);\s*while \(current < end\) \{\s*availableSlots\.push\(current\.toLocaleTimeString\('en-US', \{ hour: '2-digit', minute: '2-digit', hour12: true \}\)\);\s*current\.setMinutes\(current\.getMinutes\(\) \+ 60\);\s*\}\s*\}/g;

// The second block
const regex2 = /\} else \{\s*for \(const dStr of daysToCheck\) \{\s*let current = new Date\(`\$\{dStr\}T10:00:00\+05:30`\);\s*const end = new Date\(`\$\{dStr\}T18:00:00\+05:30`\);\s*while \(current < end\) \{\s*const slotEndCheck = new Date\(current\.getTime\(\) \+ 50 \* 60000\);\s*if \(slotEndCheck > end\) break;\s*availableSlots\.push\(\{ \s*timestampMs: current\.getTime\(\),\s*dateObj: new Date\(current\.getTime\(\)\)\s*\}\);\s*current\.setMinutes\(current\.getMinutes\(\) \+ 30\);\s*\}\s*\}\s*\}/g;

let replaced1 = false;
let replaced2 = false;

if (regex1.test(code)) {
  code = code.replace(regex1, '}');
  replaced1 = true;
}

if (regex2.test(code)) {
  code = code.replace(regex2, '}');
  replaced2 = true;
}

fs.writeFileSync('panel-backend/src/index.ts', code);
console.log(`Replaced block 1: ${replaced1}, Replaced block 2: ${replaced2}`);
