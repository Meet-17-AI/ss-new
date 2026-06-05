import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const key = process.env.RESEND_API_KEY;
if (!key) {
  console.log("RESEND_API_KEY is undefined");
} else {
  console.log(`Length: ${key.length}`);
  console.log(`Prefix: ${key.substring(0, 3)}`);
  console.log(`Suffix: ${key.substring(key.length - 3)}`);
  console.log(`Has trailing spaces: ${key.trim() !== key}`);
}
