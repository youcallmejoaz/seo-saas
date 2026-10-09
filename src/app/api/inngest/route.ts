import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Long AI steps: allow the maximum serverless duration on Vercel.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
