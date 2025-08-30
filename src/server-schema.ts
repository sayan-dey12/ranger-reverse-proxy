import { z } from 'zod';


export const workerMessageSchema = z.object({
  requestType: z.enum(["HTTP"]),
  headers: z.any(),
  body: z.any(),
  url: z.string(),
  requestId: z.string(),   // new
});

export const workerMessageResponseSchema = z.object({
  requestId: z.string().optional(), // echo back
  data: z.any().optional(),
  error: z.string().optional(),
  errorCode: z.enum(["500", "404"]).optional(),
});


export type workerMessageType = z.infer<typeof workerMessageSchema>;
export type workerMessageResponseType = z.infer<typeof workerMessageResponseSchema>;