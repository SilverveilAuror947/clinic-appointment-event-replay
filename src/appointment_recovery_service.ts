import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiError, infraiFromEnvironment } from "./infrai_client.js";
import { InvalidSignatureError, runRecovery } from "./recovery_run.js";

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const client = infraiFromEnvironment();
const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/recovery-runs") {
    json(response, 404, { error: "route_not_found" });
    return;
  }
  try {
    json(response, 200, await runRecovery(client, await readJson(request)));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      json(response, 400, { error: "invalid_request" });
    } else if (error instanceof InvalidSignatureError) {
      json(response, 401, { error: "invalid_signature" });
    } else if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      json(response, status, { error: error.code, detail: error.detail });
    } else {
      json(response, 502, { error: "recovery_failed" });
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`appointment recovery listening on http://localhost:${port}`));
