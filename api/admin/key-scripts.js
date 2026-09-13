// /api/admin/key-scripts.js
//
// Manages which scripts a given key is allowed to run (key_scripts join
// table). Same service-role + admin-check pattern as admin/scripts.js —
// key_scripts has no anon write policy on purpose.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getDiscordId(user) {
  if (!user) return null;
  return user.user_metadata?.provider_id || user.identities?.[0]?.id || user.id;
}

async function requireAdmin(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const discordId = getDiscordId(user);
  if (!process.env.ADMIN_DISCORD_ID || String(discordId) !== String(process.env.ADMIN_DISCORD_ID)) {
    return null;
  }
  return user;
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return res.status(403).json({ error: 'Admin only.' });
  }

  try {
    if (req.method === 'GET') {
      const { key_id } = req.query;
      if (!key_id) return res.status(400).json({ error: 'key_id is required.' });
      const { data, error } = await supabase.from('key_scripts').select('script_id').eq('key_id', key_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ script_ids: (data || []).map(r => r.script_id) });
    }

    // Replace-all: body = { key_id, script_ids: [1,2,3] }. Simplest correct
    // way to let the admin UI just send "here's the full checked list" every
    // save instead of diffing adds/removes itself.
    if (req.method === 'PUT') {
      const { key_id, script_ids } = req.body || {};
      if (!key_id || !Array.isArray(script_ids)) {
        return res.status(400).json({ error: 'key_id and script_ids[] are required.' });
      }

      const { error: deleteError } = await supabase.from('key_scripts').delete().eq('key_id', key_id);
      if (deleteError) return res.status(500).json({ error: deleteError.message });

      if (script_ids.length > 0) {
        const rows = script_ids.map(script_id => ({ key_id, script_id }));
        const { error: insertError } = await supabase.from('key_scripts').insert(rows);
        if (insertError) return res.status(500).json({ error: insertError.message });
      }

      return res.status(200).json({ ok: true, script_ids });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin/key-scripts error:', err);
    return res.status(500).json({ error: 'Internal error.' });
  }
}