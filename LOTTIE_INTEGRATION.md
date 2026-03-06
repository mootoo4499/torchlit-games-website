---
title: Lottie Integration Guide
project: TorchLit Games Website
updated: 2026-03-06
---

# Lottie Integration — What Works and Why

This doc exists because we spent hours debugging broken animations. Read this before touching anything Lottie-related.

---

## The Stack That Works

| Piece | Value | Why |
|-------|-------|-----|
| **Player** | `@dotlottie/player-component@2.7.12` | Handles both `.lottie` and `.json`. Extracts embedded fonts from `.lottie` ZIP files. |
| **Format (text animations)** | `.lottie` | ZIP format. Font TTF is embedded inside. Always renders correctly. |
| **Format (icon-only animations)** | `.json` | No text layers = no font needed. Fine to use `.json`. |
| **Version pinning** | `@2.7.12` (never `@latest`) | `@latest` has had broken releases. Pin it. |
| **Background attribute** | `background="transparent"` | Without this, the player renders a white canvas box behind the animation. |

---

## The Core Rule

> **If an animation has text, use `.lottie`. Never `.json`.**

### Why `.json` breaks for text

`.json` only stores the font **name as a string** (e.g. `"Teko Semi Bold"`). The browser must find a font registered under that exact name. It almost never does. Result: serif fallback, clipped text, broken layout.

### Why `.lottie` works

`.lottie` is a ZIP file. It contains:
```
manifest.json
a/Main Scene.json   ← the animation data
f/Teko Semi Bold.ttf  ← the actual font, embedded
```
The player unzips it, loads the font directly, and renders it correctly every time.

---

## Do Not Use `@lottiefiles/lottie-player`

`lottie-player` is the older package. It cannot unzip `.lottie` files. It does not load embedded fonts. It only works with `.json`. Using it for text animations will always fail.

**Use `@dotlottie/player-component` for everything.**

---

## Firebase MIME Types

Firebase does not know what `.lottie` files are by default. Without the correct headers, it serves them as `text/plain` and the player throws a parse error.

`firebase.json` must include:

```json
"headers": [
  {
    "source": "**/*.lottie",
    "headers": [
      { "key": "Content-Type", "value": "application/zip" },
      { "key": "Access-Control-Allow-Origin", "value": "*" }
    ]
  },
  {
    "source": "**/*.json",
    "headers": [
      { "key": "Content-Type", "value": "application/json" },
      { "key": "Access-Control-Allow-Origin", "value": "*" }
    ]
  }
]
```

---

## HTML Pattern

```html
<!-- In <head> — pinned version, type="module" required -->
<script src="https://unpkg.com/@dotlottie/player-component@2.7.12/dist/dotlottie-player.js" type="module"></script>

<!-- Text animation (.lottie with embedded font) -->
<dotlottie-player
  src="/animations/torchlit_lockup.lottie"
  autoplay
  loop
  background="transparent"
  style="width:100%;height:auto;">
</dotlottie-player>

<!-- Icon/flame animation (no text, .json is fine) -->
<dotlottie-player
  src="/animations/streak-fire-orange.json"
  autoplay
  loop
  background="transparent"
  style="width:100%;height:100%;">
</dotlottie-player>
```

---

## Current Animation Assets

| File | Format | Contains | Use |
|------|--------|----------|-----|
| `torchlit_lockup.lottie` | `.lottie` (ZIP) | Flame precomp + TORCHLIT text + Teko Semi Bold font | Hero lockup on homepage |
| `streak-fire-orange.json` | `.json` | Flame animation only | Header icon, any standalone flame |

---

## Creating / Updating Animations

1. Build in [LottieFiles Creator](https://lottiefiles.com/create)
2. Set **background to Transparent** before exporting
3. Export as **`.lottie`** (not `.json`) if the animation has any text
4. Drop the file into `public/animations/`
5. Run `firebase deploy --only hosting`

---

*If something breaks, check these in order:*
1. Is it `.lottie` format (not `.json`)?
2. Is `@dotlottie/player-component` loaded (not `lottie-player`)?
3. Is the version pinned (not `@latest`)?
4. Does `firebase.json` have the MIME type headers?
5. Does the player have `background="transparent"`?
