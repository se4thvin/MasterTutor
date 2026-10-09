import { O2_EMPTY_PANEL_FILTER } from "../o2-api.ts";

export type PanelKind = "line" | "bar" | "table" | "metric";
export type PanelQuery =
  | { type: "promql"; expr: string }
  | { type: "sql"; stream: string; streamType: "logs" | "traces"; sql: string };

export interface Panel {
  title: string;
  kind: PanelKind;
  query: PanelQuery;
}

export interface DashboardSpec {
  title: string;
  description: string;
  panels: readonly Panel[];
}

const COLUMNS = 48;
const WIDTH = 24;
const HEIGHT = 9;

/** OpenObserve's dashboard JSON (shape pinned by upsert.int.test.ts against the digest). */
export function toO2Dashboard(spec: DashboardSpec): Record<string, unknown> {
  return {
    version: 5,
    title: spec.title,
    description: spec.description,
    defaultDatetimeDuration: {
      type: "relative",
      relativeTimePeriod: "24h",
      startTime: 0,
      endTime: 0,
    },
    variables: { list: [] },
    tabs: [
      {
        tabId: "default",
        name: "Default",
        panels: spec.panels.map((panel, index) => ({
          id: `panel_${index + 1}`,
          type: panel.kind,
          title: panel.title,
          description: "",
          config: { show_legends: true, decimals: 2 },
          queryType: panel.query.type,
          queries: [
            {
              query: panel.query.type === "promql" ? panel.query.expr : panel.query.sql,
              customQuery: true,
              fields: {
                stream: panel.query.type === "sql" ? panel.query.stream : "",
                stream_type: panel.query.type === "sql" ? panel.query.streamType : "metrics",
                x: [],
                y: [],
                z: [],
                filter: O2_EMPTY_PANEL_FILTER,
              },
              config: { promql_legend: "" },
            },
          ],
          layout: {
            x: (index % (COLUMNS / WIDTH)) * WIDTH,
            y: Math.floor(index / (COLUMNS / WIDTH)) * HEIGHT,
            w: WIDTH,
            h: HEIGHT,
            i: index + 1,
          },
        })),
      },
    ],
  };
}
