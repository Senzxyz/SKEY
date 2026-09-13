// /api/loader.js
//
// Usage (pasted into an executor as a loadstring, by the *end user*, not
// this codebase):
//   loadstring(game:HttpGet("https://yourdomain.vercel.app/api/loader?key=KEY&script=SLUG&hwid=DEVICE_ID"))()
// DEVICE_ID must be the exact value stored in key_devices.hwid for that key —
// i.e. the site's own browser-generated device id (localStorage
// 'senzy_device_hwid'), NOT something read from a Roblox API at runtime;
// those are different identifier spaces and will never match. The "Key
// Active" page on the site now prints this exact snippet pre-filled with
// the right value — that's the copy users should actually take.
//
// This endpoint never exposes the real GitHub raw URL to the client — it
// fetches the script server-side and streams the text back, so someone
// sniffing the request only ever sees your domain, not the source repo.
//
// It does NOT contain or care about what the script actually does — that's
// whatever you put in your GitHub repo. This file only handles: is the key
// valid, is the script active, log the access, fetch + return the text.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function luaError(message) {
  // Returned as plain Lua so loadstring(...)() just prints an error instead
  // of throwing a confusing syntax error in the user's executor.
  return `print("[Skey] ${message.replace(/"/g, "'")}")`;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  const { key, script, hwid } = req.query;

  if (!key || !script || !hwid) {
    res.status(400);
    return res.end(luaError('Missing key, script, or hwid parameter.'));
  }

  try {
    // 1. Key must exist and not be expired.
    const { data: keyRow, error: keyError } = await supabase
      .from('keys')
      .select('*')
      .eq('key_string', key.toUpperCase())
      .maybeSingle();

    if (keyError || !keyRow) {
      res.status(403);
      return res.end(luaError('Invalid key. Get one at https://yourdomain.vercel.app'));
    }

    if (!keyRow.is_permanent && keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
      res.status(403);
      return res.end(luaError('Your key has expired. Get a new one at https://yourdomain.vercel.app'));
    }

    // 1b. hwid must be one of THIS key's bound devices — otherwise a shared
    // key_string works from any machine and the whole max_devices/HWID lock
    // built for the website is meaningless here. Activate via the site first
    // (same activate_key_device flow the Reset HWID page uses).
    const { data: boundDevice } = await supabase
      .from('key_devices')
      .select('id')
      .eq('key_id', keyRow.id)
      .eq('hwid', hwid)
      .maybeSingle();

    if (!boundDevice) {
      res.status(403);
      return res.end(luaError('This device is not activated on that key. Activate it on the site first.'));
    }

    // 2. Script must exist and be turned on.
    const { data: scriptRow, error: scriptError } = await supabase
      .from('scripts')
      .select('*')
      .eq('slug', script)
      .eq('is_active', true)
      .maybeSingle();

    if (scriptError || !scriptRow) {
      res.status(404);
      return res.end(luaError('Script not found or currently disabled.'));
    }

    // 3. Fetch the real script from GitHub server-side.
    const ghResponse = await fetch(scriptRow.github_raw_url, {
      // Bust GitHub's/jsDelivr's CDN cache so key revocations / script
      // updates show up immediately instead of being served stale.
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(5000)
    });

    if (!ghResponse.ok) {
      res.status(502);
      return res.end(luaError('Could not fetch the script right now. Try again shortly.'));
    }

    const scriptText = await ghResponse.text();

    // 4. Log the access (fire-and-forget — don't block the response on it).
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
    supabase.from('script_access_logs').insert([{ script_id: scriptRow.id, key_string: keyRow.key_string, ip }])
      .then(() => {})
      .catch(e => console.error('log insert failed:', e));

    res.status(200);
    return res.end(scriptText);
  } catch (err) {
    console.error('loader error:', err);
    res.status(500);
    return res.end(luaError('Internal loader error.'));
  }
}