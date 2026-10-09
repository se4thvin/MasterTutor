/** Register instrumentations before the observer main module imports load. */
import { preload } from "./preload.ts";
preload("observer");
