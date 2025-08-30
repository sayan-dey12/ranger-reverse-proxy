"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workerMessageResponseSchema = exports.workerMessageSchema = void 0;
const zod_1 = require("zod");
exports.workerMessageSchema = zod_1.z.object({
    requestType: zod_1.z.enum(["HTTP"]),
    headers: zod_1.z.any(),
    body: zod_1.z.any(),
    url: zod_1.z.string(),
    requestId: zod_1.z.string(), // new
});
exports.workerMessageResponseSchema = zod_1.z.object({
    requestId: zod_1.z.string().optional(), // echo back
    data: zod_1.z.any().optional(),
    error: zod_1.z.string().optional(),
    errorCode: zod_1.z.enum(["500", "404"]).optional(),
});
