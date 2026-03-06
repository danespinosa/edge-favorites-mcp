# Edge Favorites MCP Server

A local MCP (Model Context Protocol) server that reads your Microsoft Edge browser favorites and lets you search them via an AI agent.

## Tools

| Tool | Description |
|------|-------------|
| `search_favorites` | Search bookmarks by keyword (matches name, URL, and folder) |
| `list_favorites` | List all bookmarks, optionally filtered by folder |
| `list_folders` | List all unique folder paths |

## Installation

### From GitHub Release

1. Download the latest `-bundled.tar.gz` from [Releases](https://github.com/danespinosa/edge-favorites-mcp/releases)
2. Extract it somewhere on your machine
3. Add to your MCP config (see below)

### From Source

```bash
git clone https://github.com/danespinosa/edge-favorites-mcp.git
cd edge-favorites-mcp
npm install
```

## MCP Configuration

Add this to your MCP client config (e.g. `~/.copilot/config/mcp.json`):

```json
{
  "mcpServers": {
    "edge-favorites": {
      "command": "node",
      "args": ["/path/to/edge-favorites-mcp/index.js"]
    }
  }
}
```

## How It Works

The server reads the Edge Bookmarks JSON file and exposes search/list tools over the MCP stdio protocol. Bookmarks are read fresh on each request so new favorites are always picked up.

By default, it reads bookmarks from:
```
%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Bookmarks
```

## License

MIT
