#!/usr/bin/env node
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Path to Edge bookmarks file
const BOOKMARKS_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  "Microsoft",
  "Edge",
  "User Data",
  "Default",
  "Bookmarks"
);

/**
 * Recursively flatten all bookmarks from the Edge Bookmarks JSON tree.
 * Returns an array of { name, url, folder } objects.
 */
function flattenBookmarks(node, folderPath = "") {
  const results = [];
  if (!node) return results;

  if (node.type === "url") {
    results.push({
      name: node.name || "",
      url: node.url || "",
      folder: folderPath,
      dateAdded: node.date_added,
    });
  }

  if (node.children && Array.isArray(node.children)) {
    const currentFolder = folderPath
      ? `${folderPath}/${node.name}`
      : node.name || "";
    for (const child of node.children) {
      results.push(...flattenBookmarks(child, currentFolder));
    }
  }

  return results;
}

/**
 * Load and parse Edge bookmarks file.
 */
function loadBookmarks() {
  if (!fs.existsSync(BOOKMARKS_PATH)) {
    throw new Error(`Edge Bookmarks file not found at: ${BOOKMARKS_PATH}`);
  }

  const raw = fs.readFileSync(BOOKMARKS_PATH, "utf-8");
  const data = JSON.parse(raw);
  const allBookmarks = [];

  if (data.roots) {
    for (const rootKey of Object.keys(data.roots)) {
      const rootNode = data.roots[rootKey];
      if (rootNode && typeof rootNode === "object") {
        allBookmarks.push(...flattenBookmarks(rootNode));
      }
    }
  }

  return allBookmarks;
}

// Create the MCP server
const server = new McpServer({
  name: "edge-favorites",
  version: "1.0.0",
});

// Tool: search_favorites - search bookmarks by keyword
server.tool(
  "search_favorites",
  "Search Edge browser favorites/bookmarks by keyword. Matches against name, URL, and folder path. Tip: after getting results, use read_favorite_content on interesting URLs to get more context about what each link contains.",
  { query: z.string().describe("Search keyword (case-insensitive)") },
  async ({ query }) => {
    try {
      const bookmarks = loadBookmarks();
      const q = query.toLowerCase();
      const matches = bookmarks.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q) ||
          b.folder.toLowerCase().includes(q)
      );

      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No favorites found matching "${query}".`,
            },
          ],
        };
      }

      const text = matches
        .map(
          (b, i) =>
            `${i + 1}. **${b.name}**\n   URL: ${b.url}\n   Folder: ${b.folder}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `Found ${matches.length} favorite(s) matching "${query}":\n\n${text}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: list_favorites - list all bookmarks, optionally filtered by folder
server.tool(
  "list_favorites",
  "List all Edge browser favorites, optionally filtered by folder path.",
  {
    folder: z
      .string()
      .optional()
      .describe("Filter by folder path (case-insensitive substring match)"),
    limit: z
      .number()
      .optional()
      .default(50)
      .describe("Max number of results to return (default 50)"),
  },
  async ({ folder, limit }) => {
    try {
      let bookmarks = loadBookmarks();

      if (folder) {
        const f = folder.toLowerCase();
        bookmarks = bookmarks.filter((b) =>
          b.folder.toLowerCase().includes(f)
        );
      }

      const total = bookmarks.length;
      const capped = bookmarks.slice(0, limit);

      const text = capped
        .map(
          (b, i) =>
            `${i + 1}. **${b.name}**\n   URL: ${b.url}\n   Folder: ${b.folder}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `Showing ${capped.length} of ${total} favorite(s):\n\n${text}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: list_folders - list all unique folder paths
server.tool(
  "list_folders",
  "List all unique folder paths in Edge favorites.",
  {},
  async () => {
    try {
      const bookmarks = loadBookmarks();
      const folders = [...new Set(bookmarks.map((b) => b.folder))].sort();

      return {
        content: [
          {
            type: "text",
            text: `Found ${folders.length} folder(s):\n\n${folders.map((f, i) => `${i + 1}. ${f}`).join("\n")}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: read_favorite_content - fetch URL content for more context
server.tool(
  "read_favorite_content",
  "Fetch the content of a favorite's URL to get more context about the page. Best effort: may fail for pages requiring authentication. Returns extracted text content.",
  {
    url: z.string().describe("The URL of the favorite to fetch"),
    maxLength: z
      .number()
      .optional()
      .default(5000)
      .describe("Max characters of content to return (default 5000)"),
  },
  async ({ url, maxLength }) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "EdgeFavoritesMCP/1.0",
          Accept: "text/html,application/xhtml+xml,text/plain,*/*",
        },
        redirect: "follow",
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`,
            },
          ],
          isError: true,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("text/plain") &&
        !contentType.includes("application/json")
      ) {
        return {
          content: [
            {
              type: "text",
              text: `URL returned non-text content (${contentType}). Cannot extract text.`,
            },
          ],
        };
      }

      let body = await response.text();

      // Strip HTML tags for a rough text extraction
      if (contentType.includes("text/html")) {
        // Remove script and style blocks
        body = body.replace(/<script[\s\S]*?<\/script>/gi, "");
        body = body.replace(/<style[\s\S]*?<\/style>/gi, "");
        // Extract title
        const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : "";
        // Strip tags and collapse whitespace
        body = body.replace(/<[^>]+>/g, " ");
        body = body.replace(/&nbsp;/g, " ");
        body = body.replace(/&amp;/g, "&");
        body = body.replace(/&lt;/g, "<");
        body = body.replace(/&gt;/g, ">");
        body = body.replace(/\s+/g, " ").trim();
        if (title) {
          body = `Title: ${title}\n\n${body}`;
        }
      }

      const truncated = body.slice(0, maxLength);
      const wasTruncated = body.length > maxLength;

      return {
        content: [
          {
            type: "text",
            text: `Content from ${url}${wasTruncated ? ` (truncated to ${maxLength} chars)` : ""}:\n\n${truncated}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch ${url}: ${err.message}. This is expected for pages requiring authentication.`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start the server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Edge Favorites MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
