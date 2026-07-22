# Plan Center Design QA

- Source visual truth:
  - `C:\Users\Wlos\AppData\Local\Temp\codex-clipboard-f8c60854-a2cc-46bc-aeb1-7f49b7568307.png`
  - `C:\Users\Wlos\AppData\Local\Temp\codex-clipboard-95fd39ac-6c3e-4840-ae02-358b98a9b09d.png`
  - `C:\Users\Wlos\AppData\Local\Temp\codex-clipboard-1d064576-1a30-4a67-b05a-b7c10c6dcc8a.png`
  - `C:\Users\Wlos\AppData\Local\Temp\codex-clipboard-f4df9063-dcb1-4254-904f-a66868d25716.png`
- Implementation screenshot: unavailable; Windows Graphics Capture returned `0x80004002` for the running Electron console window after the production renderer was rebuilt.
- Viewport represented by source: 1064 × 753 and 676 × 427 desktop captures.
- States: create-plan date picker open, recurrence menu open, pending inbox with one item.

## Full-view comparison evidence

The supplied implementation captures show two P1 clipping failures: the date-time panel and recurrence menu are painted inside a short scrolling form body and are covered by the sticky footer. They also show that scrolling the time wheel moves the outer form, hiding the title field. The pending reminder uses loose text and two small buttons instead of a scannable completion card.

## Focused region evidence

- Date-time panel: the lower calendar rows and confirmation control are clipped at the form/footer boundary.
- Recurrence menu: lower options are clipped and the form is scrolled away from its first field.
- Pending inbox: completion has weak affordance and no immediate checked state.
- Completed history: without a bounded list and cleanup action, history management is unclear.

## Findings and fixes

- P1 — Popovers clipped by form height.
  - Fix: create dialog now has an explicit responsive height; its content row allows popovers to paint above the footer; date and select panels receive dedicated stacking levels.
- P1 — Opening the time wheel scrolls the entire form.
  - Fix: selected hour/minute are centered by changing only their column's `scrollTop`; `scrollIntoView` is no longer used.
- P2 — Pending reminders lack a clear completion interaction.
  - Fix: each reminder is now a bordered card with a circular completion control, checked success transition, retry recovery, and secondary snooze action.
- P2 — Completed history can become visually unbounded and lacks lifecycle control.
  - Fix: only six newest entries render, the list has a fixed internal scroll region, total count is shown, and a confirmed “清空记录” action removes only completed history.
- P1 — Form validation feedback is outside the native dialog top layer.
  - Fix: plan validation now targets a toast owned by the open dialog, positioned above its footer; the invalid title field is focused and receives an explicit error state.
- P2 — Completed count duplicates the cleanup action in the header.
  - Fix: the header now contains only “清空记录”; the footer consistently reads “总共 N 条完成记录”.

## Required fidelity surfaces

- Fonts and typography: existing console font tokens and hierarchy retained.
- Spacing and layout rhythm: dialog height, body tracks, footer boundary, card gaps, and rail height were adjusted.
- Colors and visual tokens: all new states reuse existing accent, surface, border, text, and danger tokens.
- Image quality and asset fidelity: no raster assets are involved in these controls; existing icon system is reused.
- Copy and content: actions use “清空记录”, “稍后 10 分钟”, and direct completion semantics.

## Comparison history

1. Source captures identified clipped date/select overlays and an unstructured inbox.
2. Layout and interactions were corrected in code and the production renderer rebuilt.
3. Post-fix capture could not be obtained because the local Electron window does not support the available Windows capture interface.
4. The new validation screenshot identified a native-dialog top-layer issue; feedback was moved inside the dialog and field-level invalid styling was added. Post-fix capture remains blocked by the same Electron capture limitation.

historical result: blocked

---

# Chat Context Drawer Design QA — 2026-07-22

- Source visual truth: `C:\Users\Wlos\Desktop\新萌宠\artifacts\chat-context-source.png`
- Implementation screenshot: `C:\Users\Wlos\Desktop\新萌宠\artifacts\chat-context-drawer.png`
- Combined comparison: `C:\Users\Wlos\Desktop\新萌宠\artifacts\chat-context-comparison.png`
- Source pixels: 1264 × 842; implementation pixels: 1212 × 808.
- Normalized comparison: both images resized to 600 CSS-equivalent pixels wide at density 1; no crop applied.
- State: desktop chat window with the context drawer open and its local privacy scrim active.

## Full-view comparison evidence

The source drawer is attached to the browser viewport and extends beyond the product's rounded window. The revised implementation is inset on all four sides of the chat content region, clipped by the rounded application shell, and leaves the custom title bar and outer shadow untouched. The drawer is visually separated as an elevated 22px-radius surface rather than a flat full-height system panel.

## Focused region comparison evidence

- Header: the revised drawer adds the existing context icon, accent eyebrow, stronger title hierarchy, shorter privacy copy, and a larger consistent close target.
- Body: loading, protected, empty, security summary, and context rows share the chat surface/border/accent tokens. Context rows use compact hoverable cards instead of an undifferentiated ruled list.
- Footer: the settings action is now a two-line card with purpose text and remains inside the drawer's bottom inset.
- Window boundary: smoke-test geometry verifies `top`, `right`, `bottom`, and `left` remain within `.chat-shell`.

## Required fidelity surfaces

- Fonts and typography: retains the application's Segoe UI Variable/Inter stack; hierarchy and small-copy weights match the chat workspace.
- Spacing and layout rhythm: 10px shell inset, 22px drawer radius, 20px header/footer margins, and compact data-row spacing produce consistent rhythm.
- Colors and visual tokens: uses the active system theme and user accent through existing `--surface-*`, `--text-*`, `--border-*`, `--success`, and `--accent` tokens.
- Image quality and asset fidelity: no raster imagery is needed; icons reuse the project's existing icon component.
- Copy and content: privacy behavior remains explicit and the settings action now describes its destination.

## Comparison history

1. P1: source drawer escaped the rounded app window because a modal top-layer dialog used viewport-fixed geometry.
2. Fix: changed it to a shell-owned non-modal dialog with an internal scrim and absolute containment; converted other shell overlays from fixed to absolute.
3. P2: source styling was flat, sparse, and inconsistent with the current chat cards.
4. Fix: rebuilt header, content rows, security state, footer action, elevation, spacing, and theme-token behavior.
5. Post-fix evidence: Electron smoke test passed and the implementation capture shows no boundary overflow. No actionable P0/P1/P2 differences remain.

## Follow-up polish

- P3: the smoke fixture may remain briefly in the loading state while its context provider initializes; real context, empty, and protected content reuse the same bounded layout.

historical result: passed

---

# Rounded Window Regression QA — 2026-07-22

- Audit scope: console pages, full-height plan editor, chat workspace, context drawer, native dialogs, update modal, responsive sidebar, toast layers, onboarding mask.
- Source evidence: `C:\Users\Wlos\Desktop\新萌宠\artifacts\rounded-window-audit\01-reported-plan-compression.png` (1112 × 792).
- Restored implementation: `C:\Users\Wlos\Desktop\新萌宠\artifacts\rounded-window-audit\02-restored-plan-dialog.png` (1112 × 792).
- Chat containment evidence: `C:\Users\Wlos\Desktop\新萌宠\artifacts\rounded-window-audit\03-chat-context-contained.png` (1212 × 808).
- Comparison board: `C:\Users\Wlos\Desktop\新萌宠\artifacts\console-plan-size-comparison.png`.
- Density normalization: source and implementation were compared at 560px width with no crop; both normalized to 560 × 399.

## Findings

- P1 — dialog safe area was counted twice.
  - Evidence: BrowserWindow already adds 32px to preserve the original content area, while dialogs separately subtracted 64px from `100vh`/`100vw`.
  - Fix: introduced the shared `--window-content-gutter: 32px` sizing contract and removed every hard-coded 64px viewport subtraction.
- P1 — plan editor lost its original full content height.
  - Fix: restored `min(760px, 100vh - 32px)`, matching the 760px rounded app surface inside the 792px native window.
- P2 — overlay implementations used inconsistent coordinate systems.
  - Fix: shell-owned drawers, sidebars, scrims, onboarding, and toasts use absolute shell coordinates; native dialogs use the shared viewport gutter.

## Full-view comparison evidence

The restored plan editor aligns with the rounded app surface at top and bottom, keeps its full 192px notes field, recurrence row, and persistent footer, and no longer loses an additional 32px. The chat capture confirms its internal drawer remains bounded after the shared sizing change.

## Focused region comparison evidence

- Plan footer remains visible and is not pushed below the app surface.
- Plan title, time picker, notes field, helper copy, and recurrence controls retain their designed heights.
- Console shell reports 1080 × 760 inside the 1112 × 792 native window.
- Chat shell reports 1180 × 780 inside the 1212 × 812 native window.

## Required fidelity surfaces

- Typography: unchanged; no scaling or browser zoom is applied.
- Spacing/layout: original inner dimensions restored; 16px shadow canvas is counted exactly once.
- Colors/tokens: no visual palette changes; the active accent and theme tokens remain intact.
- Assets: no asset changes are involved.
- Copy/content: unchanged.

## Verification

- All nine console tabs were opened in the Electron smoke run without scroll-position or renderer instability.
- Plan dialog bounds and exact restored height were measured in the live renderer.
- Chat shell and context drawer bounds were measured in the live renderer.
- Full test suite: 26 files, 72 tests passed.
- TypeScript checks and renderer/Electron builds passed.
- Static scan found no remaining `100vh - 64px`, `100vw - 64px`, or shell-level fixed overlays in console/chat.

historical result: passed

---

# Continuous Onboarding Spotlight and Rounded Modal QA — 2026-07-22

- Reported evidence: `C:\Users\Wlos\Desktop\新萌宠\artifacts\rounded-window-audit\04-reported-straight-backdrop.png`.
- Verified implementation: `C:\Users\Wlos\Desktop\新萌宠\artifacts\rounded-window-audit\05-rounded-plan-dialog-final.png`.

## Findings and fixes

- P1 — the onboarding spotlight re-entered from its fallback top position after every render. The previous spotlight rectangle is now captured before a step change and used as the next transition's starting geometry. Only the first mask/card entrance animation runs; later steps retain a continuous 240ms spotlight movement.
- P1 — native dialog backdrops occupied the rectangular Chromium top layer outside the rounded application surface. Console, chat, and update dialogs now use app-owned scrims with inherited border radius while native backdrops remain transparent.
- P2 — the plan editor sat too close to the application's top and bottom boundaries. Its live height is capped at 712px, leaving 24px vertical safe area inside the 760px app surface, with a reduced contained shadow.

## Verification

- Electron smoke completed the first-install consent path by waiting for each asynchronous next step, and verified that resumed onboarding has no repeated mask animation and retains a non-zero spotlight transition.
- Live geometry verified 22px or greater top/bottom dialog gaps, scrim bounds equal to the rounded app surface, and inherited rounded corners.
- The final implementation screenshot shows no rectangular mask or shadow outside the rounded application boundary.

final result: passed
