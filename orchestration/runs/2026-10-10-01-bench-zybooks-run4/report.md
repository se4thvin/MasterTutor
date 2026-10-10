# zyBooks benchmark run 4: run ab178d4a (validates F7, F6 not effective)

**Task:** notes only on assignment 1, budget $10. **Result:** completed in 40 steps for **$3.42** (run 2: $5.76). **Cached input 59%** (run 2: 18%). **F7 fixed.**

**F6 not effective on zyBooks.** The notes still contain 24 "Due: … / due date has passed" blocks and the Assignments overview note. The banners carry no ARIA role. They live in `#main-content` inside each participation-activity widget, which holds buttons and controls, and the same text repeats once per activity. The structural filter (banner/alert/status/navigation/aria-live) never matches them, and the overview page is not classified as navigation-only (it has headings plus a list of links with scores).

Next: refine the generic rule. Text that repeats verbatim inside sibling interactive widgets (containers that hold buttons/inputs) is chrome. A page whose main content is mostly a list of links into the same document is navigation-only. Prove both against a fixture that mirrors this DOM.
