// /api/admin/scripts.js
//
// CRUD for the `scripts` table. This exists because sql/scripts-loader.sql
// deliberately leaves no insert/update/delete policy on `scripts` for the
// anon/authenticated roles (that key is public, shipped in your client JS —
// letting it write there means anyone with devtools could rewrite
// github_raw_url or wipe every script). So writes go through here instead,
// using the service role, gated by checking the caller is really your admin.
//
// Requires env vars already set for the other server functions:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Plus one new one:
//   ADMIN_DISCORD_ID — the same admin id your client already checks against
//   (config.adminUuid in your /api/config.js). Set it once in Vercel env vars.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getDiscordId(user) {
  // Mirrors the same logic the client uses (getDiscordId() in index.html) —
  // keep these two in sync if that ever changes.
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
      const { data, error } = await supabase.from('scripts').select('*').order('id', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ scripts: data });
    }

    if (req.method === 'POST') {
      const { name, slug, github_raw_url, is_active, requires_key } = req.body || {};
      if (!name || !slug || !github_raw_url) {
        return res.status(400).json({ error: 'name, slug, and github_raw_url are required.' });
      }
      const { data, error } = await supabase.from('scripts').insert([{ name, slug, github_raw_url, is_active: !!is_active, requires_key: requires_key !== false }]).select().single();
      if (error) return res.status(400).json({ error: error.message }); // e.g. duplicate slug
      return res.status(200).json({ script: data });
    }

    if (req.method === 'PUT') {
      const { id, name, slug, github_raw_url, is_active, requires_key } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required.' });
      const { data, error } = await supabase
        .from('scripts')
        .update({ name, slug, github_raw_url, is_active: !!is_active, requires_key: requires_key !== false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ script: data });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required.' });
      const { error } = await supabase.from('scripts').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin/scripts error:', err);
    return res.status(500).json({ error: 'Internal error.' });
  }
}