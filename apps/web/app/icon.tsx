import { appMarkImage } from "@/components/shell/app-mark.tsx";

/** /icon/192 and /icon/512 for the web app manifest. */
export function generateImageMetadata() {
  return [192, 512].map((size) => ({
    id: String(size),
    size: { width: size, height: size },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  return appMarkImage(Number(await id));
}
