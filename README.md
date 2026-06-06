# Irrigation System

Raspberry Pi automated irrigation system with a web dashboard.

## Commands

```bash
npm run go      # production — starts irrigation + dashboard at http://<rpi-ip>:3000
npm run dev     # local dev — mock data, no hardware required
npm test        # hardware diagnostics (✓/⚠/✗ per component)
npm run sensor  # live sensor/pump debug — wet sensor activates its pump
```

## Discord notifications

The system sends a Discord message when a safety sensor detects water on the floor.

### 1. Create a webhook

1. Open Discord → select (or create) a server
2. Click the gear icon on a channel → **Integrations** → **Webhooks** → **New Webhook**
3. Name it (e.g. "Irrigation") → click **Copy Webhook URL**

> **Tip:** For private notifications create a server just for yourself:
> Discord → **+** → **Create My Own** → **For me and my friends**.
> You are the only member, so notifications behave like DMs.

### 2. Set the environment variable on the Raspberry Pi

```bash
sudo systemctl edit irrigation
```

Add between the first two comment lines (the empty area):

```ini
[Service]
Environment=DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL
```

Save, then reload and restart the service:

```bash
sudo systemctl daemon-reload
sudo systemctl restart irrigation
```

Verify the variable is loaded:

```bash
sudo systemctl show irrigation | grep DISCORD
```

If `DISCORD_WEBHOOK_URL` is not set, notifications are silently skipped — the system runs normally.

### 3. Test the notification

Run on the Raspberry Pi (the service must be restarted first so the variable is loaded):

```bash
curl -X POST "$DISCORD_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content": "✅ Test notifikace z irrigation systému"}'
```

A successful response looks like `{"id":"..."}`. An error means the URL is wrong or the variable is not set.
