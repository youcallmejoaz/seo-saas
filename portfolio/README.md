# Portfolio assets

Screenshots and a walkthrough recording of RankPilot, captured from a production build running on demo data. AI output in these captures is the platform's built-in mock mode (`AI_MOCK=1`), so the generated copy is templated rather than written by Gemini.

## Demo recording

![RankPilot walkthrough](video/rankpilot-demo-720.gif)

| File | Use |
|---|---|
| `video/rankpilot-demo.mp4` | 1280×800, 55 s, H.264. Best quality; use on websites and in decks. |
| `video/rankpilot-demo-960.gif` | 960 px GIF (~5 MB) for portfolio pages |
| `video/rankpilot-demo-720.gif` | 720 px GIF (~3 MB) for READMEs, Upwork and LinkedIn |

What it shows:
1. Sign in.
2. Agency overview.
3. Onboard *Peak Electrical Services* (electricians in Leeds, Bradford and Wakefield).
4. The AI plans and writes the site, with the run log streaming live.
5. Publish it.
6. Browse the generated site on its own subdomain.
7. Approve an AI-proposed page in the approval queue.
8. Ask "Show me which clients have experienced ranking improvements this month." and get the answer.

## Screenshots (1440×900 @2x)

| # | Screen |
|---|---|
| 01 | Agency overview: portfolio KPIs, movers, recent AI activity |
| 02 | AI command console: plain-English question, tool calls, answer |
| 03 / 04 | Client overview: Search Console and GA4 charts, rankings, tasks, approvals (04 is full page) |
| 05 | Website tab: generated pages, change history with rollback, edit with AI, domain |
| 06 | SEO campaign: AI plan summary, tasks with risk and status |
| 07 | Approval queue: proposed changes above the client's autonomy policy |
| 08 | Agent run log: research → plan → executed sub-tasks |
| 09 | Technical audit |
| 10 | Keywords: tracked rankings, research (estimates labelled), competitors |
| 11 | Settings: AI autonomy policy, budgets, Google connection, portal access, lifecycle |
| 12 | Onboard client form |
| 13 | Activity history |
| 14 | AI usage and cost |
| 15 / 16 | Client portal (16 is full page) |
| 17 / 18 | Generated client website, home (18 is full page) |
| 19 | Generated service page |
| 20 | Generated site for a second client (roofing) |
| 21 | Generated site on mobile |
| 22 | Client portal on mobile |

## Regenerating

With local Supabase, the Inngest dev server and a production build running (`pnpm build && pnpm start`):

```bash
pnpm seed
node scripts/portfolio/prepare-activity.mjs   # run an audit, a campaign, a scan and a command
node scripts/portfolio/screenshots.mjs        # writes portfolio/screenshots
node scripts/portfolio/record-demo.mjs        # captures frames + an ffmpeg concat list

REC=${TMPDIR:-/tmp}/rankpilot-rec
ffmpeg -f concat -safe 0 -i $REC/frames.txt -vf "fps=30,format=yuv420p" -c:v libx264 -crf 20 -movflags +faststart portfolio/video/rankpilot-demo.mp4
ffmpeg -i portfolio/video/rankpilot-demo.mp4 -vf "fps=12,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" portfolio/video/rankpilot-demo-720.gif
```

Set `PLAYWRIGHT_CHROMIUM_PATH` if Playwright should use a specific Chromium binary.
