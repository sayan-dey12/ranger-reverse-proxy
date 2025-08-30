"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const node_cluster_1 = __importDefault(require("node:cluster"));
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const node_url_1 = require("node:url");
const config_schema_1 = require("./config-schema");
const server_schema_1 = require("./server-schema");
const roundRobinCounter = {}; // per-rule counter
function createServer(config) {
    return __awaiter(this, void 0, void 0, function* () {
        const { workerCount, port } = config;
        const WORKER_POOL = [];
        if (node_cluster_1.default.isPrimary) {
            console.log("Master process is up...");
            for (let i = 0; i < workerCount; i++) {
                const w = node_cluster_1.default.fork({ config: JSON.stringify(config.config) });
                WORKER_POOL.push(w);
                console.log(`Master Process : Worker process spinned up ${i}`);
            }
            const server = node_http_1.default.createServer((req, res) => {
                const index = Math.floor(Math.random() * WORKER_POOL.length);
                const worker = WORKER_POOL[index];
                if (!worker)
                    throw new Error("Worker not found");
                const requestId = `${Date.now()}-${Math.random()}`;
                const payload = {
                    requestType: "HTTP",
                    headers: req.headers,
                    body: null,
                    url: `${req.url}`,
                    requestId,
                };
                worker.send(JSON.stringify(payload));
                worker.once("message", (replyString) => __awaiter(this, void 0, void 0, function* () {
                    try {
                        const reply = yield server_schema_1.workerMessageResponseSchema.parseAsync(JSON.parse(replyString));
                        if (reply.requestId !== requestId)
                            return; // ignore mismatched replies
                        if (reply.errorCode) {
                            res.writeHead(parseInt(reply.errorCode));
                            res.end(reply.error);
                        }
                        else {
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(reply.data);
                        }
                    }
                    catch (err) {
                        res.writeHead(500);
                        res.end("Invalid worker response");
                    }
                }));
            });
            server.listen(config.port, () => {
                console.log(`Ranger reverse proxy is listening on PORT : ${config.port}`);
            });
        }
        else {
            console.log("Worker process...", JSON.stringify(process.env.config));
            const config = yield config_schema_1.configSchema.parseAsync(JSON.parse(process.env.config || "{}"));
            process.on("message", (message) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c, _d;
                try {
                    const messageValidated = yield server_schema_1.workerMessageSchema.parseAsync(JSON.parse(message));
                    const { url: requestURL, requestId } = messageValidated;
                    const rule = config.server.rules.find((e) => requestURL.startsWith(e.path));
                    if (!rule) {
                        const reply = {
                            requestId,
                            errorCode: "404",
                            error: "rule not found",
                        };
                        return (_a = process.send) === null || _a === void 0 ? void 0 : _a.call(process, JSON.stringify(reply));
                    }
                    // pick upstream using round-robin
                    const counter = (roundRobinCounter[rule.path] =
                        (roundRobinCounter[rule.path] || 0) + 1);
                    const upstreamId = rule.upstreams[counter % rule.upstreams.length];
                    const upstream = config.server.upstreams.find((u) => u.id === upstreamId);
                    if (!upstream) {
                        const reply = {
                            requestId,
                            errorCode: "500",
                            error: "Upstream not found",
                        };
                        return (_b = process.send) === null || _b === void 0 ? void 0 : _b.call(process, JSON.stringify(reply));
                    }
                    const targetUrl = new node_url_1.URL(upstream.url.startsWith("http")
                        ? upstream.url
                        : `http://${upstream.url}`);
                    const proxyModule = targetUrl.protocol === "https:" ? node_https_1.default : node_http_1.default;
                    const headers = {};
                    (_c = config.server.headers) === null || _c === void 0 ? void 0 : _c.forEach((h) => {
                        headers[h.key] = h.value.replace("$ip", messageValidated.headers["x-forwarded-for"] ||
                            "unknown");
                    });
                    const proxyReq = proxyModule.request({
                        hostname: targetUrl.hostname,
                        port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
                        path: requestURL,
                        method: "GET",
                        headers,
                    }, (proxyRes) => {
                        let body = "";
                        proxyRes.on("data", (chunk) => {
                            body += chunk;
                        });
                        proxyRes.on("end", () => {
                            var _a;
                            const reply = {
                                requestId,
                                data: body,
                            };
                            (_a = process.send) === null || _a === void 0 ? void 0 : _a.call(process, JSON.stringify(reply));
                        });
                    });
                    proxyReq.on("error", (err) => {
                        var _a;
                        const reply = {
                            requestId,
                            errorCode: "500",
                            error: "Upstream request failed: " + err.message,
                        };
                        (_a = process.send) === null || _a === void 0 ? void 0 : _a.call(process, JSON.stringify(reply));
                    });
                    proxyReq.end();
                }
                catch (err) {
                    const reply = {
                        errorCode: "500",
                        error: "Worker error: " + err.message,
                    };
                    (_d = process.send) === null || _d === void 0 ? void 0 : _d.call(process, JSON.stringify(reply));
                }
            }));
        }
    });
}
