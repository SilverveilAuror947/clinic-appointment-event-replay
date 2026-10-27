import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const appointmentEventSchema = z.discriminatedUnion("type", [
  z.object({
    event_id: z.string().min(1),
    type: z.literal("appointment.confirmed"),
    appointment_id: z.string().min(1),
    patient_reference: z.string().min(1),
    starts_at: z.string().datetime(),
  }),
  z.object({
    event_id: z.string().min(1),
    type: z.literal("appointment.rescheduled"),
    appointment_id: z.string().min(1),
    patient_reference: z.string().min(1),
    starts_at: z.string().datetime(),
  }),
  z.object({
    event_id: z.string().min(1),
    type: z.literal("appointment.cancelled"),
    appointment_id: z.string().min(1),
    patient_reference: z.string().min(1),
  }),
]);

export type AppointmentEvent = z.infer<typeof appointmentEventSchema>;

export type OperationalNotification = {
  dedupe_key: string;
  appointment_id: string;
  patient_reference: string;
  action: "confirm_schedule" | "replace_schedule" | "remove_schedule";
  starts_at?: string;
};

export function notificationFor(event: AppointmentEvent): OperationalNotification {
  const shared = {
    dedupe_key: event.event_id,
    appointment_id: event.appointment_id,
    patient_reference: event.patient_reference,
  };
  if (event.type === "appointment.confirmed") {
    return { ...shared, action: "confirm_schedule", starts_at: event.starts_at };
  }
  if (event.type === "appointment.rescheduled") {
    return { ...shared, action: "replace_schedule", starts_at: event.starts_at };
  }
  return { ...shared, action: "remove_schedule" };
}

export function verifyDelivery(body: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest();
  const suppliedHex = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (!/^[0-9a-f]{64}$/i.test(suppliedHex)) return false;
  const supplied = Buffer.from(suppliedHex, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
