import { describe, expect, it } from "vitest";
import { assertPublicHost, contentTypeFor } from "../src/fetch-url";

describe("direct URL ingest guards", () => {
  it("refuses private and loopback addresses", async () => {
    for (const u of ["http://127.0.0.1/a.mp4", "http://10.1.2.3/a.mp4", "http://[::1]/a.mp4", "http://169.254.169.254/latest", "http://[::ffff:10.0.0.1]/a.mp4"])
      await expect(assertPublicHost(new URL(u))).rejects.toThrow(/private network/);
    await expect(assertPublicHost(new URL("http://93.184.216.34/a.mp4"))).resolves.toBeUndefined();
    await expect(assertPublicHost(new URL("http://[2606:2800:220:1::1]/a.mp4"))).resolves.toBeUndefined();
  });

  it("accepts video content types and known extensions only", () => {
    expect(contentTypeFor(new URL("https://x.test/a"), "video/mp4")).toBe("video/mp4");
    expect(contentTypeFor(new URL("https://x.test/a.mov"), "application/octet-stream")).toBe("video/quicktime");
    expect(() => contentTypeFor(new URL("https://x.test/page"), "text/html")).toThrow(/direct video/);
  });
});
