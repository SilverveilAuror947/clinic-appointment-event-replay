import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { appointmentEventSchema, notificationFor, verifyDelivery } from "./appointment_policy.js";

test("a signed cancellation removes the schedule without clinical details", () => {
  const body = JSON.stringify({
    event_id: "evt_cancel_104",
    type: "appointment.cancelled",
    appointment_id: "apt_2048",
    patient_reference: "patient_72",
  });
  const secret = "local-test-signing-secret";
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(verifyDelivery(body, signature, secret), true);
  assert.equal(verifyDelivery(`${body} `, signature, secret), false);
  assert.deepEqual(notificationFor(appointmentEventSchema.parse(JSON.parse(body))), {
    dedupe_key: "evt_cancel_104",
    appointment_id: "apt_2048",
    patient_reference: "patient_72",
    action: "remove_schedule",
  });
});
