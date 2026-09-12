export default function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const adminUuid = process.env.ADMIN_DISCORD_ID;

    if (!supabaseUrl || !supabaseAnonKey) {
        return res.status(500).json({ error: 'Missing Supabase config on server' });
    }

    return res.status(200).json({
        supabaseUrl,
        supabaseAnonKey,
        adminUuid: adminUuid || null
    });
}