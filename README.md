# MichaelStack Telecoms — Backend

This is the backend server that connects your storefront to Paystack (payment
collection) and Gladtidings (data delivery). It's the piece that makes orders
actually happen automatically, instead of you manually funding and sending
data yourself.

## What this does

1. Customer picks a plan on your website and enters their number.
2. Your website calls `POST /api/orders` on this server.
3. This server starts a Paystack payment and returns a checkout link.
4. Customer pays. Paystack notifies this server via webhook.
5. This server verifies the payment, then calls Gladtidings to deliver the
   data — firing multiple calls in sequence for your combo plans (10GB, 15GB,
   20GB, and the 6GB mixed-validity plan).
6. Every order is logged with its profit, so your admin dashboard (coming in
   step 2) can show you real numbers.

## Setup

You'll need [Node.js](https://nodejs.org) installed (version 18+).

```bash
# 1. Install dependencies
npm install

# 2. Copy the environment template and fill in your real secrets
cp .env.example .env
```

Then open `.env` and fill in:

- `PAYSTACK_SECRET_KEY` — from Paystack Dashboard → Settings → API Keys & Webhooks. Use your **test** key while building, switch to **live** once ready.
- `GLADTIDINGS_TOKEN` — from gladtidingsdata.com → Developer's API → "My Authorization Token". **Reset this token before using it here if you've ever shared/pasted it anywhere else.**
- `ADMIN_PASSWORD` — pick a strong password; this protects your `/api/admin/*` routes.
- `PUBLIC_BASE_URL` — while testing locally, use [ngrok](https://ngrok.com) to get a temporary public URL (`ngrok http 3000`). Once deployed, use your real domain.

## Running it

```bash
npm start
```

You should see:
```
MichaelStack Telecoms backend running on port 3000
```

## Wiring up webhooks (important — do this before testing real payments)

1. **Paystack webhook**: Dashboard → Settings → API Keys & Webhooks → set Webhook URL to `https://your-public-url/webhooks/paystack`
2. **Gladtidings webhook**: gladtidingsdata.com → Developer's API → set Webhook URL to `https://your-public-url/webhooks/gladtidings`

Without these, payments will process but your server won't automatically
know to deliver the data — you'd have to check manually.

## Testing safely before going live

1. Use Paystack **test mode** keys first. Paystack provides test card
   numbers in their docs — no real money moves.
2. Send yourself a real order through the full flow once in test mode to
   confirm: payment → webhook received → Gladtidings call fires → order
   marked "delivered" in `data/orders.json`.
3. **Only switch to live keys once that full loop works cleanly.**

## Files

- `server.js` — starts everything
- `config/plans.js` — your pricing + wholesale mapping. Edit this file
  whenever you add/change/remove a plan — nothing else needs to change.
- `lib/paystack.js` — talks to Paystack
- `lib/gladtidings.js` — talks to Gladtidings, handles combo-plan multi-calls
- `lib/db.js` — simple JSON-file order storage (`data/orders.json`)
- `routes/orders.js` — customer-facing order creation
- `routes/webhooks.js` — receives payment + delivery confirmations
- `routes/admin.js` — basic admin data (orders list, profit summary)

## What's deliberately simple (and why)

- **JSON file instead of a real database** — fine at your current order
  volume. If you ever process hundreds of orders a day, this is the one
  piece worth upgrading to a proper database.
- **Sequential (not parallel) combo calls** — mirrors how you'd do it
  manually, and avoids overwhelming Gladtidings' API with simultaneous
  requests for a single customer's order.
- **Partial-delivery detection** — if a combo plan's 2nd or 3rd call fails
  after the 1st succeeded, the order is flagged `needsManualReview: true`
  rather than silently failing. Check `/api/admin/orders` for these.

## Known gaps to close before going fully live

- [ ] Wire up the real admin dashboard UI (step 2 of the roadmap)
- [ ] Add automatic customer refund logic for failed orders (currently just
      flags for manual review — you'd refund via Paystack dashboard manually
      at first)
- [ ] Add low-wallet-balance checking against Gladtidings before attempting
      a delivery, so you're warned before a sale fails
- [ ] Deploy somewhere with a real domain (Railway, Render, or similar)
