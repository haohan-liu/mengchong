# 聊天输入区微调 QA

- source visual truth path: `C:/Users/Wlos/AppData/Local/Temp/codex-clipboard-020216fa-053e-4406-8ef3-9b92f65c7a47.png`
- secondary reference path: `C:/Users/Wlos/AppData/Local/Temp/codex-clipboard-7b5c9efd-1a42-4b07-b6dc-f2991d000d42.png`
- implementation screenshot path: unavailable
- viewport: source crop, 877 × 187 px
- state: empty composer with visible shortcut badge in the reference

**Findings**

- [P1] Composer focus styling created a double-outline effect.
  Location: `.composer` and `.composer textarea`.
  Evidence: the source screenshot shows a cyan inner focus rectangle inside a rounded outer composer.
  Impact: the input appears visually misaligned and less polished.
  Fix: move focus affordance to the outer composer, remove textarea focus outline, center the textarea and action button on one axis, and align metadata to the composer width.

- [P2] The `Ctrl N` shortcut badge adds unnecessary visual weight to the new-chat action.
  Location: `.new-topic.primary-action`.
  Evidence: secondary reference shows the badge on the action button.
  Impact: the primary action looks crowded.
  Fix: remove the badge and the corresponding keyboard handler.

**Comparison History**

1. Implemented the P1/P2 fixes in `src/chat/styles.css` and `src/chat/main.ts`.
2. Browser-rendered comparison could not be captured: the in-app browser reports that newly created local preview tabs are not part of the current browser session, and no claimable tabs are available.

**Implementation Checklist**

- [x] Align text input and send action on one vertical axis.
- [x] Remove inner textarea focus ring.
- [x] Match composer metadata width to the composer shell.
- [x] Remove the `Ctrl N` badge and handler.
- [x] Run tests, type checking, and renderer build.

**Follow-up Polish**

- Re-capture the local preview when the in-app browser session is available to visually confirm the final focus state.

final result: blocked
