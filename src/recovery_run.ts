import { z } from "zod";
import { scheduler } from "node:timers/promises";
import { appointmentEventSchema, notificationFor, verifyDelivery } from "./appointment_policy.js";
import { InfraiClient } from "./infrai_client.js";

const signedDeliverySchema = z.object({
  body: z.string().min(2),
  signature: z.string().min(1),
});

export const recoveryRequestSchema = z.object({
  webhook_id: z.string().min(1),
  signing_secret: z.string().min(16),
  deliveries: z.array(signedDeliverySchema).min(1),
  dead_letter_queues: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)).max(20),
  redrive_per_second: z.number().positive().max(10),
  operation_id: z.string().min(8),
});

export type RecoveryRequest = z.infer<typeof recoveryRequestSchema>;

export async function runRecovery(client: InfraiClient, input: unknown): Promise<{
  delivery_history: unknown;
  notifications: ReturnType<typeof notificationFor>[];
  redriven_queues: string[];
}> {
  const request = recoveryRequestSchema.parse(input);
  const deliveryHistory = await client.webhookDeliveries(request.webhook_id);
  const notifications = request.deliveries.map((delivery) => {
    if (!verifyDelivery(delivery.body, delivery.signature, request.signing_secret)) {
      throw new InvalidSignatureError();
    }
    return notificationFor(appointmentEventSchema.parse(JSON.parse(delivery.body)));
  });

  const intervalMs = 1_000 / request.redrive_per_second;
  for (const [index, queue] of request.dead_letter_queues.entries()) {
    if (index > 0) await scheduler.wait(intervalMs);
    await client.redriveDeadLetters(queue, `${request.operation_id}:${queue}`);
  }

  return {
    delivery_history: deliveryHistory,
    notifications,
    redriven_queues: request.dead_letter_queues,
  };
}

export class InvalidSignatureError extends Error {
  constructor() {
    super("Delivery signature did not match");
  }
}
