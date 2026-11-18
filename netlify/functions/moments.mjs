import { YoutubeTranscript } from "youtube-transcript";
import { getStore } from "@netlify/blobs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[\w-]{11}$/.test(id)) return json({ error: "Bad video link." }, 400);

  let store = null;
  try { store = getStore("moments"); } catch (e) {}
  try {
    const hit = store && (await store.get(id, { type: "json" }));
    if (hit) return json({ moments: hit, cached: true });
  } catch (e) {}

  let items;
  try {
    items = await YoutubeTranscript.fetchTranscript(id);
  } catch (e) {
    return json({ error: "Couldn't get a transcript for this video. It may have captions turned off." }, 422);
  }
  if (!items || !items.length) return json({ error: "No transcript found." }, 422);

  const ms = items[items.length - 1].offset > 20000;
  const text = items
    .map((i) => `[${mmss(ms ? i.offset / 1000 : i.offset)}] ${i.text}`)
    .join("\n")
    .slice(0, 60000);

  const prompt = `You find the best clippable moments in a video transcript for short-form clips (TikTok, Shorts, Reels, X). The video is about GTA 6, so favor chaos, funny dialogue, big reveals, wild gameplay and strong reactions. Each moment should work alone in 20 to 60 seconds. Return 5 to 10 moments as a JSON array only. Each item: {"start_seconds":number,"end_seconds":number,"title":"punchy title under 60 characters","why":"one sentence on why it clips well"}. Use the timestamps in the transcript. Order by strength.\n\nTRANSCRIPT:\n${text}`;

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  if (!r.ok) return json({ error: "The AI is busy right now. Try again shortly." }, 502);

  let moments;
  try {
    const data = await r.json();
    moments = JSON.parse(data.candidates[0].content.parts[0].text);
  } catch (e) {
    return json({ error: "Got a messy answer back. Try again." }, 502);
  }

  try { if (store) await store.setJSON(id, moments); } catch (e) {}
  return json({ moments });
};
