interface PlatformConfig {
  name: string;
  pattern: RegExp;
  icon: string;
}

const SUPPORTED_PLATFORMS: PlatformConfig[] = [
  {
    name: "Twitter/X",
    pattern: /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/.+\/status\/\d+/,
    icon: "🐦",
  },
  {
    name: "Instagram",
    pattern: /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[\w-]+/,
    icon: "📷",
  },
  {
    name: "YouTube",
    pattern: /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/,
    icon: "▶️",
  },
  {
    name: "Reddit",
    pattern: /^https?:\/\/(www\.)?reddit\.com\/r\/[\w]+\/comments\/[\w]+/,
    icon: "🤖",
  },
  {
    name: "TikTok",
    pattern:
      /^https?:\/\/(www\.)?(tiktok\.com\/@[\w.]+\/video\/\d+|vm\.tiktok\.com\/[\w]+)/,
    icon: "🎵",
  },
  {
    name: "Facebook",
    pattern:
      /^https?:\/\/(www\.)?(facebook\.com|fb\.watch)\/(watch\/?\?v=\d+|[\w.]+\/videos\/\d+)/,
    icon: "👤",
  },
  {
    name: "Vimeo",
    pattern: /^https?:\/\/(www\.)?vimeo\.com\/\d+/,
    icon: "🎬",
  },
  {
    name: "Twitch Clips",
    pattern:
      /^https?:\/\/(www\.)?(clips\.twitch\.tv\/[\w]+|twitch\.tv\/[\w]+\/clip\/[\w]+)/,
    icon: "🎮",
  },
  {
    name: "Pinterest",
    pattern: /^https?:\/\/(www\.)?pinterest\.(com|ca|co\.uk)\/pin\/\d+/,
    icon: "📌",
  },
  {
    name: "Dailymotion",
    pattern: /^https?:\/\/(www\.)?dailymotion\.com\/video\/[\w]+/,
    icon: "🎥",
  },
];

function isValidUrl(url: string): {
  valid: boolean;
  platform?: string;
  icon?: string;
} {
  for (const platform of SUPPORTED_PLATFORMS) {
    if (platform.pattern.test(url)) {
      return { valid: true, platform: platform.name, icon: platform.icon };
    }
  }
  return { valid: false };
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\x00-\x7F]/g, (char) => {
      const code = char.charCodeAt(0);
      return code < 128 ? char : "_";
    })
    .substring(0, 100);
}

function getYtDlpFormat(quality: string, platform?: string): string {
  if (platform?.includes("YouTube")) {
    switch (quality) {
      case "audio":
        return "bestaudio[ext=m4a]/bestaudio";
      case "720":
        return "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]";
      case "1080":
        return "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]";
      case "4k":
      case "2160":
        return "bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160]";
      case "best":
      default:
        return "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
    }
  }

  switch (quality) {
    case "audio":
      return "bestaudio/best";
    case "720":
      return "bv*[height<=720]+ba/b[height<=720]/b";
    case "1080":
      return "bv*[height<=1080]+ba/b[height<=1080]/b";
    case "4k":
    case "2160":
      return "bv*[height<=2160]+ba/b[height<=2160]/b";
    case "best":
    default:
      return "bv*+ba/b";
  }
}

function getFileExtension(quality: string): string {
  return quality === "audio" ? "m4a" : "mp4";
}

export async function streamVideo(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  const quality = searchParams.get("quality") || "best";

  if (!url) {
    return new Response(JSON.stringify({ error: "Missing url parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const validation = isValidUrl(url);
  if (!validation.valid) {
    return new Response(
      JSON.stringify({
        error: "Unsupported URL",
        message: "Please provide a valid URL from supported platforms",
        supported: SUPPORTED_PLATFORMS.map((p) => p.name),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const titleProc = Bun.spawn({
      cmd: ["yt-dlp", "--print", "title", url],
      stdout: "pipe",
      stderr: "pipe",
    });

    const titleTimeout = setTimeout(() => titleProc.kill(), 10000);

    let title: string;
    try {
      const rawTitle = await new Response(titleProc.stdout).text();
      await titleProc.exited;
      clearTimeout(titleTimeout);
      title = rawTitle.trim() || "video";
    } catch (err) {
      clearTimeout(titleTimeout);
      console.error("Title fetch failed:", err);
      title = "video";
    }

    const safeTitle = sanitizeFilename(title);
    const ext = getFileExtension(quality);
    const filename = `${safeTitle}.${ext}`;
    const format = getYtDlpFormat(quality, validation.platform);

    console.log(
      `Downloading from ${validation.platform}: ${title} (${quality})`,
    );

    // Download video with yt-dlp
    const ytdlp = Bun.spawn({
      cmd: ["yt-dlp", "-f", format, "-o", "-", url],
      stdout: "pipe",
      stderr: "pipe",
    });

    // Convert to streamable format with ffmpeg
    const isAudioOnly = quality === "audio";
    const ffmpegCmd = isAudioOnly
      ? [
          "ffmpeg",
          "-loglevel",
          "error",
          "-i",
          "pipe:0",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-f",
          "ipod",
          "pipe:1",
        ]
      : [
          "ffmpeg",
          "-loglevel",
          "error",
          "-i",
          "pipe:0",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-movflags",
          "frag_keyframe+empty_moov",
          "-f",
          "mp4",
          "pipe:1",
        ];

    const ffmpeg = Bun.spawn({
      cmd: ffmpegCmd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Pipe yt-dlp → ffmpeg
    (async () => {
      try {
        const reader = ytdlp.stdout.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          ffmpeg.stdin.write(value);
        }
        ffmpeg.stdin.end();
      } catch (err) {
        console.error("Pipe failed:", err);
        ffmpeg.kill();
        ytdlp.kill();
      }
    })();

    // Handle client disconnect
    req.signal.addEventListener("abort", () => {
      console.log("Client disconnected, cleaning up...");
      ffmpeg.kill();
      ytdlp.kill();
    });

    // Log errors
    (async () => {
      const ytdlpErr = await new Response(ytdlp.stderr).text();
      if (ytdlpErr) console.error("yt-dlp:", ytdlpErr);

      const ffmpegErr = await new Response(ffmpeg.stderr).text();
      if (ffmpegErr) console.error("ffmpeg:", ffmpegErr);
    })();

    const encodedFilename = encodeURIComponent(filename);
    const contentType = isAudioOnly ? "audio/mp4" : "video/mp4";

    return new Response(ffmpeg.stdout, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${isAudioOnly ? "audio" : "video"}.${ext}"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Download error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to download video",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// Export platform info for frontend
export function getSupportedPlatforms() {
  return SUPPORTED_PLATFORMS.map((p) => ({
    name: p.name,
    icon: p.icon,
  }));
}
