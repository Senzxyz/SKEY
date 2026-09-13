// /api/public-scripts.js
//
// Public, unauthenticated. Returns only what a loader menu needs to display
// — never the github_raw_url (that stays server-side, fetched only inside
// /api/loader.js so it's never exposed to the client/executor directly).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { data, error } = await supabase
    .from('scripts')
    .select('slug, name, requires_key')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ scripts: data });
}