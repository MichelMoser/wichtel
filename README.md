# Familien-Wichteln

A small Secret Santa ("Wichteln") site for the family, hosted for free on GitHub Pages.

1. Create a round with a name, date, budget and message.
2. Share the invite link in the family WhatsApp chat.
3. Everyone registers with their name, email and an optional wish list.
4. The organiser clicks **Lose ziehen** to draw. Each person opens the site and sees only who they give a present to.

The organiser can also add exclusions (for example, couples don't draw each other), redraw, and notify everyone by WhatsApp or email.

**Privacy:** Each person's draw result is encrypted in their browser with a key only they hold, in their personal link. Nobody can look up the assignments, including the organiser or anyone with database access.

## One-time setup: Firebase (free, about 5 minutes)

GitHub Pages only serves static files, so the site keeps registrations in Firebase Firestore. The free Spark plan is more than enough.

1. Go to <https://console.firebase.google.com> → **Add project** (e.g. `wichtel-familie`). You can turn Google Analytics off.
2. **Build → Firestore Database → Create database.** Pick the `eur3 (europe-west)` location and start in **production mode**.
3. Open the **Rules** tab, paste the contents of [`firestore.rules`](firestore.rules), and click **Publish**.
4. **Project settings** (gear icon) → **Your apps** → click the web icon `</>` and register the app (no hosting needed). Copy the `firebaseConfig` object.
5. Paste it into [`config.js`](config.js) in place of `export const firebaseConfig = null;`, then commit and push.

The Firebase web config is meant to be public, so it's fine to commit it.

Until Firebase is configured, the site runs in **demo mode**: data stays in your browser only. That's enough to try the flow, for example in two browser tabs.

## Optional: automatic emails (EmailJS, free up to 200 per month)

Without this, the site opens your own mail app (with everyone in BCC) and offers WhatsApp buttons. To send emails automatically, such as each person's personal link right after they register:

1. Create an account at <https://www.emailjs.com>, add an **Email Service** (e.g. your Gmail).
2. Create an **Email Template**:
   - To Email: `{{to_email}}`
   - Subject: `{{subject}}`
   - Content: `{{message}}`
3. Paste `publicKey` (Account → General), `serviceId` and `templateId` into `emailjsConfig` in `config.js`.

## Short link with Bitly

The invite link looks like `https://michelmoser.github.io/wichtel/?g=familie-moser-weihnachten-2026-k7q2`.

To shorten it:

1. Create a free link at <https://bitly.com>. The free plan has a few links per month, which is plenty for this.
2. Optionally set a custom ending such as `bit.ly/moser-wichteln`.
3. In the site's **Organisation** panel, open *Kurzen Link verwenden (Bitly)* and paste the short link. WhatsApp messages from the site then use it.

## Run locally

```sh
python -m http.server 8000
# open http://localhost:8000
```

The site needs `http://localhost` or `https` because the browser's encryption API isn't available on plain `file://`.
