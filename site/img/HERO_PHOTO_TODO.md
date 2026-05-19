# Hero photo — optional upgrade

The landing page hero currently uses a deep-navy gradient with a subtle
coral glow. Looks confident on its own, but a real Newfoundland photo
would make it sing.

## To add a hero photo

1. **Pick a photo.** Good options:
   - The colourful Jellybean Row houses on Gower Street, St. John's
   - Signal Hill at sunset
   - The Narrows / Battery / harbour from above
   - A modern Avalon home exterior with St. John's skyline in the back

   **Avoid:** Generic stock photos of "real estate agent in suit shaking
   hands." Newfoundland-specific imagery roots the site in place.

2. **Photo specs:**
   - **Resolution:** 2400×1600 minimum (it'll be served at 1200–1920px on
     most screens but having 2× density helps on retina displays)
   - **Format:** JPG (smaller than PNG for photos), quality 80–85
   - **File size:** under 250 KB after compression. Use
     [tinypng.com](https://tinypng.com) or
     [squoosh.app](https://squoosh.app) to compress.
   - **Composition:** Allow space for the headline text on the left
     half — that's where the H1 sits over the photo.
   - **Tone:** Slightly desaturated / moody works well over a dark
     overlay. Bright sunny photos can compete with the headline.

3. **Save as:**
   ```
   ~/Desktop/maxwell-dealflow/site/img/hero.jpg
   ```
   Lowercase, exactly that filename.

4. **Tell me to swap the CSS line.** In `site/css/site.css`, the
   `.hero` selector currently has:
   ```css
   background: linear-gradient(135deg, #0A1220 0%, #16263D 60%, #0F1A2A 100%);
   ```
   I'll swap it for:
   ```css
   background:
     linear-gradient(135deg, rgba(10,18,32,0.78), rgba(15,26,42,0.82)),
     url('/site/img/hero.jpg') center/cover;
   ```
   That keeps the dark overlay (so the white text stays readable) but
   layers your photo underneath. Takes ~2 minutes.

## Where to find good photos (free + licence-clear)

- **Unsplash** (free for commercial use) — search "st johns
  newfoundland", "jellybean row", "signal hill"
- **Pexels** (free for commercial use) — similar search terms
- **Tourism Newfoundland & Labrador** has a press image library if you
  contact them as a local business

## Why we don't auto-use an Unsplash hotlink

Email clients and SEO crawlers prefer images served from your own
domain. Hosting the photo on your Vercel deploy means it loads fast,
caches forever, and never disappears if Unsplash changes their policy.

## Until you add a photo

The current dark-navy gradient is intentional, not a placeholder. It
looks confident enough to ship — many modern landing pages (Stripe,
Linear, Vercel) use gradient heroes rather than photography. You can
launch with the gradient and add the photo when you find the right
one.
