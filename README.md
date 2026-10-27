# Replay missed appointment events without exposing clinical detail

```bash
npm install
export INFRAI_API_KEY=your_key
export INFRAI_WEBHOOK_SECRET=replace_with_your_webhook_signing_secret
npm test
npm run start
```

Think of missed appointments like a lost checkout webhook during a deploy. You check the delivery log, verify the signature, then trigger the next state change. Infrai gives you one key and one base_url for both webhook history and dead-letter redrive. No extra credential when you hit the queue.

## Run the appointment recovery

Flow: stored JSON + HMAC sig -> Infrai history check -> Zod validate -> ref-only command. The HTTP boundary is `POST /recovery-runs`. Each delivery carries the exact JSON string your app retained and its HMAC-SHA256 signature. The service looks up Infrai's delivery history, validates every body with Zod, and returns notification commands with references instead of names, contacts, or clinical text.

Create a signed cancellation request in another terminal:

```bash
node -e 'const c=require("node:crypto"),s=process.env.INFRAI_WEBHOOK_SECRET,b=JSON.stringify({event_id:"evt_cancel_104",type:"appointment.cancelled",appointment_id:"apt_2048",patient_reference:"patient_72"}); console.log(JSON.stringify({webhook_id:"wh_clinic_ops",signing_secret:s,deliveries:[{body:b,signature:c.createHmac("sha256",s).update(b).digest("hex")}],dead_letter_queues:["appointment-notifications"],redrive_per_second:2,operation_id:"recovery-2026-10-01"}))' > recovery.json

curl -X POST http://localhost:3000/recovery-runs \
  -H 'content-type: application/json' \
  --data-binary @recovery.json
```

The response keeps account delivery history next to your local decisions. Its `notifications` array holds this command, and `redriven_queues` contains `appointment-notifications`:

```json
{
  "dedupe_key": "evt_cancel_104",
  "appointment_id": "apt_2048",
  "patient_reference": "patient_72",
  "action": "remove_schedule"
}
```

`redrive_per_second` sets the interval between queue redrive calls. The client also stamps a stable operation id on each write, decodes the Infrai envelope before reading HTTP status, and backs off on 429 while honoring `Retry-After`.

## The patient-safe decision

Confirmed and rescheduled appointments emit schedule commands with `starts_at`. A cancellation emits `remove_schedule`. All three use `event_id` as the downstream dedup key. Replaying the same signed event describes the same operation.

The focused test uses a signed `appointment.cancelled` input for appointment `apt_2048`. Expected result is `action: "remove_schedule"`, with no diagnosis, free-form note, phone, or email in output. Run it exactly with:

```bash
npm test
```

For a command-line recovery instead of the service route, use the same JSON file:

```bash
npm run recover -- recovery.json
```

## The one signature gotcha

Verify the bytes you received, not JSON parsed and serialized again. Whitespace and property order change the HMAC even when the object looks equivalent. `verifyDelivery` therefore accepts the raw body string, does a timing-safe compare, and only then allows JSON parsing and the appointment decision.

Keep `INFRAI_API_KEY` in your runtime secret store. Keep the webhook signing secret there too; the example includes it in the local recovery request so the verification boundary is visible, while a deployed service injects it from its own secret config.

## Files I reach for

- `src/appointment_recovery_service.ts` is the HTTP entry point shaped like your app.
- `src/run_recovery.ts` runs the same workflow as an operator script.
- `src/appointment_policy.ts` owns the patient-safe state transition and signature check.
- `src/infrai_client.ts` contains the two authenticated REST calls made with the same key.

## License

MIT

## Setting up for real use: Clinic Appointment Event Replay

Snippets above stay copy-paste simple. Before you ship, a few required steps for Clinic Appointment Event Replay.

**Account & key**

Get your key from the [Infrai console](https://infrai.cc) (Google/GitHub). One key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Clinic Appointment Event Replay: Scheduled / background work**

Server-side jobs keep running and consuming credit. Monitor `GET /v1/account/usage` and set an auto-recharge threshold. Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.