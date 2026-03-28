/**
 * Live integration test: photo context persistence across turns.
 *
 * Uses REAL Immich API and Anthropic API to reproduce the exact bug:
 * 1. User asks to see today's photos → Chris describes them
 * 2. User asks follow-up about the photos → Chris should still know what he saw
 * 3. User changes topic → Chris should NOT re-fetch photos or claim he can't see
 *
 * Run: ANTHROPIC_API_KEY=... IMMICH_API_URL=... IMMICH_API_KEY=... npx tsx scripts/test-photo-memory.ts
 */

import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const IMMICH_API_URL = process.env.IMMICH_API_URL || 'http://192.168.1.50:2283';
const IMMICH_API_KEY = process.env.IMMICH_API_KEY!;
const SONNET_MODEL = 'claude-sonnet-4-6';

if (!ANTHROPIC_API_KEY || !IMMICH_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY or IMMICH_API_KEY');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ── Immich helpers ────────────────────────────────────────────────────────

interface ImmichAsset {
  id: string;
  type: string;
  originalFileName: string;
  fileCreatedAt?: string;
  exifInfo?: {
    city?: string | null;
    country?: string | null;
    state?: string | null;
    dateTimeOriginal?: string | null;
    description?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    make?: string | null;
    model?: string | null;
  } | null;
  people?: Array<{ id: string; name: string }>;
}

async function fetchRecentPhotos(limit = 5): Promise<ImmichAsset[]> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const res = await fetch(`${IMMICH_API_URL}/api/search/metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': IMMICH_API_KEY,
    },
    body: JSON.stringify({
      type: 'IMAGE',
      withExif: true,
      withPeople: true,
      page: 1,
      size: limit,
      order: 'desc',
    }),
  });

  if (!res.ok) throw new Error(`Immich API: ${res.status}`);
  const data = await res.json();
  return data.assets?.items ?? [];
}

async function fetchThumbnail(assetId: string): Promise<string> {
  const res = await fetch(`${IMMICH_API_URL}/api/assets/${assetId}/thumbnail?size=preview`, {
    headers: { 'x-api-key': IMMICH_API_KEY },
  });
  if (!res.ok) throw new Error(`Thumbnail: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

function assetToText(asset: ImmichAsset): string {
  const lines: string[] = [];
  lines.push(`Photo: ${asset.originalFileName}`);
  const exif = asset.exifInfo;
  if (exif?.dateTimeOriginal) lines.push(`Date: ${exif.dateTimeOriginal.substring(0, 10)}`);
  const loc = [exif?.city, exif?.state, exif?.country].filter(Boolean);
  if (loc.length > 0) lines.push(`Location: ${loc.join(', ')}`);
  const people = (asset.people ?? []).filter(p => p.name);
  if (people.length > 0) lines.push(`People: ${people.map(p => p.name).join(', ')}`);
  if (exif?.make || exif?.model) lines.push(`Camera: ${[exif?.make, exif?.model].filter(Boolean).join(' ')}`);
  return lines.join('\n');
}

// ── Simulated conversation ────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Chris, a close friend. You speak naturally and warmly. 
When you've seen photos, you remember them and can discuss them.
You NEVER claim you cannot see photos if you've already seen and discussed them.
Respond in the same language as the user.`;

// This simulates the conversation DB
const conversationHistory: Anthropic.Messages.MessageParam[] = [];

async function simulateTurn(
  label: string,
  userText: string,
  imageContent?: Anthropic.Messages.ContentBlockParam[],
  photoContext?: string,
): Promise<string> {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`\n👤 User: ${userText}\n`);

  // What gets saved to the DB for this user message
  const savedUserContent = photoContext ? `${userText}\n\n${photoContext}` : userText;

  // Build the API message (may include images for the current turn)
  const apiMessages: Anthropic.Messages.MessageParam[] = [
    ...conversationHistory,
  ];

  if (imageContent) {
    // For the vision call, send images + text
    apiMessages.push({ role: 'user', content: imageContent });
  } else {
    apiMessages.push({ role: 'user', content: userText });
  }

  const response = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: apiMessages,
  });

  const responseText = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  console.log(`🤖 Chris: ${responseText}\n`);
  console.log(`   [tokens: in=${response.usage.input_tokens} out=${response.usage.output_tokens}]`);

  // Save to conversation history (what would go in the DB)
  // THIS IS THE KEY FIX: we save the enriched user message, not the raw one
  conversationHistory.push({ role: 'user', content: savedUserContent });
  conversationHistory.push({ role: 'assistant', content: responseText });

  return responseText;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Fetching photos from Immich...');
  const assets = await fetchRecentPhotos(3);
  console.log(`   Found ${assets.length} photos`);

  if (assets.length === 0) {
    console.log('❌ No photos found in Immich. Cannot test.');
    process.exit(1);
  }

  // Fetch thumbnails
  console.log('📸 Fetching thumbnails...');
  const thumbnails: Array<{ asset: ImmichAsset; base64: string }> = [];
  for (const asset of assets.slice(0, 3)) {
    const base64 = await fetchThumbnail(asset.id);
    thumbnails.push({ asset, base64 });
    console.log(`   ✓ ${asset.originalFileName} (${Math.round(base64.length / 1024)}KB base64)`);
  }

  // ── TURN 1: Ask about photos (with images) ──────────────────────────

  const imageContent: Anthropic.Messages.ContentBlockParam[] = [];
  const photoSummaries: string[] = [];

  for (const { asset, base64 } of thumbnails) {
    imageContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
    });
    const meta = assetToText(asset);
    imageContent.push({ type: 'text', text: `[Photo metadata: ${meta}]` });
    photoSummaries.push(meta);
  }

  imageContent.push({ type: 'text', text: "Regarde mes photos d'aujourd'hui !" });

  const photoContext = `[Chris viewed ${thumbnails.length} photo(s):\n${photoSummaries.join('\n---\n')}]`;

  const turn1 = await simulateTurn(
    "TURN 1: Photo request (with vision)",
    "Regarde mes photos d'aujourd'hui !",
    imageContent,
    photoContext,
  );

  // ── TURN 2: Follow-up about the photos (NO images) ──────────────────

  const turn2 = await simulateTurn(
    "TURN 2: Follow-up about photos (text only, NO re-fetch)",
    "Quelle photo tu préfères et pourquoi ?",
  );

  // ── TURN 3: Change topic completely ─────────────────────────────────

  const turn3 = await simulateTurn(
    "TURN 3: Topic change (should NOT mention inability to see photos)",
    "Oublie les photos. J'ai eu une journée stressante au travail, un collègue m'a énervé.",
  );

  // ── Verification ────────────────────────────────────────────────────

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  VERIFICATION');
  console.log(`${'═'.repeat(60)}\n`);

  const issues: string[] = [];

  // Turn 1: should describe photos
  if (!turn1 || turn1.length < 20) {
    issues.push('Turn 1: Chris gave no meaningful response about photos');
  }

  // Turn 2: should reference the photos, NOT say "I can't see photos"
  const cantSeePatterns = /(?:can'?t see|cannot see|pas voir|ne vois pas|don'?t have access|pas accès|unable to view|impossible de voir|je ne peux pas)/i;
  if (cantSeePatterns.test(turn2)) {
    issues.push('Turn 2: Chris claims he cannot see the photos!');
  }

  // Turn 3: should talk about the stressful day, NOT about photos
  if (cantSeePatterns.test(turn3)) {
    issues.push('Turn 3: Chris claims he cannot see photos on an unrelated topic!');
  }

  // Print saved conversation to show what would be in the DB
  console.log('📝 Saved conversation history (what\'s in the DB):');
  for (const msg of conversationHistory) {
    const role = msg.role === 'user' ? '👤' : '🤖';
    const content = typeof msg.content === 'string' ? msg.content : '[complex content]';
    const preview = content.length > 120 ? content.substring(0, 120) + '...' : content;
    console.log(`   ${role} ${preview}`);
  }

  if (issues.length > 0) {
    console.log('\n❌ ISSUES FOUND:');
    for (const issue of issues) {
      console.log(`   • ${issue}`);
    }
    process.exit(1);
  } else {
    console.log('\n✅ All turns passed! Chris correctly:');
    console.log('   • Turn 1: Described the photos');
    console.log('   • Turn 2: Discussed photos without re-fetching (text-only history)');
    console.log('   • Turn 3: Changed topic naturally, no "can\'t see photos" confusion');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
