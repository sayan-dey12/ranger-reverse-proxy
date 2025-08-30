import cluster, { Worker } from "node:cluster";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { Config, configSchema } from "./config-schema";
import {
  workerMessageType,
  workerMessageSchema,
  workerMessageResponseType,
  workerMessageResponseSchema,
} from "./server-schema";

const roundRobinCounter: Record<string, number> = {}; // per-rule counter

export async function createServer(config: {
  port: number;
  workerCount: number;
  config: Config;
}) {
  const { workerCount, port } = config;
  const WORKER_POOL: Worker[] = [];

  if (cluster.isPrimary) {
    console.log("Master process is up...");
    for (let i = 0; i < workerCount; i++) {
      const w = cluster.fork({ config: JSON.stringify(config.config) });
      WORKER_POOL.push(w);
      console.log(`Master Process : Worker process spinned up ${i}`);
    }

    const server = http.createServer((req, res) => {
      const index = Math.floor(Math.random() * WORKER_POOL.length);
      const worker = WORKER_POOL[index];
      if (!worker) throw new Error("Worker not found");

      const requestId = `${Date.now()}-${Math.random()}`;
      const payload: workerMessageType = {
        requestType: "HTTP",
        headers: req.headers,
        body: null,
        url: `${req.url}`,
        requestId,
      };

      worker.send(JSON.stringify(payload));

      worker.once("message", async (replyString: string) => {
        try {
          const reply = await workerMessageResponseSchema.parseAsync(
            JSON.parse(replyString)
          );
          if (reply.requestId !== requestId) return; // ignore mismatched replies

          if (reply.errorCode) {
            res.writeHead(parseInt(reply.errorCode));
            res.end(reply.error);
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(reply.data);
          }
        } catch (err) {
          res.writeHead(500);
          res.end("Invalid worker response");
        }
      });
    });

    server.listen(config.port, () => {
      console.log(
        `Ranger reverse proxy is listening on PORT : ${config.port}`
      );
    });
  } else {
    console.log("Worker process...", JSON.stringify(process.env.config));
    const config = await configSchema.parseAsync(
      JSON.parse(process.env.config || "{}")
    );

    process.on("message", async (message: string) => {
      try {
        const messageValidated = await workerMessageSchema.parseAsync(
          JSON.parse(message)
        );
        const { url: requestURL, requestId } = messageValidated;

        const rule = config.server.rules.find((e) =>
          requestURL.startsWith(e.path)
        );
        if (!rule) {
          const reply: workerMessageResponseType = {
            requestId,
            errorCode: "404",
            error: "rule not found",
          };
          return process.send?.(JSON.stringify(reply));
        }

        // pick upstream using round-robin
        const counter = (roundRobinCounter[rule.path] =
          (roundRobinCounter[rule.path] || 0) + 1);
        const upstreamId =
          rule.upstreams[counter % rule.upstreams.length];
        const upstream = config.server.upstreams.find(
          (u) => u.id === upstreamId
        );

        if (!upstream) {
          const reply: workerMessageResponseType = {
            requestId,
            errorCode: "500",
            error: "Upstream not found",
          };
          return process.send?.(JSON.stringify(reply));
        }

        const targetUrl = new URL(
          upstream.url.startsWith("http")
            ? upstream.url
            : `http://${upstream.url}`
        );

        const proxyModule = targetUrl.protocol === "https:" ? https : http;

        const headers: Record<string, string> = {};
        config.server.headers?.forEach((h) => {
          headers[h.key] = h.value.replace(
            "$ip",
            messageValidated.headers["x-forwarded-for"] ||
              "unknown"
          );
        });

        const proxyReq = proxyModule.request(
          {
            hostname: targetUrl.hostname,
            port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
            path: requestURL,
            method: "GET",
            headers,
          },
          (proxyRes) => {
            let body = "";
            proxyRes.on("data", (chunk) => {
              body += chunk;
            });
            proxyRes.on("end", () => {
              const reply: workerMessageResponseType = {
                requestId,
                data: body,
              };
              process.send?.(JSON.stringify(reply));
            });
          }
        );

        proxyReq.on("error", (err) => {
          const reply: workerMessageResponseType = {
            requestId,
            errorCode: "500",
            error: "Upstream request failed: " + err.message,
          };
          process.send?.(JSON.stringify(reply));
        });

        proxyReq.end();
      } catch (err) {
        const reply: workerMessageResponseType = {
          errorCode: "500",
          error: "Worker error: " + (err as Error).message,
        };
        process.send?.(JSON.stringify(reply));
      }
    });
  }
}
