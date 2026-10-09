// The shot list every model sheet is built from.
const held = (c) => (c.id === "quill" ? "orb" : "book");

export const VIEWS = [["front", "Front", "0°"], ["threeQuarter", "Three-quarter", "35°"], ["side", "Side", "90°"], ["back", "Back", "180°"]];
export const EXPRESSIONS = [["neutral", "Neutral", "Default, listening"], ["happy", "Happy", "Greeting, run finished"], ["sleepy", "Sleepy", "Idle for a while"], ["thinking", "Thinking", "Planning the next step"]];
export const ACCESSORY_SHOTS = (c) => [["glasses", "Glasses", "eyes socket"], ["beret", "Beret", "crown socket · hides the crown piece"], ["headphones", "Headphones", "ear.L + ear.R sockets"], ["bowtie", "Bowtie", "neck socket"], [held(c), held(c) === "orb" ? "Orb (signature)" : "Book", "lap socket · hold pose"]];
export const STATES = [["working", "Working", "Typing on a tiny laptop"], ["dozing", "Dozing", "Idle, zzz drifting up"], ["thinking", "Thinking", "Hand to cheek, thought bubbles"], ["waving", "Waving", "Hello and goodbye"], ["celebrating", "Celebrating", "Run complete: hop, hat, confetti"]];

const STATE_SPECS = {
  working: { acc: ["laptop"], expr: "focused" },
  dozing: { pose: "sleep", expr: "sleepy", props: ["zzz"] },
  thinking: { pose: "think", expr: "thinking", props: ["bubbles"] },
  waving: { pose: "wave", expr: "happy", props: ["wave"] },
  celebrating: { pose: "celebrate", expr: "happy", acc: ["partyHat"], props: ["confetti"] },
};

export const SHOTS = (c) => [
  ...VIEWS.map(([v]) => ({ id: `turn-${v}`, view: v, frame: "turn" })),
  ...EXPRESSIONS.map(([e]) => ({ id: `expr-${e}`, expr: e, frame: "face" })),
  { id: "acc-none", frame: "fixed" },
  ...ACCESSORY_SHOTS(c).map(([a]) => ({ id: `acc-${a}`, acc: [a], frame: "fixed", expr: a === "book" || a === "orb" ? "happy" : "neutral" })),
  ...STATES.map(([s]) => ({ id: `state-${s}`, frame: "fit", ...STATE_SPECS[s] })),
];
