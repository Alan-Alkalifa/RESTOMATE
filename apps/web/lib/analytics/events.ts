/**
 * Every product event and its properties. A value is one of a closed list, never free text: that is
 * what keeps names, emails and tokens out. Add a new event or property here first.
 */
export const EVENTS = {
  signup_completed: { locale: ["en", "id"] },
  organization_created: {},
  member_invited: { role: ["owner", "manager", "cashier", "waiter", "kitchen", "custom"] },
} as const;

export type EventName = keyof typeof EVENTS;

export type EventProperties<E extends EventName> = {
  [P in keyof (typeof EVENTS)[E]]: (typeof EVENTS)[E][P] extends readonly (infer V)[] ? V : never;
};

/** The properties argument exists only for events that have properties. */
export type EventArgs<E extends EventName> = keyof (typeof EVENTS)[E] extends never
  ? []
  : [properties: EventProperties<E>];
