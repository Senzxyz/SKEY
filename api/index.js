export default function handler(req, res) {
    res.status(200).json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
        adminUuid: process.env.ADMIN_DISCORD_ID
    });
}
