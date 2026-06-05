import fs from 'fs';

function checkEnv(filename: string) {
  try {
    const content = fs.readFileSync(filename, 'utf8');
    const lines = content.split('\n');
    const keys = lines
      .filter(line => line.includes('='))
      .map(line => line.split('=')[0].trim());

    console.log(`Keys in ${filename}:`);
    console.log(keys);
  } catch (err) {
    console.log(`Failed to read ${filename}`);
  }
}

checkEnv('.env');
checkEnv('../.env');
checkEnv('../.env.local');
