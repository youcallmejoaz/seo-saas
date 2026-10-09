import Stripe from "stripe";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";

// Keeps `subscriptions` in sync with Stripe. Subscriptions must carry
// metadata.client_id (set it when creating the checkout session / subscription).
export async function POST(req: Request) {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = env();
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) return NextResponse.json({ error: "stripe not configured" }, { status: 501 });
  const stripe = new Stripe(STRIPE_SECRET_KEY);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") ?? "", STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as Stripe.Subscription;
    const clientId = sub.metadata?.client_id;
    if (clientId) {
      const mrr = sub.items.data.reduce((sum, item) => {
        const price = item.price;
        const amount = (price.unit_amount ?? 0) * (item.quantity ?? 1);
        const interval = price.recurring?.interval;
        const count = price.recurring?.interval_count ?? 1;
        const monthly = interval === "year" ? amount / (12 * count) : interval === "week" ? (amount * 52) / (12 * count) : interval === "day" ? (amount * 365) / (12 * count) : amount / count;
        return sum + monthly;
      }, 0);
      const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items.data[0]?.current_period_end;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;
      await adminClient()
        .from("subscriptions")
        .upsert(
          {
            client_id: clientId,
            stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
            stripe_subscription_id: sub.id,
            status: ["trialing", "active", "past_due", "canceled", "unpaid", "incomplete"].includes(status) ? status : "none",
            mrr_cents: Math.round(mrr),
            current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "client_id" },
        );
    }
  }
  return NextResponse.json({ received: true });
}
