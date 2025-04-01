// /home/zodx/Desktop/trapigram/src/lib/plugins/subscription-client-plugin.ts
import { BetterAuthClientPlugin } from "better-auth/client";
import { subscriptionPlugin } from "./subscription-plugin";

export const subscriptionClientPlugin = {
  id: "subscription",
  getActions: ($fetch) => {
    return {
      createSubscription: async (
        data: { userId: string; plan: string },
        fetchOptions?
      ) => {
        return $fetch("/subscription/create", {
          method: "POST",
          body: data,
          ...fetchOptions,
        });
      },
      // Force a GET call by not accepting a data argument, instead passing query in fetchOptions.
      status: async (
        _unused: void,
        fetchOptions?: { query: { userId: string } }
      ) => {
        const { query } = fetchOptions || {};
        if (!query || !query.userId) {
          throw new Error("userId must be provided in fetchOptions.query");
        }
        // Manually build the URL to include the query parameter.
        const url = `/subscription/status?userId=${encodeURIComponent(query.userId)}`;
        // Ensure we don't pass any 'query' or 'body' options so that GET is maintained.
        return $fetch(url, { method: "GET", ...fetchOptions, query: undefined, body: undefined });
      },
    };
  },
} satisfies BetterAuthClientPlugin;
