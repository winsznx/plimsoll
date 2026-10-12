interface Env {
  APP_URL: string;
  CRON_SECRET: string;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(env));
  },
} satisfies ExportedHandler<Env>;

async function tick(env: Env): Promise<void> {
  const res = await fetch(new URL("/api/internal/tick", env.APP_URL), {
    method: "POST",
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    signal: AbortSignal.timeout(58_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`tick failed ${res.status}: ${body.slice(0, 300)}`);
  console.log(`tick ${body}`);
}
