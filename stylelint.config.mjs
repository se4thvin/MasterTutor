/** Motion rules for CSS (spec §11.4, D28). styles/motion.css is the only place raw timing lives. */
const ANIMATABLE = "(transform|opacity|scale|translate|rotate|visibility)";
const RAW_TIMING_KEYWORD = "/(?<![-\\w])(ease|ease-in|ease-out|ease-in-out|linear)(?![-\\w(])/";
const RAW_LINEAR_FN = "/(?<![-\\w])linear\\(/";

export default {
  ignoreFiles: ["**/node_modules/**", "**/.next/**", "apps/web/styles/motion.css"],
  rules: {
    "unit-disallowed-list": [
      ["ms", "s"],
      { message: "Use a --motion-dur-* variable from styles/motion.css" },
    ],
    "function-disallowed-list": [
      ["cubic-bezier", "steps"],
      { message: "Use a --motion-ease-* or --motion-spring variable" },
    ],
    "property-disallowed-list": [
      ["transition"],
      { message: "Write transition-property/duration/timing-function longhands" },
    ],
    "declaration-property-value-allowed-list": [
      { "transition-property": [`/^(none|${ANIMATABLE}(\\s*,\\s*${ANIMATABLE})*)$/`] },
      { message: "Only transform and opacity may animate (spec §11.4)" },
    ],
    "declaration-property-value-disallowed-list": [
      {
        "/^(transition-timing-function|animation-timing-function|animation)$/": [
          RAW_TIMING_KEYWORD,
          RAW_LINEAR_FN,
        ],
      },
      { message: "Timing functions come from var(--motion-…)" },
    ],
    "rule-selector-property-disallowed-list": [
      {
        "/^(from|to|\\d+(\\.\\d+)?%)(\\s*,\\s*(from|to|\\d+(\\.\\d+)?%))*$/": [
          `/^(?!${ANIMATABLE}$)/`,
        ],
      },
      { message: "Keyframes may only change transform and opacity" },
    ],
  },
};
