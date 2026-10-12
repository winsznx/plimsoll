import { registerOTel } from "@vercel/otel";

export async function register(): Promise<void> {
  registerOTel({ serviceName: "plimsoll" });
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RUN_WORKERS === "false") return;
  const { startWorker } = await import("./src/server/worker");
  startWorker();
}
