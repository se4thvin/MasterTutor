"use client";

import { useState } from "react";
import { RubberSegment, type SegmentItem } from "@/components/bits/rubber-segment.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button, IconButton } from "@/components/ui/button.tsx";
import { Chip } from "@/components/ui/chip.tsx";
import { SearchField } from "@/components/ui/search-field.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { TextField } from "@/components/ui/text-field.tsx";

const NOTE_VIEWS: SegmentItem<"source" | "note">[] = [
  { value: "source", label: "Source" },
  { value: "note", label: "Note" },
];
const BUDGETS: SegmentItem<"quick" | "standard" | "deep">[] = [
  { value: "quick", label: "Quick" },
  { value: "standard", label: "Standard" },
  { value: "deep", label: "Deep" },
];

export function ControlsSection() {
  const [on, setOn] = useState(true);
  const [view, setView] = useState<"source" | "note">("source");
  const [budget, setBudget] = useState<"quick" | "standard" | "deep">("standard");
  const [query, setQuery] = useState("");
  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon="add">
          New task
        </Button>
        <Button>Cancel</Button>
        <Button variant="plain">Learn more</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="primary" size="lg">
          Start
        </Button>
        <Button disabled>Disabled</Button>
        <IconButton icon="more" label="More actions" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge tone="ok" icon="verified">
          Verified
        </Badge>
        <Badge tone="warn" icon="needsReview">
          Needs review
        </Badge>
        <Badge tone="tint" icon="edited">
          Edited
        </Badge>
        <Badge tone="signal" icon="live">
          Live
        </Badge>
        <Badge tone="neutral" icon="agentNote">
          Agent note
        </Badge>
        <Badge tone="danger" icon="stop">
          Stopped
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip icon="web">learn.example.edu</Chip>
        <Chip icon="web" onRemove={() => undefined} removeLabel="Remove github.com">
          github.com
        </Chip>
      </div>
      <div className="grid max-w-md gap-4">
        <TextField
          label="Alias"
          hint="Lowercase letters, numbers, dash or underscore."
          placeholder="course-site"
        />
        <TextField
          label="Website"
          error="Enter a website such as example.com."
          defaultValue="not a url"
        />
        <SearchField
          label="Search the library"
          value={query}
          onChange={setQuery}
          placeholder="Search every block"
          shortcut="⌘K"
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <RubberSegment aria-label="Budget" items={BUDGETS} value={budget} onChange={setBudget} />
        <RubberSegment
          aria-label="Note view"
          fit="content"
          items={NOTE_VIEWS}
          value={view}
          onChange={setView}
        />
      </div>
      <label className="flex items-center gap-3">
        <Switch checked={on} onCheckedChange={setOn} label="Show callouts" />
        Show callouts
      </label>
      <div
        className="grid max-w-md gap-2"
        role="status"
        aria-busy="true"
        aria-label="Loading example"
      >
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}
