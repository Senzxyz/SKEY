// /api/verify-checkpoint.js
//
// Server-side checkpoint confirmation. The browser can be fully controlled by
// the user (devtools, tampered localStorage, replayed URLs), so anything that
// only checks state in the browser can be faked. This endpoint is the one
// place that decides "did this person actually complete the gateway step",
// using a service-role Supabase client that bypasses RLS.
//
// >>> TODO before this is production-ready <<<
// Linkvertise's "Anti-Bypassing" feature appends a `token` query param to
// your redirect URL. To actually confirm it server-side you must call
// Linkvertise's verification endpoint from their publisher dashboard docs
// (Settings -> Anti-Bypassing on your Linkvertise account) using your own
// publisher API key. I could not find a stable, publicly documented request
// shape for that specific endpoint to hardcode here with confidence — the
// only public examples I could find were third-party bypass scripts hitting
// *internal* Linkvertise endpoints, which is not something to build on.
// Grab the exact method/URL/params from your own dashboard and drop it into
// `verifyWithLinkvertise()` below. Everything else (replay protection,
// session/step updates, cooldown-safe design) is already wired up.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // service role — server only, never expose to the client
);

const TOTAL_STEPS = 2;

async function verifyWithLinkvertise(token) {
  // Replace this with the real call from your Linkvertise publisher docs.
  // Expected contract: resolve `true` only if Linkvertise confirms the token
  // is valid AND has not already been redeemed on their side.
  //
  // const resp = await fetch(`https://publisher.linkvertise.com/api/v1/anti_bypassing/verify`, {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Authorization': `Bearer ${process.env.LINKVERTISE_API_KEY}`
  //   },
  //   body: JSON.stringify({ token })
  // });
  // const data = await resp.json();
  // return data.success === true;

  return true; // placeholder — DO NOT ship this as-is, see TODO above
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { token, service, hwid, currentStep, userId } = req.body || {};

  if (!token || !hwid || !service) {
    return res.status(400).json({ ok: false, error: 'Missing token, hwid, or service' });
  }

  try {
    // 1. Replay protection: a token can only ever advance one checkpoint,
    //    ever — regardless of which device/session presents it.
    const { data: existingToken } = await supabase
      .from('used_tokens')
      .select('token')
      .eq('token', token)
      .maybeSingle();

    if (existingToken) {
      return res.status(200).json({ ok: false, error: 'This gateway link was already used.' });
    }

    // 2. Ask Linkvertise if the token is real (see TODO above).
    const isValid = await verifyWithLinkvertise(token);
    if (!isValid) {
      return res.status(200).json({ ok: false, error: 'Gateway completion could not be verified.' });
    }

    // 3. Record the token as spent before trusting it further, so a retry
    //    or double-submit can't double-advance the step.
    const { error: insertError } = await supabase.from('used_tokens').insert([{ token, hwid, service }]);
    if (insertError) {
      // Unique constraint race — someone else redeemed it first.
      return res.status(200).json({ ok: false, error: 'This gateway link was already used.' });
    }

    // 4. Advance the step and persist it server-side (source of truth).
    const nextStep = Math.min((currentStep || 0) + 1, TOTAL_STEPS + 1);
    await supabase.from('sessions').upsert([{ hwid, step: nextStep, service, user_id: userId || null }]);

    return res.status(200).json({ ok: true, step: nextStep });
  } catch (err) {
    console.error('verify-checkpoint error:', err);
    return res.status(500).json({ ok: false, error: 'Internal verification error.' });
  }
}
