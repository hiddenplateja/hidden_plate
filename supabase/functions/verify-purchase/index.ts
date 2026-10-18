import { withSupabase } from "npm:@supabase/server@1.9.0";
import { handlePurchaseVerification } from "../_shared/purchaseEndpoint.ts";
import { purchaseEndpointDependencies, type PurchaseContextClients } from "../_shared/purchaseContext.ts";

// LOCAL ONLY until separately approved for deployment. Both this server switch
// and the private DB settings must be enabled; neither is configured by default.
Deno.serve(withSupabase({ auth: "user" }, async (req, ctx) => handlePurchaseVerification(req,
  // Narrow SDK's generic builders to the tested subset; avoids recursive
  // PostgREST type expansion without weakening the caller/row filters.
  purchaseEndpointDependencies(ctx as unknown as PurchaseContextClients, key => Deno.env.get(key), fetch))));
