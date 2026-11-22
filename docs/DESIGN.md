# DESIGN.md — Restomate design system

> **How to use this file.** Read this before building or changing any UI.
> - **What** we build → `PROJECT.md`
> - **How** we build it (stack, rules) → `CLAUDE.md`
> - **Order of work** → `PLAN.md`
> - **How it looks and feels** → this file
>
> When the code and this file disagree, raise it with ALAN. Fix one or the other; don't let them drift.

Last updated: 2026-11-22

---

## 1. Direction

| Decision | Choice |
|---|---|
| Colour split (60-30-10) | **Dominant 60 · Secondary 30 · Accent 10**. Current preset: Snow · Cobalt · Lime (change it in §2.6) |
| Style | **Soft and friendly**: rounded corners, soft shadows, generous spacing, warm and approachable for restaurant staff |
| Theme modes | **Light only**, on every surface including the kitchen display |
| Typeface | **Plus Jakarta Sans** (designed in Indonesia), one family for headings and UI |

**Personality:** calm, clear and friendly. A cashier on a busy Friday night should never have to hunt for a button or squint at a price. Restomate should feel like a helpful colleague, not enterprise software.

**Restomate rules of thumb**
- **Speed beats decoration.** On POS and KDS, every extra pixel of ornament costs time during service. Soft does not mean slow.
- **The restaurant's brand comes first on the customer site.** Restomate's palette is the default there, never a constraint.

### 1.1 UI principles

UI is the visual and interactive layer: colour, type, buttons, layout.

**1. Visual hierarchy**: guide the eye to the most important thing first, using size, weight, contrast and spacing.
- Each screen has **one** primary goal and **one** spotlight (accent) action (§2.5). Less important actions step down to primary, soft, outline or ghost buttons (§6.1).
- Hierarchy comes from the type scale (§3), not from colour. Page title `h1`, sections `h2`, cards `h3`. Never skip more than one step.
- The most important number is the biggest: the cart total on POS, the timer on a KDS ticket, the amount due on a bill.
- Group related things with spacing first (§4.3), borders second, and colour last.

**2. Consistency**: the same thing always looks and behaves the same, on every surface.
- Build every screen from `components/ui/` (§6). One button style per variant, one status badge per status (§6.4), one icon set (Lucide, §5).
- Colours carry fixed meanings: secondary means action or selection, accent means "look here first", and status colours mean state. These meanings never swap.
- Positions are fixed: the primary action is the last button bottom-right in dialogs; navigation lives in the sidebar; page actions sit top-right of the page header; destructive actions are never the default.
- The same word for the same thing everywhere ("bill", not sometimes "check" or "invoice").

**3. Clarity and simplicity**: remove clutter, keep text readable, never overwhelm.
- Show only what the current role and task need. Permissions already hide what a user can't do; also hide what they don't need right now (advanced settings collapse under "More options").
- At most 5–7 choices in a group. Longer lists get search, categories or progressive disclosure.
- Body text never smaller than 14 px (12 px only for captions and badges), lines no longer than 75 characters, and plain-language labels (§8).
- Empty space is a feature. Don't fill a screen because there's room.

**4. Feedback**: every interaction gets an immediate, visible response.
- Every control has hover (desktop), pressed (`scale(0.98)`, darker fill), focus, disabled and loading states (§6.1, §6.2).
- Respond within **100 ms**. Anything slower shows a loading state in the button that started it; anything over 1 s shows a skeleton or progress (§6.8).
- Successful actions confirm with a toast or an inline change ("Sent to kitchen ✓"). Failures explain what to do next (§8).
- Optimistic updates are fine for low-risk actions (marking an item ready on KDS), but roll back visibly if the server refuses.
- Haptic feedback is not available on the web, so touch surfaces rely on clear pressed states and short motion instead (§4.5).

**5. Accessibility (WCAG 2.1 AA)**: usable by everyone, including people with vision, motor or cognitive impairments.
- Contrast pairs in §2.4 are pre-checked; status never relies on colour alone (§6.4).
- Generous targets (§4.4), full keyboard support, visible focus rings, labelled fields and screen-reader names for icon buttons (§9).
- Respect reduced motion, support 200% zoom, and keep language simple for cognitive accessibility.

### 1.2 UX principles

UX is the whole experience: flows, problem-solving and how smoothly someone reaches their goal.

**1. User-centricity**: design from real restaurant work, not from our assumptions.
- Our users are a cashier with a queue, a waiter carrying plates, a cook with wet hands, an owner checking numbers at night, and a guest on a phone with weak signal. Design for their context, not for a designer at a desk.
- Before building a major flow (POS, KDS, floor plan, storefront checkout), **watch at least one real service** or talk to restaurant staff, and write down the pain points in the task.
- Test on the real devices: a 10" tablet for POS, a wall-mounted or counter screen for KDS, a mid-range Android phone on 4G for the storefront.
- Measure with PostHog funnels (explicit events only, no personal data): time from signup to first order, POS time per order, storefront checkout drop-off.

**2. Visibility of system status**: always show what the system is doing.
- Order, ticket, table and payment states are always visible as badges (§6.4) and update in real time.
- Connection state is always visible on POS, KDS and the live board (offline bar, §6.8).
- Multi-step flows (onboarding, storefront checkout, split bill) show a step indicator: "Step 2 of 3".
- Long actions show progress: image and file uploads show a progress bar; DOKU checkout returns to a "Confirming your payment…" screen until the notification arrives.
- Saving is never silent: "Saving…" → "Saved" on editors such as the menu and floor plan.

**3. Error prevention and recovery**: make mistakes hard, and recovery easy.
- **Prevent:** disable "Add" until required modifiers are chosen; disable "Charge" until the amount is valid; block sold-out items; validate fields inline as the user leaves them (Zod, same schema as the server); use pickers instead of free text for dates, times, tables and money.
- **Confirm only what's destructive or costly:** void, cancel order, refund, suspend tenant, archive package. Name the thing in the dialog ("Void 2 × Nasi Goreng?"). Don't confirm routine actions; that trains people to click "Yes" without reading.
- **Recover:** error messages say what happened and what to do, keep the user's input, and offer "Try again" (§6.8, §8). A failed save never clears a form. A lost connection never loses a cart.

**4. User control and freedom**: there's always a clear way out.
- Every modal, sheet and flow has **Cancel / Back / Close**, and `Esc` closes overlays on desktop.
- **Undo instead of confirm** for low-risk actions: removing a cart line, deleting a draft menu item or moving a table shows an "Undo" toast for 5 seconds.
- Actions that can't be undone (an item already sent to the kitchen, a recorded payment) offer a clear follow-up path instead: void with a reason, or refund.
- Multi-step flows keep earlier answers when the user goes back, and onboarding can be left and resumed.
- Filters, tabs and the selected location are kept in the URL, so the browser's Back button works as expected.

---

## 2. Colour

### 2.1 The 60-30-10 split

| Share | Role | Current preset | Where it shows up |
|---|---|---|---|
| **60%** | **Dominant** (`dominant-*`) | Snow: cool white and neutral greys | The canvas: page backgrounds, cards, tables, inputs, POS item grid, KDS board |
| **30%** | **Secondary** (`secondary-*`) | Cobalt blue | Brand and structure: sidebar, headers, buttons, links, selected tabs and rows, soft panels, focus rings, charts |
| **10%** | **Accent** (`accent-*`) | Acid lime | Spotlight: the most important action on a screen, active-nav indicator, "new" markers, progress highlights |

How to apply the split:
- The shares are targets for visual area on a typical screen, not a count of components.
- Every shade of a role counts toward that role, so a soft `secondary-50` panel is part of the 30.
- 10 is a ceiling for accent. Give any space it doesn't use back to dominant; never add accent to fill a quota.
- Status colours, photos and print are outside the split. The super admin's dark sidebar counts toward the 30.
- On the customer site, the restaurant's brand colours take the 30 and the 10.

> **`primary` is not the 60.** The 60 is `dominant`. The `primary` token means "main action" and takes its colour from `secondary` (the 30).

> **Why a cool snow in the current preset?** Classic "snow" (#FFFAFA) is faintly pink and looks dirty next to cobalt. Restomate's snow is tinted very slightly blue so the whole palette stays in one temperature.

### 2.2 Palette (current preset)

These are the raw colours. Only the theme map (§2.6) refers to them by name; everything else uses roles or semantic tokens.

**Cobalt** (brand anchor: `cobalt-600` = `#0047AB`)

| Token | Hex | Use |
|---|---|---|
| `cobalt-50` | `#EEF3FC` | Soft fills: selected rows, info badges, hover on ghost buttons |
| `cobalt-100` | `#DCE7F9` | Pressed soft fills, chart backgrounds |
| `cobalt-200` | `#B9CEF2` | Muted text on the cobalt sidebar, light chart series |
| `cobalt-300` | `#8AADE6` | Decorative, illustrations, chart series |
| `cobalt-400` | `#5384D6` | Decorative, illustrations |
| `cobalt-500` | `#1F5FC4` | Secondary chart series |
| **`cobalt-600`** | **`#0047AB`** | **Primary buttons, links, focus ring, brand** |
| `cobalt-700` | `#003A8E` | Primary hover, text on cobalt-50 |
| `cobalt-800` | `#002F73` | Primary pressed, **sidebar background** |
| `cobalt-900` | `#06265A` | Deep accents |

**Snow** (neutrals, the 60%)

| Token | Hex | Use |
|---|---|---|
| `snow-0` | `#FFFFFF` | Cards, inputs, modals, POS item tiles, KDS tickets |
| **`snow-50`** | **`#F8FAFD`** | **Page background** |
| `snow-100` | `#F0F3F9` | Muted surfaces, table header rows, skeletons |
| `snow-200` | `#E2E7F0` | Card and divider borders (decorative) |
| `snow-300` | `#CBD3E1` | Disabled borders, subtle separators |
| `snow-400` | `#808BA2` | **Input and control borders** (meets 3:1) |
| `snow-500` | `#626E87` | Muted text: hints, timestamps, placeholders |
| `snow-600` | `#525D74` | Secondary text |
| `snow-700` | `#3A4459` | Strong secondary text |
| **`ink`** | **`#0F1B3D`** | **Body text and headings.** A cobalt-tinted near-black, never pure `#000` |

**Lime** (the 10%)

| Token | Hex | Use |
|---|---|---|
| `lime-100` | `#F2FDD0` | Soft highlight fill ("New" chip background) |
| `lime-200` | `#E4FB9E` | Highlighter underline on marketing headlines |
| `lime-300` | `#D2F766` | Spotlight button hover |
| **`lime-400`** | **`#C0F03A`** | **Spotlight button, active-nav indicator, focus ring on cobalt** |
| `lime-500` | `#A6DB12` | Spotlight button pressed |
| `lime-700` | `#4F6B05` | Text on `lime-100` (the only lime used as text on light backgrounds) |

**Semantic status colours.** These are separate from the brand palette so that lime never means "success".

| Token | Hex | Use |
|---|---|---|
| `success-50` / `success-600` / `success-700` | `#E9F7EF` / `#15803D` / `#166534` | Paid, ready, available, saved |
| `warning-50` / `warning-500` / `warning-700` | `#FEF6E7` / `#E89B0C` / `#9A5B00` | Partially paid, preparing, KDS amber, offline |
| `danger-50` / `danger-600` / `danger-700` | `#FDECEC` / `#C62828` / `#A11D1D` | Errors, voids, cancelled, KDS red, destructive actions |
| Info | uses `cobalt-50` / `cobalt-700` | Neutral information, reserved |

### 2.3 Semantic tokens

Components use **semantic tokens**. They point at theme roles, never at a named colour, so this table stays the same when the theme changes.

| Token | Value | Meaning |
|---|---|---|
| `bg` | `dominant-50` | Page background |
| `surface` | `dominant-0` | Cards, inputs, modals |
| `surface-muted` | `dominant-100` | Table headers, quiet panels, skeletons |
| `border` | `dominant-200` | Card and divider borders |
| `border-control` | `dominant-400` | Inputs, checkboxes, selects |
| `text` | `dominant-900` | Default text |
| `text-secondary` | `dominant-600` | Supporting text |
| `text-muted` | `dominant-500` | Hints, placeholders, timestamps |
| `primary` / `primary-hover` / `primary-pressed` | `secondary-600` / `700` / `800` | Main actions |
| `primary-soft` | `secondary-50` | Selected, soft buttons, info |
| `on-primary` | `on-secondary` | Text and icons on secondary |
| `accent` / `accent-hover` / `accent-pressed` | `accent-400` / `accent-300` / `accent-500` | Spotlight action |
| `on-accent` | `on-accent-fill` | Text and icons on accent (**never white**) |
| `focus` / `focus-inverse` | `secondary-600` / `accent-400` | Focus rings on light / on secondary |
| `nav-bg` / `nav-text` / `nav-muted` / `nav-active` | `secondary-800` / `on-secondary` / `secondary-200` / `accent-400` | Restaurant admin sidebar |

### 2.4 Contrast (verified, WCAG 2.1 AA)

Text needs ≥ 4.5:1, or ≥ 3:1 for large text (18.66 px bold / 24 px regular and up). UI boundaries and graphics need ≥ 3:1.

| Pair | Ratio | Result |
|---|---|---|
| `dominant-900` on `dominant-50` / `dominant-0` | 16.1 / 16.9 | ✅ AAA |
| `dominant-600` on `dominant-50` | 6.3 | ✅ |
| `dominant-500` on `dominant-0` / `dominant-50` / `dominant-100` | 5.1 / 4.9 / 4.6 | ✅ |
| `on-secondary` on `secondary-600` (primary button) | 8.4 | ✅ AAA |
| `secondary-600` link on `dominant-50` | 8.1 | ✅ |
| `secondary-700` on `secondary-50` | 9.5 | ✅ |
| `dominant-900` on `accent-400` (spotlight button) | 12.7 | ✅ AAA |
| `accent-400` on `secondary-800` (sidebar indicator, text) | 9.5 | ✅ |
| `on-secondary` / `secondary-200` on `secondary-800` (sidebar text) | 12.7 / 8.0 | ✅ |
| `accent-700` on `accent-100` | 5.7 | ✅ |
| Status badges (`*-700` on `*-50`) | 5.1–6.8 | ✅ |
| White on `danger-600` / `success-600` | 5.6 / 5.0 | ✅ |
| `dominant-400` input border on white | 3.4 | ✅ (3:1) |
| **`accent-400` on white** | **1.3** | ❌ **Never use accent as text, icon, border or a lone indicator on a light background** |

### 2.5 Accent rules (the 10%)

Accent is powerful because it is rare. Follow these rules strictly:
- **At most one spotlight (accent) button per screen.** Every other action is primary, soft or ghost.
- Text and icons on accent are always `on-accent`.
- On light backgrounds, accent appears only as a **filled shape with `on-accent` content** (button, chip, progress fill, highlighter). It is never a thin line, text, icon or border by itself.
- On secondary backgrounds, accent can be text, an icon or an indicator.
- Accent is **never a status colour.** It does not mean success, paid or ready. Those use `success`.

**Where accent goes**

| Surface | Spotlight |
|---|---|
| Marketing site | "Start free trial" button, highlighter on key headline words |
| Onboarding | "Create my restaurant" on the last step, setup checklist progress |
| Restaurant admin | Active item indicator in the sidebar; the setup checklist progress bar; "New" chips |
| POS | **"Send to kitchen"** on the order view; **"Charge"** on the bill view (never both on screen at once); cart item count badge |
| KDS | "NEW" label on a ticket during its first 60 seconds |
| Super admin | The "PLATFORM ADMIN" label in the sidebar |
| Customer site | Only when the restaurant has no branding of its own (default theme) |

### 2.6 Changing the theme

Colours flow one way:

`palette (§2.2) → theme map → semantic tokens (§2.3) → components`

The theme map is the block marked `THEME MAP` in §10.1. **It is the only place that assigns a colour to the 60, the 30 or the 10.**

| Role | Tokens to set | Current preset |
|---|---|---|
| Dominant, 60 | `dominant-0`, `50`–`700`, `900` (text) | `snow-*`, with `ink` as `900` |
| Secondary, 30 | `secondary-50`–`900`, `on-secondary` | `cobalt-*`, with white on it |
| Accent, 10 | `accent-100`–`500`, `700`, `on-accent-fill` | `lime-*`, with `ink` on it |

To change a colour:
1. Add the new palette to §2.2 and to the palette block in §10.1 (for example `--color-teal-50` to `--color-teal-900`).
2. Point that role's lines in the theme map at it (for example `--color-secondary-600: var(--color-teal-600);`). Don't rename role or semantic tokens.
3. Keep the lightness order: low numbers are light, high numbers are dark.
4. Recheck every pair in §2.4 and update the ratios. They are only valid for the current preset.
5. Keep accent clearly different from the success, warning and danger colours.
6. Update what can't read CSS variables by hand: email templates and any fallback hex values in `lib/theme.ts`.
7. ALAN approves the change and DAVIN checks each surface in §7.

The 60-30-10 shares are layout rules (§2.1), not CSS values. To change the ratio, edit §2.1 and review each surface's layout.

---

## 3. Typography

**Family:** Plus Jakarta Sans (weights 400, 500, 600, 700, 800). Load it with `next/font/google` (`Plus_Jakarta_Sans`, `subsets: ['latin']`, `display: 'swap'`) and expose it as `--font-sans`. Latin covers both English and Bahasa Indonesia.

**Numbers:** prices, totals, quantities, timers and table numbers always use **tabular figures** (`font-variant-numeric: tabular-nums`, Tailwind `tabular-nums`). Plus Jakarta Sans supports `tnum` (checked), so columns of prices line up. Money is always formatted by `lib/money` (`Rp 25.000`).

**Scale**

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `display-xl` | 56 / 60 | 800 | Marketing hero |
| `display` | 44 / 52 | 800 | Marketing section titles |
| `h1` | 32 / 40 | 700 | Page titles |
| `h2` | 24 / 32 | 700 | Section titles, modal titles |
| `h3` | 20 / 28 | 600 | Card titles |
| `h4` | 18 / 26 | 600 | Subsections, POS item names |
| `body-lg` | 18 / 28 | 400 | Marketing body, POS cart lines |
| `body` | 16 / 24 | 400 | **Default** |
| `body-sm` | 14 / 20 | 400 | Table cells, secondary info, helper text |
| `caption` | 12 / 16 | 500 | Badges, labels, timestamps (never smaller than 12 px) |

- Headings use `-0.02em` letter spacing; body text uses the default.
- Uppercase is only for `caption` labels and badges, with `+0.04em` letter spacing.
- **Touch surfaces size up:** POS item names `h4` (18), POS prices 18 / 700 tabular, KDS item lines 20 / 600, KDS ticket number 28 / 800, KDS timer 20 / 700 tabular.
- Keep lines at 60–75 characters on reading pages (marketing, terms).
- Allow for **~30% longer text in Bahasa Indonesia**. No fixed-width buttons that truncate labels, and no text inside images.

---

## 4. Shape, depth and space (soft and friendly)

### 4.1 Corner radius

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 8 px | Checkboxes, small chips, tooltips |
| `radius-md` | 12 px | Buttons, inputs, selects, POS item tiles |
| `radius-lg` | 16 px | Cards, KDS tickets, dropdown menus |
| `radius-xl` | 24 px | Modals, sheets, marketing feature blocks |
| `radius-full` | 9999 px | Badges, pills, avatars, toggle switches |

Nested corners: an inner element's radius is the outer radius minus the padding (for example, a 16 px card with 8 px padding holds 8 px inner tiles).

### 4.2 Shadows

Soft, low and tinted with dominant-900, never grey-black.

| Token | Value | Use |
|---|---|---|
| `shadow-xs` | `0 1px 2px color-mix(in srgb, var(--color-dominant-900) 6%, transparent)` | Inputs, buttons at rest |
| `shadow-sm` | `0 1px 3px color-mix(in srgb, var(--color-dominant-900) 6%, transparent), 0 2px 8px color-mix(in srgb, var(--color-dominant-900) 5%, transparent)` | Cards |
| `shadow-md` | `0 4px 12px color-mix(in srgb, var(--color-dominant-900) 8%, transparent), 0 2px 4px color-mix(in srgb, var(--color-dominant-900) 4%, transparent)` | Dropdowns, hovered cards, KDS tickets |
| `shadow-lg` | `0 12px 32px color-mix(in srgb, var(--color-dominant-900) 12%, transparent), 0 4px 8px color-mix(in srgb, var(--color-dominant-900) 4%, transparent)` | Modals, sheets, toasts |

Cards use a 1 px `border` plus `shadow-sm`. Don't stack heavy shadows; elevation should feel like paper lifting slightly, not floating.

### 4.3 Spacing

A **4 px grid**: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96.
- Card padding: 20 px (compact 16 px, marketing 32 px).
- Gaps between cards: 16 px (admin), 24 px (marketing).
- Form fields: 16 px between fields, 6 px between label and input.
- Page padding: 16 px on phones, 24 px on tablets, 32 px on desktop.

### 4.4 Touch targets

| Context | Minimum target |
|---|---|
| Admin, super admin, customer site | 44 × 44 px |
| **POS and KDS** | **48 × 48 px**, with at least 8 px between targets |
| POS item tiles | 120 × 96 px minimum |

### 4.5 Motion

Calm and quick: **150 ms** for hovers and presses, **200–250 ms** for menus, modals and toasts, `ease-out` entering and `ease-in` leaving. Gentle, not bouncy.
- Buttons press down slightly (`scale(0.98)`).
- A new KDS ticket slides in and holds an accent "NEW" label for 60 seconds. No flashing.
- With `prefers-reduced-motion`, remove movement and keep only opacity fades.
- Skeleton shimmer stops with reduced motion.

---

## 5. Iconography and illustration

- **Icons:** [Lucide](https://lucide.dev) (rounded line icons, matching the soft style). 20 px in admin UI, 24 px on POS/KDS, stroke 1.75–2. Icons inherit text colour. An icon-only button always has an `aria-label` and a tooltip.
- **Illustrations:** simple friendly spot illustrations for empty states, onboarding and marketing. Line art in `dominant-900` with secondary fills and an accent highlight. One style everywhere, no stock photos of people in the product UI.
- **Photography:** only menu item photos (restaurant-supplied) and marketing. Menu photos use a 4:3 crop with `radius-md` corners and a `dominant-100` placeholder with a dish icon when missing.

---

## 6. Components

The base components live in `apps/web/components/ui/`. Every surface uses them. Build a new variant there instead of styling one-off copies on a page.

### 6.1 Buttons

| Variant | Look | Use |
|---|---|---|
| **Primary** | Secondary-600 fill, `on-secondary` text, `shadow-xs` | The main action in a section ("Save", "Invite staff") |
| **Spotlight** | Accent-400 fill, `on-accent` text, `shadow-sm` | The one most important action on the screen (see §2.5) |
| **Soft** | Secondary-50 fill, secondary-700 text | Secondary actions ("Add variant", "Filter") |
| **Outline** | White fill, `border-control`, dominant-900 text | Neutral actions ("Cancel", "Export") |
| **Ghost** | No fill, secondary-700 text, secondary-50 on hover | Toolbar and inline actions |
| **Danger** | Danger-600 fill, white text | Destructive confirmations only ("Void order"), inside a confirm dialog |

Sizes: `sm` 36 px, `md` 40 px (admin default), `lg` 48 px (POS, KDS, onboarding, marketing). Radius `radius-md`, label weight 600. Loading state keeps the button width and shows a spinner plus the label. Disabled: `dominant-100` fill, `dominant-500` text, no shadow.

### 6.2 Form controls

- Inputs, selects and textareas: white fill, 1 px `border-control`, `radius-md`, 40 px tall (48 px on touch surfaces), 12 px horizontal padding.
- Focus: 2 px `focus` ring with 2 px offset; the border turns secondary-600.
- Error: border danger-600, a danger-700 message below with an alert icon. Never colour alone.
- Labels sit above inputs (weight 500, 14 px). Helper text is `body-sm` `text-muted`.
- Money inputs show the `Rp` prefix inside the field and use tabular numbers.
- Toggles: pill switch, secondary-600 when on. Checkboxes and radios: secondary-600 when checked.

### 6.3 Cards and surfaces

White `surface`, 1 px `border`, `radius-lg`, `shadow-sm`, 20 px padding. Clickable cards gain `shadow-md` and a secondary-200 border on hover. Selected cards get a 2 px secondary-600 border and a secondary-50 tint.

### 6.4 Badges and status

Pill shape (`radius-full`), `caption` text, a leading icon or dot, the soft `*-50` fill with `*-700` text.

**Order status**

| Status | Colour | Icon |
|---|---|---|
| Placed | Info (secondary-50) | `receipt` |
| Accepted | Info (secondary-50) | `check` |
| Preparing | Warning | `chef-hat` |
| Ready | Success | `bell-ring` |
| Served | Neutral (dominant-100) | `utensils` |
| Completed | Neutral, muted text | `circle-check` |
| Cancelled | Danger | `x-circle` |

**Table status** (floor plan tiles use the same colours as a tile fill plus a status label)

| Status | Colour | Icon |
|---|---|---|
| Available | Success soft | `circle` |
| Reserved | Secondary soft, dashed border | `calendar-clock` |
| Occupied | Secondary-600 fill, `on-secondary` text | `users` |
| Needs cleaning | Warning soft | `sparkles` |

**Payment status**: Unpaid (neutral), Partially paid (warning), Paid (success), Refunded / partially refunded (neutral with `undo-2` icon).

**KDS timers** (fixed at 10 and 20 minutes): under 10 min neutral, 10–20 min warning (amber border + amber timer), over 20 min danger (red border + red timer + `alarm-clock` icon).

### 6.5 Navigation

- **Restaurant admin sidebar:** `nav-bg` secondary-800, 256 px wide, collapsible to a 72 px icon rail. `nav-text` labels, `nav-muted` section titles. The active item has an accent-400 pill indicator on the left and a secondary-700 background. Restaurant name and location switcher sit at the top.
- **Super admin sidebar:** `dominant-900` background (not secondary) with an accent "PLATFORM ADMIN" label, so nobody confuses the platform console with a restaurant's dashboard.
- **Top bar:** white, 64 px tall, bottom `border`. Holds the page title, search and the user menu.
- **Tabs:** underline style. The active tab has secondary-600 text and a 3 px secondary-600 underline with rounded ends.

### 6.6 Tables and lists

White surface in a card. Header row `surface-muted`, `caption` uppercase labels. Rows 52 px (compact 44 px) with a `border` divider. Hover `dominant-50`, selected `secondary-50`. Numeric columns are right-aligned and tabular. On phones, tables become stacked cards.

### 6.7 Overlays

- **Modal:** `radius-xl`, `shadow-lg`, max width 560 px (wide 800 px), dominant-900 overlay at 40% opacity. The title is `h2`, the actions sit bottom-right with the primary action last.
- **Sheet:** slides in from the right on desktop and from the bottom on phones and POS. Used for item modifiers on POS and for editing records.
- **Toast:** bottom-right (bottom-centre on phones and POS), white, `radius-lg`, `shadow-lg`, with a coloured leading icon. Auto-hides after 5 seconds; errors stay until dismissed.
- **Confirm dialogs** for destructive actions name the thing ("Void 2 × Nasi Goreng?") and put the danger button last.

### 6.8 Feedback states

Every screen designs all four states.

| State | Design |
|---|---|
| Loading | Skeletons in `surface-muted` matching the final layout. Spinners only inside buttons |
| Empty | A small illustration, one friendly sentence, and the primary action ("No tables yet. Add your first area to start your floor plan.") |
| Error | An inline danger-soft panel with what happened, what to do, and a "Try again" button. Never a raw error code |
| **Offline / reconnecting** (POS, KDS, live board) | A sticky warning-soft bar at the top: `wifi-off` icon + "Offline. Your cart is saved on this device and will sync when you're back online." Turns success-soft "Back online" for 3 seconds, then hides |

---

## 7. Surfaces

### 7.1 Restaurant admin
- Dominant canvas, secondary sidebar, white cards. Content max width 1280 px on a 12-column grid.
- The dashboard home shows the setup checklist (accent progress bar) until it is complete.
- Locked features (not in the package) show a soft card with a `lock` icon, one line about the feature and an "Upgrade" soft button. Never a hidden or broken page.

### 7.2 POS (10" tablet landscape and up, minimum 1024 × 768)
- Layout: category rail on the left (120 px), item grid in the centre (3–5 columns of tiles), cart on the right (360 px).
- Item tiles: white, `radius-md`, name `h4`, price 18 / 700 tabular, optional photo strip. A sold-out tile is greyed with a "Sold out" neutral badge and cannot be tapped.
- Selected category: secondary-600 fill with `on-secondary` text.
- The cart footer holds the totals (tabular, right-aligned) and **one** spotlight button: "Send to kitchen" or "Charge Rp 125.000".
- Modifiers open in a bottom sheet with large choice chips. Required groups are marked "Required" and the "Add" button stays disabled until they are satisfied.
- No hover-only interactions. Every action works by tap.

### 7.3 KDS (kitchen display, light)
- Light theme, bright and high-contrast so it reads under kitchen lighting and at a distance.
- Columns by station, with ticket cards 280–320 px wide, `radius-lg`, `shadow-md`.
- Ticket header: ticket number (28 / 800), table or channel, and the timer (tabular). The header strip and border change colour with the timer state (§6.4).
- Item lines 20 / 600 with modifiers and notes indented in `text-secondary`. Notes get a `message-square` icon so they're never missed.
- A large "Bump" button (48 px) at the bottom of each ticket.

### 7.4 Super admin
- The same components as the restaurant admin, with the **dominant-900 sidebar** and "PLATFORM ADMIN" label.
- Dangerous actions (suspend a tenant, archive a package) always use a confirm dialog with a typed reason.

### 7.5 Customer site (storefront)
- **The restaurant's brand leads.** Components use brand tokens (`brand-primary`, `brand-accent`, `on-brand-primary`) that come from `org_branding` as CSS variables in the storefront layout. Restomate's secondary and accent are only the **fallback** when a restaurant hasn't set colours.
- Neutrals, typography, radius, spacing and components stay Restomate's (dominant canvas, Plus Jakarta Sans unless the tenant chooses another font in M6).
- `theme.ts` picks `on-brand-*` (white or dominant-900) by contrast, and the branding settings warn when a colour choice fails 4.5:1 (PROJECT.md 4.16).
- Mobile-first (375 px design width), sticky cart button at the bottom, item photos prominent, Lighthouse mobile ≥ 90.
- A small "Powered by Restomate" link in the footer, in `text-muted`.

### 7.6 Frontend (marketing and signup)
- The most expressive surface, while still keeping the 60-30-10 split across the whole page.
- Dominant page with one secondary hero or feature band. Accent appears on the "Start free trial" spotlight button and as a highlighter (`accent-200`) behind one or two headline words.
- `display` type, friendly illustrations, product screenshots in `radius-xl` frames with `shadow-lg`.
- Onboarding is a calm, centred card (max 560 px) with a step indicator in secondary and the final step's button in accent.

### 7.7 Email
- **Restomate emails** (auth, staff invites, subscription invoices): dominant-50 background, a white card with `radius-lg` corners, a 4 px accent bar at the top of the card, the Restomate wordmark, and a secondary-600 button with `on-secondary` text.
- **Guest emails** (receipts, reservations): the restaurant's logo and `brand-primary` button, with the same layout.
- Use system font fallbacks in email (`'Plus Jakarta Sans', Arial, sans-serif`); web fonts are not reliable in email clients.
- Supabase auth templates (`supabase/templates/*.html`) use the same secondary button (see §10). They are built in M0-FE-10.

### 7.8 Print (bills and kitchen tickets)
- Black on white only. No colour, no accent, no shadows: thermal printers can't print them.
- The logo prints in greyscale. Use bold weight and size for hierarchy, and dashed rules between sections.
- Plus Jakarta Sans on A4; on thermal paper use the printer's built-in font through the print CSS where the browser allows it.

---

## 8. Content and voice

- **Friendly and plain.** Write like a helpful shift manager: short sentences, everyday words, second person ("Your order was sent to the kitchen").
- Button labels are verbs that say what happens: "Send to kitchen", "Charge Rp 125.000", "Invite staff". Never "Submit" or "OK".
- Errors say what happened and what to do next, without blame: "We couldn't reach the kitchen screen. Check the Wi-Fi and try again."
- Use the restaurant's words: "table", "bill", "kitchen ticket". Show "KOT" only where staff expect it (KDS, print).
- All text goes through the translation layer. English and Bahasa Indonesia are both first-class; design for the longer one.

---

## 9. Accessibility checklist

- WCAG 2.1 AA everywhere; the contrast pairs in §2.4 are pre-approved.
- A visible focus ring on every interactive element: `focus` 2 px + 2 px offset. Never remove outlines without a replacement.
- Status is never colour alone (§6.4).
- Targets meet §4.4.
- Every form field has a label; errors are linked with `aria-describedby`.
- Respect `prefers-reduced-motion` (§4.5).
- Test with keyboard only, and with the screen at 200% zoom.

---

## 10. Implementation (Tailwind v4)

### 10.1 Tokens in `apps/web/app/globals.css`

Reset Tailwind's default colours so only Restomate's palette exists (no stray `bg-blue-500`), then define the palette, the theme map and the semantic tokens:

```css
@import "tailwindcss";

/* static: emit every token, so a theme can also be overridden on :root. */
@theme static {
  --color-*: initial;                 /* remove Tailwind's default palette */
  --color-white: #FFFFFF;
  --color-black: #000000;

  /* PALETTE: raw colours. Referenced only by the theme map. */
  /* Cobalt */
  --color-cobalt-50:  #EEF3FC;
  --color-cobalt-100: #DCE7F9;
  --color-cobalt-200: #B9CEF2;
  --color-cobalt-300: #8AADE6;
  --color-cobalt-400: #5384D6;
  --color-cobalt-500: #1F5FC4;
  --color-cobalt-600: #0047AB;
  --color-cobalt-700: #003A8E;
  --color-cobalt-800: #002F73;
  --color-cobalt-900: #06265A;

  /* Snow */
  --color-snow-0:   #FFFFFF;
  --color-snow-50:  #F8FAFD;
  --color-snow-100: #F0F3F9;
  --color-snow-200: #E2E7F0;
  --color-snow-300: #CBD3E1;
  --color-snow-400: #808BA2;
  --color-snow-500: #626E87;
  --color-snow-600: #525D74;
  --color-snow-700: #3A4459;
  --color-ink:      #0F1B3D;

  /* Lime */
  --color-lime-100: #F2FDD0;
  --color-lime-200: #E4FB9E;
  --color-lime-300: #D2F766;
  --color-lime-400: #C0F03A;
  --color-lime-500: #A6DB12;
  --color-lime-700: #4F6B05;

  /* Status */
  --color-success-50: #E9F7EF; --color-success-600: #15803D; --color-success-700: #166534;
  --color-warning-50: #FEF6E7; --color-warning-500: #E89B0C; --color-warning-700: #9A5B00;
  --color-danger-50:  #FDECEC; --color-danger-600:  #C62828; --color-danger-700:  #A11D1D;

  /* ===== THEME MAP: edit here to re-theme ===== */
  /* Dominant: 60% */
  --color-dominant-0: var(--color-snow-0);
  --color-dominant-50: var(--color-snow-50);
  --color-dominant-100: var(--color-snow-100);
  --color-dominant-200: var(--color-snow-200);
  --color-dominant-300: var(--color-snow-300);
  --color-dominant-400: var(--color-snow-400);
  --color-dominant-500: var(--color-snow-500);
  --color-dominant-600: var(--color-snow-600);
  --color-dominant-700: var(--color-snow-700);
  --color-dominant-900: var(--color-ink);

  /* Secondary: 30% */
  --color-secondary-50: var(--color-cobalt-50);
  --color-secondary-100: var(--color-cobalt-100);
  --color-secondary-200: var(--color-cobalt-200);
  --color-secondary-300: var(--color-cobalt-300);
  --color-secondary-400: var(--color-cobalt-400);
  --color-secondary-500: var(--color-cobalt-500);
  --color-secondary-600: var(--color-cobalt-600);
  --color-secondary-700: var(--color-cobalt-700);
  --color-secondary-800: var(--color-cobalt-800);
  --color-secondary-900: var(--color-cobalt-900);
  --color-on-secondary: var(--color-white);

  /* Accent: 10% */
  --color-accent-100: var(--color-lime-100);
  --color-accent-200: var(--color-lime-200);
  --color-accent-300: var(--color-lime-300);
  --color-accent-400: var(--color-lime-400);
  --color-accent-500: var(--color-lime-500);
  --color-accent-700: var(--color-lime-700);
  --color-on-accent-fill: var(--color-ink);
  /* ===== END THEME MAP ===== */

  /* Semantic */
  --color-bg: var(--color-dominant-50);
  --color-surface: var(--color-dominant-0);
  --color-surface-muted: var(--color-dominant-100);
  --color-border: var(--color-dominant-200);
  --color-border-control: var(--color-dominant-400);
  --color-text: var(--color-dominant-900);
  --color-text-secondary: var(--color-dominant-600);
  --color-text-muted: var(--color-dominant-500);
  --color-primary: var(--color-secondary-600);
  --color-primary-hover: var(--color-secondary-700);
  --color-primary-pressed: var(--color-secondary-800);
  --color-primary-soft: var(--color-secondary-50);
  --color-on-primary: var(--color-on-secondary);
  --color-accent: var(--color-accent-400);
  --color-accent-hover: var(--color-accent-300);
  --color-accent-pressed: var(--color-accent-500);
  --color-on-accent: var(--color-on-accent-fill);
  --color-nav-bg: var(--color-secondary-800);
  --color-nav-text: var(--color-on-secondary);
  --color-nav-active: var(--color-accent-400);
  --color-focus: var(--color-secondary-600);
  --color-focus-inverse: var(--color-accent-400);
  --color-nav-muted: var(--color-secondary-200);

  /* Type, shape, depth */
  --font-sans: var(--font-jakarta), ui-sans-serif, system-ui, sans-serif;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --shadow-xs: 0 1px 2px color-mix(in srgb, var(--color-dominant-900) 6%, transparent);
  --shadow-sm: 0 1px 3px color-mix(in srgb, var(--color-dominant-900) 6%, transparent), 0 2px 8px color-mix(in srgb, var(--color-dominant-900) 5%, transparent);
  --shadow-md: 0 4px 12px color-mix(in srgb, var(--color-dominant-900) 8%, transparent), 0 2px 4px color-mix(in srgb, var(--color-dominant-900) 4%, transparent);
  --shadow-lg: 0 12px 32px color-mix(in srgb, var(--color-dominant-900) 12%, transparent), 0 4px 8px color-mix(in srgb, var(--color-dominant-900) 4%, transparent);
}

/* Storefront brand tokens: org_branding sets --brand-* on the storefront layout. */
@theme inline {
  --color-brand-primary: var(--brand-primary, var(--color-secondary-600));
  --color-on-brand-primary: var(--brand-on-primary, var(--color-on-secondary));
  --color-brand-accent: var(--brand-accent, var(--color-accent-400));
  --color-on-brand-accent: var(--brand-on-accent, var(--color-on-accent-fill));
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
}
```

### 10.2 Usage rules for code
- Components use **semantic** classes (`bg-surface`, `text-text-secondary`, `bg-primary`, `text-on-accent`, `border-border-control`). Role classes (`bg-secondary-50`) are allowed only inside `components/ui/` and for illustrations. Named palette classes (`bg-cobalt-50`) are not allowed anywhere, because they ignore theme changes.
- **No raw hex values or inline colour styles** outside `globals.css`, `lib/theme.ts` and email templates.
- Storefront components use only `brand-*` tokens for brand colour, never `secondary-*`/`accent-*` directly.
- Prices and timers: `tabular-nums` always.
- Before building a new component, check `components/ui/`. Before adding a token, update this file.