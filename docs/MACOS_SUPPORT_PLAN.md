# macOS support plan

This document captures the implementation plan for adding first-class macOS support to Replay Altar.

## Goal

Provide a macOS build of the app that users can install and run locally, with the collector, replay ingestion, simulation, report generation, and desktop UI working on a Mac.

## Current status

The repo already has explicit Windows and Linux support paths, but not a macOS branch. Core platform assumptions are visible in:

- `packages/core/src/config.ts`
- `apps/collector/src/gamedata.ts`
- `apps/collector/src/install.ts`
- `packages/core/src/service.ts`
- `packages/core/src/process.ts`
- `apps/desktop/src/main.ts`

The code is structured well enough for a platform abstraction layer, but macOS support requires dedicated integration work rather than a small compatibility patch.

## Scope

### In scope

- macOS data/config paths
- app packaging for macOS
- login startup using `launchd` / LaunchAgent
- replay folder discovery
- process detection
- collector lifecycle
- game-data extraction
- desktop notifications and app behavior
- release validation on Intel and Apple Silicon Macs

### Out of scope

- Windows/Linux regression work
- changing the replay-analysis engine itself
- rewriting the rules/report system

## Platform architecture

We should introduce a single platform abstraction layer so the OS-specific behavior is centralized instead of being scattered across `if (process.platform === "win32")` checks.

Suggested modules:

- `packages/core/src/platform.ts`
- `packages/core/src/platform-paths.ts`
- `packages/core/src/platform-launcher.ts`

This layer should expose a common contract for:

- storage paths
- config paths
- replay folder discovery
- Warcraft III install locations
- process detection
- startup registration
- notification delivery
- install/uninstall behavior

## Phase 1: platform abstraction and paths

### Tasks

1. Add a `darwin` branch alongside existing Windows/Linux logic.
2. Centralize storage paths in a platform-aware API.
3. Add macOS-specific app-data and config folder defaults.
4. Add detection for common Warcraft III install locations.
5. Preserve the current Linux/Windows behavior while adding macOS support.

### Output

The app can start and locate its settings/data on a Mac without crashing or assuming Linux-specific paths.

## Phase 2: collector and startup lifecycle

### Tasks

1. Replace Linux `systemd --user` assumptions and Windows `Run` key assumptions with a macOS LaunchAgent flow.
2. Add `install`, `suspend`, `resume`, and `uninstall` behavior for macOS.
3. Ensure the collector can start at login using a user-specific LaunchAgent.
4. Expose consistent status reporting for `replay-altar status`.

### Output

The collector runs in the background on a Mac and can be managed with the same commands as other platforms.

## Phase 3: replay detection and process tracking

### Tasks

1. Add macOS detection of Warcraft III and related processes.
2. Implement replay-folder detection for native Mac installs and any Wine/CrossOver setup supported by the project.
3. Make the collector react correctly when a match ends and a replay is written.

### Output

The app can recognize the active game and archive replays without Windows/Linux-only assumptions.

## Phase 4: game-data extraction

The repo currently uses different extraction strategies depending on OS:

- Linux: `podman` container-based extraction
- Windows: a compiled helper binary

### Tasks

1. Decide whether macOS will use the Podman path or a native extraction path.
2. Add macOS compatibility to the install/game-data extraction flow.
3. Validate the extracted game data and UI assets for a Mac install.

### Recommendation

Use the container-based path for the first macOS release unless a native solution is required for packaging or reliability.

## Phase 5: desktop app behavior

### Tasks

1. Ensure the Electron app opens and behaves correctly on macOS.
2. Add macOS notification support.
3. Adjust app launch behavior so it does not steal focus incorrectly when Warcraft III opens.
4. Validate app startup, background behavior, and app menu/dock integration.

### Output

The UI behaves like a normal macOS app while still being the replay-collector companion.

## Phase 6: packaging and distribution

### Tasks

1. Add a macOS packaging script comparable to the Windows build path.
2. Produce a signed and notarized build.
3. Create a DMG or ZIP release artifact.
4. Add CI release automation for macOS builds.

### Output

Users can download a Mac build and install it without manual workarounds.

## Phase 7: validation

Before calling macOS support complete, validate:

- app installs successfully on a Mac
- collector starts at login
- replay folders are discovered
- replays are ingested
- game data extraction succeeds
- simulation runs without native OS errors
- rules/report generation completes
- notifications work
- uninstall removes the app cleanly

Validate on both:

- Intel Macs
- Apple Silicon Macs

## Risks and constraints

### Main risks

- difference between native Mac Warcraft III install and Wine/CrossOver flows
- collision between app install conventions and Electron packaging expectations
- launchd / login integration details
- notarization/signing requirements for macOS distribution

### Mitigations

- centralize platform logic early
- keep Windows/Linux logic intact while adding a new branch
- validate each subsystem independently before end-to-end release checks

## Initial milestone plan

### Milestone 1

macOS config paths + replay discovery + app can run locally in dev mode.

### Milestone 2

Background collector and launchd integration work on Mac.

### Milestone 3

Game-data extraction works on Mac and full replay ingest is verified.

### Milestone 4

Package a signed/notarized macOS build for user download.

## Summary

The app’s analysis engine is likely portable, but the OS integration layer is not. macOS support is feasible, but it requires a careful platform-specific implementation plan across configuration, service management, process detection, extraction, and packaging.
