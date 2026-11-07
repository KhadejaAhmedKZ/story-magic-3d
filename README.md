# Story Magic 3D ✨📖

A Rafeeq feature: a child types or says a story idea and gets a **brand-new, personalised,
3D-animated story movie** (6 scenes, warm narrator, captions, gentle lullaby), designed to be
**epilepsy-safe**.

Everything is generated fresh for every request. Nothing is pre-made.

```
GitHub Pages (static site)  ──►  Cloudflare Worker (holds the key, enforces limits)  ──►  MiniMax API
  index.html, css/, js/            worker/src/index.js                                     story · images · Hailuo video · voice
```

The API key lives only in the Worker as a secret. The website has no key, no sign-in and no payment pop-up.

---

## 1. What you need to buy (one key)

| What | Where | Cost |
|---|---|---|
| **MiniMax API key** (video + images + voice + story text) | <https://platform.minimax.io> → sign up → **Billing → top up** → **Account → API Keys → Create** | prepaid balance, pay as you go |
| Cloudflare account (runs the proxy) | <https://dash.cloudflare.com/sign-up> | free plan is enough |
| GitHub Pages | your GitHub repo | free |

**Cost per story (MiniMax list prices, Nov 2026):**

| Item | Model | Price | Per story |
|---|---|---|---|
| 6 video clips, 6 s, 768p | `MiniMax-Hailuo-2.3-Fast` (image-to-video) | $0.19 / clip | $1.14 |
| 7 images (hero + 6 first frames) | `image-01` with character reference | $0.0035 / image | $0.03 |
| 8 narration lines (~1,300 characters) | `speech-2.8-hd` | $100 / 1M characters | $0.13 |
| Story writing | `MiniMax-M3.1-Flash` | per token | < $0.01 |
| **Total** | | | **≈ $1.31** |

At the 6-stories-a-day limit that is about $7.90/day, or **about $236/month if one child used every story every day**.
In practice you pay only for stories actually made. A failed clip is retried once, so the worst case is about $2.45 for one story.

**Don't-go-over protection (three layers):**
1. **Prepaid balance.** MiniMax only spends what you've topped up. Turn off auto-recharge if your account shows it.
2. **Limits in the Worker** (`worker/wrangler.toml`):
   - `DAILY_LIMIT_PER_DEVICE = 6`: stories per child's device per day (resets at midnight UAE time).
   - `DAILY_LIMIT_TOTAL = 12`: stories per day for the whole site.
   - `MONTHLY_LIMIT_TOTAL = 180`: stories per month for the whole site (6 a day all month, ≈ $236 maximum). Lower it to spend less.
3. **Per-story ceilings.** The Worker only accepts up to 12 images, 9 clips and 14 voice lines per story token. It writes every prompt itself, so the site can't be used to generate anything else.

Cheaper or sharper options (change `VIDEO_MODEL` / `VIDEO_RESOLUTION` in `wrangler.toml`):

| Setting | Per clip | Per story |
|---|---|---|
| Hailuo 2.3 Fast, 768P (default: fast and Hailuo quality) | $0.19 | ≈ $1.31 |
| Hailuo 2.3 Fast, 1080P | $0.33 | ≈ $2.15 |
| Hailuo 2.3, 768P (a little sharper, slower) | $0.28 | ≈ $1.85 |

---

## 2. Deploy the proxy (≈ 10 minutes)

```bash
cd worker
npx wrangler login                                  # opens Cloudflare in the browser
npx wrangler kv namespace create QUOTA              # copy the printed id into wrangler.toml
npx wrangler secret put MINIMAX_API_KEY             # paste your MiniMax key
npx wrangler secret put TOKEN_SECRET                # paste any long random text
npx wrangler deploy                                 # prints https://story-magic-proxy.<you>.workers.dev
```

Then:
1. In `worker/wrangler.toml`, set `ALLOWED_ORIGINS` to your Pages address, e.g. `https://khadejaahmedkz.github.io`, and run `npx wrangler deploy` again.
2. In `js/config.js`, set `apiBase` to the Worker URL from `wrangler deploy`.
3. Check it: open `https://story-magic-proxy.<you>.workers.dev/api/health (this project: https://story-magic-proxy.khadeja123412.workers.dev)`. It should show `"hasKey": true`.

Optional **family code**: `npx wrangler secret put ACCESS_CODE`, then once on the child's device run
`localStorage.setItem("sm3d.code", "<the code>")` in the browser console. Strangers who find the URL can't use your credits.

## 3. Deploy the website (GitHub Pages)

The site is plain static files (`index.html`, `css/`, `js/`). Push the folder to a GitHub repo, then
**Settings → Pages → Deploy from branch → main / root**. Don't publish `worker/.dev.vars` or `dev-mock/`; both are already in `.gitignore`.

## 4. Run it locally

```bash
python3 -m http.server 8795                         # the website
cd worker && npx wrangler dev --port 8787           # the proxy (reads worker/.dev.vars)
```

Open <http://localhost:8795/?api=http://localhost:8787>.

- **Mock mode** (`MOCK=1` in `worker/.dev.vars`): no key and no cost. Uses sample files from `dev-mock/` so you can test the whole flow.
- **Real mode**: put `MINIMAX_API_KEY=...` and `MOCK=0` in `worker/.dev.vars` (that file is git-ignored).

Testing switches: `?wait=20` changes the 2-minute cutoff; `?voice=kokoro` / `?voice=browser` forces a voice.

---

## How it works

1. **Story**: the Worker asks `MiniMax-M3.1-Flash` for strict JSON `{title, character, setting, mood, scenes[6]{text, video_prompt}}`, retries on bad JSON, and validates it. The child is the hero, their favourite thing is included, it ends with a small lesson, and it never has villains or danger.
2. **Hero**: one 3D portrait made from the fixed `character` description.
3. **Scenes**: 6 film stills made at the same time, each using the hero portrait as a **character reference**, so the child looks the same in every scene.
4. **Video**: each still becomes the **first frame** of a 6 s Hailuo clip. All 6 clips render at the same time. Every prompt gets the 3D style text, a slow camera command (`[Push in]`, `[Pan left]`…) and *"calm steady lighting, no flashing, no strobe…"*.
5. **Voice**: MiniMax `speech-2.8-hd` with word timestamps, so captions follow the narrator word by word.
6. **The 2-minute promise**: when `maxWaitSeconds` (110 s) is reached, the movie starts anyway. A clip that is still rendering keeps going and swaps in before its scene plays. If it never arrives, that scene uses its 3D still with a slow camera drift.
7. **Player**: title card → 6 scenes → "The End: Goodnight, name!", with ≥ 1.6 s crossfades, a new Web Audio lullaby every time that gets quieter under the narrator, and play/pause, replay, music toggle, scene dots, new story and **Download my movie** (records the movie with narration and music to MP4 in Chrome, or WebM elsewhere).

## Fun, but safe

- **Lively clips:** each scene asks Hailuo for one playful, clearly visible action with both hero and sidekick moving the whole clip (hopping, twirling, waving, splashing, a happy dance) and big expressive faces. Clips play at 0.85× or faster, so there's no sleepy slow motion.
- **Animated title and end cards:** the hero bobs in a bubble, letters pop in one by one, and stars, bubbles and balloons drift up slowly.
- **Girl / boy / surprise me** picker so the hero looks the way the child wants; with "surprise me" the story uses the child's name instead of he/she.
- **Rate limits:** if MiniMax says "too many requests this minute", the clip or image waits and retries (6 s, 12 s, …) instead of falling back to a still.

## Epilepsy safety

- No cuts anywhere: every change is a crossfade of at least 1 s (1.6 s by default). UI animations are slow (6 s+ cycles) and there are no blinking effects.
- Every video prompt asks for calm lighting with no flashing, strobe or flicker. Story prompts ban lightning, fireworks and fast motion.
- **Flash guard**: while a clip plays, its brightness is sampled 10× a second. Two sharp jumps within one second (well below the 3-flashes-per-second limit) gently dims and softens the picture for a few seconds.
- `prefers-reduced-motion` turns off the decorative motion.

## Fallbacks (it never just breaks)

| If this fails | The child gets |
|---|---|
| A video clip (after 1 retry) | that scene's 3D still with a slow camera move |
| Images | soft dreamy backgrounds (emergency only) |
| MiniMax voice | Kokoro voice running in the browser (free) → browser voice |
| Story model | a random template story (the pictures and clips are still made) |
| The whole proxy | a template story, dreamy backgrounds and the Kokoro voice |
| Daily limit reached | "You made lots of stories today! Come back tomorrow 🌙" |

No raw error is ever shown to the child.

## Files

```
index.html, css/style.css
js/config.js                provider switches, 2-minute cutoff, voices
js/app.js                   UI + generation pipeline
js/player.js                movie player, captions, flash guard
js/music.js                 generated lullaby (Web Audio)
js/recorder.js              "Download my movie"
js/kokoro-worker.js         free in-browser voice (fallback)
js/providers/{api,story,image,video,voice}.js   swappable providers
worker/src/index.js         Cloudflare Worker proxy (key, prompts, limits)
worker/wrangler.toml        limits + model settings
```

## Measured on a real run (8 Nov 2026, MiniMax, Hailuo 2.3 Fast 768P)

| Step | Time |
|---|---|
| Story (MiniMax-M3.1-Flash) | 7 s |
| Hero portrait (image-01) | 16 s |
| 6 scene stills, all at once (with character reference) | 18–32 s |
| 6 Hailuo clips, all at once | 50–64 s each |
| Narration, 8 lines (speech-2.8-hd) | 9 s (in parallel) |
| **Click → movie ready (all 6 scenes animated)** | **≈ 110 s** |

The finished movie was ≈ 89 s long (6 scenes of 11–14 s, narration at a calm 0.92× pace). The flash guard never had to step in.
