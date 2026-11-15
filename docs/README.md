# Sentinel documentation

Start with [HOW-TO-RUN](HOW-TO-RUN.md) to get it running, then read whichever guide fits your task.

## Run and operate

| Document | What it covers |
| --- | --- |
| [HOW-TO-RUN.md](HOW-TO-RUN.md) | Requirements, setup, starting on the laptop, connecting the tablet, what to say, stopping, tests |
| [CONFIGURATION.md](CONFIGURATION.md) | Every `.env` setting (keys, budgets, server, test switches), and the files Sentinel writes |
| [LOGS.md](LOGS.md) | The server window's tagged lines, the audit log, health and usage meters, troubleshooting |

## Build on it

| Document | What it covers |
| --- | --- |
| [API.md](API.md) | Every endpoint, grouped, with examples for the main ones. Regenerate the tables with `tools/gen_api_docs.py` |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The browser layers, the Director (command bus), server routes, the rules engine, the brain, speech and language chains |
| [LANGUAGES.md](LANGUAGES.md) | Local languages through Khaya AI: the pipeline, switching, fallbacks, saving the call allowance, adding a language |
| [INTEGRATION.md](INTEGRATION.md) | The reading pipeline, the one device interface, where NASA systems would connect, how it works in space |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Folder map, where each feature lives, the state contract, conventions, workflow |
| [../services/twi/README.md](../services/twi/README.md) | The local-language service on its own |
| [../tests/browser/README.md](../tests/browser/README.md) | The Playwright checks that drive the real app |

## Evidence and safety

| Document | What it covers |
| --- | --- |
| [DATASETS.md](DATASETS.md) | Every dataset used (NASA MRIDs, NASA-STD-3001, NOAA, DONKI, NLSP, research, 3D) and how Sentinel uses each |
| [../shared/SOURCES.md](../shared/SOURCES.md) | Where every number comes from: NASA standards, MRIDs, NOAA, clinical references, demo placeholders |
| [RADIATION_EVIDENCE.md](RADIATION_EVIDENCE.md) | The radiation limits and dose rates, with sources |
| [model_card.md](model_card.md) | What the models do, their limits, and how they are kept in check |
| [../CREDITS.md](../CREDITS.md) | Data, models, assets and their licences |

## Product and pitch

| Folder or document | What it holds |
| --- | --- |
| [JUDGE_WALKTHROUGH.md](JUDGE_WALKTHROUGH.md) | The product in one read, and one problem followed start to finish |
| [product/](product/) | The product document, the build spec, the v2 redesign, and the v2 build notes |
| [pitch/](pitch/) | Pitch deck notes, slides, the ASTRA research blueprint |
| [checklists/](checklists/) | Integration checklists and status notes |
