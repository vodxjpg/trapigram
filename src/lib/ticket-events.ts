/* A singleton that keeps one Set of listeners per ticket-id.
   Each listener is a `(payload: unknown) => void` fn            */

   type Listener = (data: unknown) => void;
   const channels: Record<string, Set<Listener>> = {};
   
   export function on(ticketId: string, fn: Listener) {
     channels[ticketId] ??= new Set();
     channels[ticketId].add(fn);
     return () => channels[ticketId].delete(fn);          // unsubscribe helper
   }
   
   export function emit(ticketId: string, data: unknown) {
     channels[ticketId]?.forEach((fn) => fn(data));
   }
   