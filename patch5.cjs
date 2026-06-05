const fs = require('fs');
let code = fs.readFileSync('panel-backend/src/index.ts', 'utf8');

// The first block
const block1 = `    } else {
       let current = new Date(\`\${payload.selectedDate}T10:00:00\`);
       const end = new Date(\`\${payload.selectedDate}T18:00:00\`);
       while (current < end) {
         availableSlots.push(current.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }));
         current.setMinutes(current.getMinutes() + 60);
       }
    }`;

// The second block
const block2 = `    } else {
       for (const dStr of daysToCheck) {
         let current = new Date(\`\${dStr}T10:00:00+05:30\`);
         const end = new Date(\`\${dStr}T18:00:00+05:30\`);
         while (current < end) {
           const slotEndCheck = new Date(current.getTime() + 50 * 60000);
           if (slotEndCheck > end) break;
           
           availableSlots.push({ 
              timestampMs: current.getTime(),
              dateObj: new Date(current.getTime())
           });
           
           current.setMinutes(current.getMinutes() + 30);
         }
       }
    }`;

let replaced1 = false;
let replaced2 = false;

if (code.includes(block1)) {
  code = code.replace(block1, '    }');
  replaced1 = true;
}

if (code.includes(block2)) {
  code = code.replace(block2, '    }');
  replaced2 = true;
}

fs.writeFileSync('panel-backend/src/index.ts', code);
console.log(`Replaced block 1: ${replaced1}, Replaced block 2: ${replaced2}`);
