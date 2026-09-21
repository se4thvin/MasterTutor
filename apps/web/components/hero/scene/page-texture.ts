import { CanvasTexture, SRGBColorSpace } from "three";

/**
 * Procedural "web page" (run 16): browser chrome, heading, sigmoid figure, captured region.
 * Hard-coded art colours are the page being captured, not UI tokens; the remote page is always light.
 */
export function pageTexture(
  maxAnisotropy: number,
  theme: { tint: string; signal: string; bondi: string; aqua: string; font: string },
): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 640;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const rr = (
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: string | CanvasGradient,
  ) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fillStyle = fill;
    g.fill();
  };
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 512, 640);
  g.fillStyle = "#F2F2F5";
  g.fillRect(0, 0, 512, 54);
  for (const x of [26, 46, 66]) {
    g.beginPath();
    g.arc(x, 27, 6.5, 0, Math.PI * 2);
    g.fillStyle = "#D2D2D7";
    g.fill();
  }
  rr(150, 14, 230, 26, 13, "#ffffff");
  g.font = `600 14px ${theme.font}`;
  g.fillStyle = "#1D1D1F";
  g.fillText("learn.example.edu", 196, 32);
  rr(36, 84, 70, 10, 5, theme.tint);
  g.font = `700 38px ${theme.font}`;
  g.fillText("Logistic regression", 34, 140);
  [470, 400].forEach((w, i) => rr(36, 160 + i * 18, w * 0.9, 8, 4, "#C7C7CC"));
  const grd = g.createLinearGradient(36, 210, 476, 410);
  grd.addColorStop(0, "#E8F7F5");
  grd.addColorStop(1, theme.aqua);
  rr(36, 210, 440, 200, 14, grd);
  g.strokeStyle = theme.bondi;
  g.globalAlpha = 0.35;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(60, 380);
  g.lineTo(456, 380);
  g.moveTo(256, 230);
  g.lineTo(256, 392);
  g.stroke();
  g.globalAlpha = 1;
  g.lineWidth = 5;
  g.lineCap = "round";
  g.beginPath();
  for (let i = 0; i <= 60; i++) {
    const x = 60 + i * 6.6;
    const s = 1 / (1 + Math.exp(-(i - 30) / 5));
    if (i === 0) g.moveTo(x, 372 - s * 128);
    else g.lineTo(x, 372 - s * 128);
  }
  g.stroke();
  g.globalAlpha = 0.09;
  rr(28, 432, 456, 62, 10, theme.signal);
  g.globalAlpha = 1;
  rr(28, 432, 5, 62, 2, theme.signal);
  [440, 410, 430].forEach((w, i) => rr(46, 446 + i * 16, w * 0.92, 7, 3.5, "#B8B8BE"));
  [440, 420, 445, 300].forEach((w, i) => rr(36, 520 + i * 22, w * 0.95, 8, 4, "#D2D2D7"));
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}
