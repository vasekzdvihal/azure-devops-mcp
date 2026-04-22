import { z } from "zod";

export const ConfigSchema = z.object({
  baseUrl: z.string().url(),
  kind: z.enum(["server", "services"]),
  caBundlePath: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
