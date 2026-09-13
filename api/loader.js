// /api/loader.js
//
// Called by Loader.lua (the one static file users point their loadstring
// at — see loader-lua/Loader.lua in this delivery), not directly by users.
//
//   GET /api/loader?script=SLUG                      -> for requires_key=false scripts
//   GET /api/loader?script=SLUG&key=KEY&hwid=DEVICE   -> for requires_key=true scripts
//
// This endpoint never exposes the real GitHub raw URL to the client -- it
// fetches the script server-side and streams the text back, so someone
// sniffing the request only ever sees your domain, not the source repo.

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

  if (!script) {
    res.status(400);
    return res.end(luaError('Missing script parameter.'));
  }

  try {
    // 1. Script must exist and be turned on.
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

    let keyRow = null;

    if (scriptRow.requires_key) {
      if (!key || !hwid) {
        res.status(400);
        return res.end(luaError('This script needs a key. Set SenzyKey/SenzyHWID from the site first.'));
      }

      // 2. Key must exist and not be expired.
      const { data: foundKey, error: keyError } = await supabase
        .from('keys')
        .select('*')
        .eq('key_string', key.toUpperCase())
        .maybeSingle();

      if (keyError || !foundKey) {
        res.status(403);
        return res.end(luaError('Invalid key. Get one at https://yourdomain.vercel.app'));
      }
      keyRow = foundKey;

      if (!keyRow.is_permanent && keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
        res.status(403);
        return res.end(luaError('Your key has expired. Get a new one at https://yourdomain.vercel.app'));
      }

      // 3. hwid must be one of THIS key's bound devices -- otherwise a shared
      // key_string works from any machine, bypassing the device limit.
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

      // 4. Key must specifically be granted access to THIS script -- a key
      // can be scoped to N scripts (key_scripts), not everything by default.
      const { data: grant } = await supabase
        .from('key_scripts')
        .select('key_id')
        .eq('key_id', keyRow.id)
        .eq('script_id', scriptRow.id)
        .maybeSingle();

      if (!grant) {
        res.status(403);
        return res.end(luaError('Your key is not authorized for this script.'));
      }
    }
    // else: requires_key === false -> keyless script, no checks above needed.

    // 5. Fetch the real script from GitHub server-side.
    const ghResponse = await fetch(scriptRow.github_raw_url, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(5000)
    });

    if (!ghResponse.ok) {
      res.status(502);
      return res.end(luaError('Could not fetch the script right now. Try again shortly.'));
    }

    const scriptText = await ghResponse.text();

    // 6. Log the access (fire-and-forget -- don't block the response on it).
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
    supabase.from('script_access_logs').insert([{ script_id: scriptRow.id, key_string: keyRow?.key_string || null, ip }])
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