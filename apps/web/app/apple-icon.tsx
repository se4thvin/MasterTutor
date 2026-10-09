import { appMarkImage } from "@/components/shell/app-mark.tsx";

/** The iPhone Home Screen icon (iOS rounds the corners itself). */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return appMarkImage(size.width);
}
