import { inngest } from "../client";
import { LLM_CONCURRENCY, failRun, rethrow } from "./shared";
import { runCommand } from "@/lib/agents/orchestrator";
import { runLogger, setRunStatus } from "@/lib/runs";
import { adminClient } from "@/lib/supabase/admin";

export const commandFn = inngest.createFunction(
  {
    id: "command",
    name: "Natural-language command",
    retries: 0, // commands can start side effects; never replay them blindly
    concurrency: [LLM_CONCURRENCY],
    onFailure: async ({ event, error }) => failRun(event.data.event.data.runId, error),
  },
  { event: "command/requested" },
  async ({ event, step }) =>
    step.run("run", async () => {
      const { runId } = event.data;
      const { data: run } = await adminClient().from("runs").select("prompt, client_id, created_by").eq("id", runId).single();
      if (!run?.prompt) throw new Error("Command run has no prompt");
      await setRunStatus(runId, "running");
      try {
        const out = await runCommand(await runLogger(runId), run.prompt as string, (run.client_id as string | null) ?? null, (run.created_by as string | null) ?? null);
        await setRunStatus(runId, "succeeded", { output: out });
        return out;
      } catch (err) {
        await failRun(runId, err);
        rethrow(err);
      }
    }),
);
