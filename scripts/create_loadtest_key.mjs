/**
 * One-off: create an API key for JMeter load tests.
 * Run from the repo root:   node scripts/create_loadtest_key.mjs
 */
import { createClient } from '@insforge/sdk';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Parse .env.local without requiring dotenv
const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const sb = createClient({
  baseUrl: env.NEXT_PUBLIC_INSFORGE_URL,
  anonKey: env.INSFORGE_SERVICE_KEY || env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
  isServerMode: true,
});

const key = 'dc_live_' + crypto.randomBytes(24).toString('hex');
const payload = {
  key,
  name: 'jmeter-loadtest-apr2026',
  created_at: new Date().toISOString(),
  active: true,
  permissions: ['read', 'write'],
  webhook_url: null,
};

const { data, error } = await sb.database.from('dc_api_keys').insert(payload);
if (error) {
  console.error('INSERT error:', JSON.stringify(error, null, 2));
  process.exit(1);
}
console.log('\n✅ API KEY CREATED (save it now — no way to show again):');
console.log('\n   ' + key + '\n');
