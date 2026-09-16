# Memories

Turn your photos into instant-camera prints with a handwritten note — right in your browser.

**Live:** https://memories.astradial.com

![Memories screenshot](docs/screenshot.png)

## Features

- True-size Polaroid 600 frame (88 × 107 mm, 79 mm photo)
- Handwritten note and date line (Caveat)
- 300-DPI PNG export per print
- Share sheet on phones and desktop browsers that support it (Save Image, AirDrop, WhatsApp, Mail…)
- A4 print layout with cut lines, at real size
- Mobile friendly: one print per row on phones, camera/gallery picker, touch-sized controls

## Privacy

100% client-side. Nothing is uploaded — photos are processed in your browser and discarded when you close the tab.
No analytics, no cookies, no third-party requests (the font is self-hosted).

## Run locally

```sh
npm install
npm run dev
```

## Deploy

Static build on Cloudflare Pages:

```sh
./deploy.sh
```

## Contributing

PRs welcome. Keep it dependency-free (React + Vite only) and client-side.

## License

MIT — see [LICENSE](LICENSE).
