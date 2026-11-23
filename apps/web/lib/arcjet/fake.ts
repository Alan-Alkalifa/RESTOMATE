// Test double for "@arcjet/next": evaluates the rules our code builds, in memory.
// Not imported by app code.
type Rule = { kind: string; opts: Record<string, unknown> };
export type FakeRequest = { ip: string; ua?: string; headers?: Headers };

const counts = new Map<string, number>();
export const calls: { props: Record<string, unknown> }[] = [];
export const state = { failure: false, key: "k" };
export const resetFake = () => {
  counts.clear();
  calls.length = 0;
  state.failure = false;
};

const DISPOSABLE = new Set(["mailinator.com", "tempmail.test"]);

function make(rules: Rule[]) {
  return {
    withRule: (r: Rule[] | Rule) => make([...rules, ...(Array.isArray(r) ? r : [r])]),
    rules,
    protect: async (req0: FakeRequest, props: Record<string, unknown> = {}) => {
      // A NextRequest (proxy tests) names its bot in a header; auth tests pass { ip, ua }.
      const isNext = typeof req0.headers?.get === "function";
      const req = {
        ip: req0.ip,
        ua: isNext ? (req0.headers?.get("x-test-bot") ?? undefined) : req0.ua,
      };
      calls.push({ props });
      if (state.failure) return decision({ errored: true });
      for (const r of rules) {
        if (r.kind === "bot") {
          const allow = r.opts.allow as string[];
          const isBot = !!req.ua && req.ua !== "browser";
          if (isBot && !allow.includes(req.ua as string)) return decision({ denied: "bot" });
        }
        if (r.kind === "rate") {
          const chars = (r.opts.characteristics as string[] | undefined) ?? ["ip.src"];
          const id = chars.map((c) => (c === "ip.src" ? req.ip : String(props[c]))).join("|");
          const k = `${JSON.stringify([r.opts.max, r.opts.interval, chars])}#${id}`;
          const n = (counts.get(k) ?? 0) + 1;
          counts.set(k, n);
          if (n > (r.opts.max as number)) return decision({ denied: "rate" });
        }
        if (r.kind === "email") {
          const email = String(props.email ?? "");
          const domain = email.split("@")[1] ?? "";
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || DISPOSABLE.has(domain))
            return decision({ denied: "email" });
        }
      }
      return decision({});
    },
  };
}

function decision(o: { errored?: boolean; denied?: string }) {
  return {
    isErrored: () => !!o.errored,
    isDenied: () => !!o.denied,
    reason: {
      isBot: () => o.denied === "bot",
      isShield: () => o.denied === "shield",
      isRateLimit: () => o.denied === "rate",
      isEmail: () => o.denied === "email",
    },
  };
}

export const fakeModule = {
  default: (opts: { rules: Rule[][] }) => make(opts.rules.flat()),
  shield: (opts: object) => [{ kind: "shield", opts }],
  detectBot: (opts: object) => [{ kind: "bot", opts }],
  slidingWindow: (opts: object) => [{ kind: "rate", opts }],
  validateEmail: (opts: object) => [{ kind: "email", opts }],
  request: async () => ({ ip: "9.9.9.9" }),
};
