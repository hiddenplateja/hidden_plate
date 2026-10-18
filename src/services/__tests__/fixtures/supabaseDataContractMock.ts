import type { SupabaseClient } from "@supabase/supabase-js";
/** Payload/mapping tests ONLY. Race tests must use the real request helpers. */
export function supabaseDataContractMock(client: Pick<SupabaseClient, "rpc" | "from">,
  identity: () => Promise<string | undefined> = async () => "ff000000-0000-4000-8000-000000000001") {
  return {
    requestSupabaseRpc: (...args: unknown[]) => Reflect.apply(client.rpc, client, args),
    rpcForSupabaseDataSession: (_session: unknown, ...args: unknown[]) => Reflect.apply(client.rpc, client, args),
    requireSupabaseDataSession: async () => {
      const userId = await identity();
      if (!userId) throw new Error("You must be signed in.");
      return { userId, accessToken: "fixture-token", client, revision: 0 };
    },
    assertSupabaseDataSession: jest.fn(),
    restForSupabaseDataSession: async (_session: unknown, build: (value: typeof client) => unknown) => build(client),
  };
}
