# Generated Review-Pipeline Contract

> Generated from application source by `npm run docs:pipeline-contract`.
> Do not edit by hand; validate it with `npm run check:pipeline-contract`.
> This page covers machine-checkable facts only. The explanatory pages in this
> directory remain the human-maintained specification.

## File selection

| Fact | Source value |
|---|---|
| Recognized P3 source extensions | `css scss less js ts jsx tsx py java go rb php rs` |
| Priority order | ignore → P1 → P2 → P3 (first match wins) |

## Discovery and analysis

| Fact | Source value |
|---|---|
| Default files per priority | `20` (`MAX_FILES_PER_PRIORITY`) |
| Tree-cache TTL | `5` minutes |
| Content-fetch batch size | `5` |
| Gap between batches | `200` ms |
| SSE event types | `status, file, issue, complete, error` |
| Estimate tokens per file | `500` |
| Estimate output ratio | `0.2` |

## Reviewing agent and costs

| Fact | Source value |
|---|---|
| Default model | `deepseek-chat` |
| Analysis temperature | `0.3` |
| Analysis max tokens | `8000` |
| Token approximation | `4` characters/token |
| Input price | `$0.14` / 1M tokens |
| Output price | `$0.28` / 1M tokens |
