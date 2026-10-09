import { EventSchemas, Inngest } from "inngest";

type Events = {
  "site/generate.requested": { data: { runId: string; siteId: string; publish?: boolean } };
  "site/edit.requested": { data: { runId: string; siteId: string; instruction: string } };
  "site/publish.requested": { data: { siteId: string } };
  "campaign/plan.requested": { data: { runId: string; campaignId: string } };
  "task/execute.requested": { data: { taskId: string; clientId: string } };
  "task/measure.requested": { data: { taskId: string; checkpointDays: number } };
  "change/decided": { data: { changeSetId: string; decision: "approved" | "rejected"; userId?: string | null } };
  "audit/requested": { data: { clientId: string; runId?: string } };
  "sync/client.requested": { data: { clientId: string } };
  "scan/client.requested": { data: { clientId: string } };
  "report/client.requested": { data: { clientId: string; periodStart: string } };
  "command/requested": { data: { runId: string } };
};

export const inngest = new Inngest({ id: "rankpilot", schemas: new EventSchemas().fromRecord<Events>() });
