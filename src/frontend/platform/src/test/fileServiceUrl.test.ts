import { describe, expect, it } from "vitest";
import { withFileServiceBaseUrl } from "@/utils/fileServiceUrl";

describe("withFileServiceBaseUrl", () => {
  it("prefixes relative public-bucket URLs with the application base path", () => {
    expect(withFileServiceBaseUrl("/bisheng/original/3.md?signature=1", "/mo-agent")).toBe(
      "/mo-agent/bisheng/original/3.md?signature=1",
    );
  });

  it("prefixes relative temporary-bucket URLs", () => {
    expect(withFileServiceBaseUrl("/tmp-dir/upload/example.pdf", "/mo-agent")).toBe(
      "/mo-agent/tmp-dir/upload/example.pdf",
    );
  });

  it("rewrites absolute presigned URLs through the application base path", () => {
    expect(
      withFileServiceBaseUrl(
        "https://minio.example.com/bisheng/original/3.md?X-Amz-Signature=abc",
        "/mo-agent",
      ),
    ).toBe("/mo-agent/bisheng/original/3.md?X-Amz-Signature=abc");
  });

  it("does not add the base path twice", () => {
    expect(withFileServiceBaseUrl("/mo-agent/bisheng/original/3.md", "/mo-agent")).toBe(
      "/mo-agent/bisheng/original/3.md",
    );
  });

  it("keeps unrelated relative URLs unchanged", () => {
    expect(withFileServiceBaseUrl("/api/v1/files/3", "/mo-agent")).toBe("/api/v1/files/3");
  });

  it("uses root-level file-service paths when the app has no sub-path", () => {
    expect(withFileServiceBaseUrl("https://minio.example.com/bisheng/original/3.md", "/")).toBe(
      "/bisheng/original/3.md",
    );
  });
});
