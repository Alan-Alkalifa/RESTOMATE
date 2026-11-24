import en from "./en.json";
import id from "./id.json";

/** Messages are flat, dotted keys. `en.json` is the source of truth; `id.json` must have the same keys (tested). */
export type Messages = Record<keyof typeof en, string>;
export type MessageKey = keyof Messages;

export const messages = { en, id } satisfies Record<string, Messages>;
