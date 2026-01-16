import { serve } from "bun";
import { streamVideo, getSupportedPlatforms } from "./downloader";

const server = serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response(Bun.file("../public/index.html"), {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    if (url.pathname === "/api/platforms") {
      return new Response(JSON.stringify(getSupportedPlatforms()), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Main download endpoint (replaces /twitter/stream)
    if (url.pathname === "/api/download") {
      return streamVideo(req);
    }

    // Legacy endpoint for backward compatibility
    if (url.pathname === "/twitter/stream") {
      return streamVideo(req);
    }

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", timestamp: Date.now() }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response("Not Found", { status: 404 });
  },
  error(error) {
    console.error("Server error:", error);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`🚀 Server running at http://localhost:${server.port}`);
console.log(
  `📥 Download endpoint: http://localhost:${server.port}/api/download`,
);
