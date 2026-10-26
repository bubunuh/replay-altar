# macOS support plan

This document captures the implementation plan for adding macOS support to Replay Altar. Project work should target the `dev` branch; `main` is reserved for tested work.

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
- native Warcraft III install and replay-folder discovery
- process detection
- collector lifecycle
- game-data extraction
- desktop notifications and app behavior
- release validation on Apple Silicon Macs, with Intel support assessed separately

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
4. Add detection for the native macOS Warcraft III install and replay locations.
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

1. Add macOS detection for the native Warcraft III client process, including the process name used by the Mac client.
2. Implement replay-folder detection for native Mac installs.
3. Make the collector react correctly when a match ends and a replay is written.

Native macOS Warcraft III is the first supported target. Wine and CrossOver setups can be considered later, after the native flow is reliable.

### Output

The app can recognize the active game and archive replays without Windows/Linux-only assumptions.

## Phase 4: game-data extraction

The repo currently uses different extraction strategies depending on OS:

- Linux: native read-only extractor built from CascLib (`scripts/casc/Containerfile.linux` and `scripts/casc/build-linux.sh`)
- Windows: a compiled helper binary

### Tasks

1. Build a native macOS `casc-extract` from CascLib, patched to open game files read-only, following the Linux extractor approach.
2. Add macOS compatibility to the install/game-data extraction flow and locate the native game install.
3. Validate extracted balance data and UI assets against a Mac install.

Do not depend on Podman for the Mac app: it requires a virtual machine on macOS. A native extractor is the simpler app experience and avoids that dependency.

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

1. Add `apps/desktop/package-mac.ts` beside the Windows and Linux packaging scripts, using the shared `apps/desktop/stage.ts` flow on `dev`.
2. Bundle the native extractor and arrange writable simulation resources in the user's data directory, adapting the Linux AppImage approach in `apps/desktop/src/appimage.ts` as appropriate for an app bundle.
3. Create a `.app` bundle and a DMG or ZIP release artifact.
4. Add CI build automation for macOS artifacts.
5. Document that the first build will be unsigned and not notarized because the project has no Apple Developer account; users will need to allow it in System Settings → Privacy & Security.

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

The first validation target is Apple Silicon. Intel support should be claimed only after the app and native extractor have been built and tested for that architecture.

## Risks and constraints

### Main risks

- variation in native Mac Warcraft III install and replay-folder locations
- Wine/CrossOver support expanding the process and path-detection scope
- collision between app install conventions and Electron packaging expectations
- launchd / login integration details
- unsigned-app first-run friction and the absence of notarization

### Mitigations

- centralize platform logic early
- keep Windows/Linux logic intact while adding a new branch
- validate each subsystem independently before end-to-end release checks

## Initial milestone plan

### Milestone 1

macOS config paths, native Warcraft III install/replay discovery, and the desktop app running from a checkout on Apple Silicon. Keep this milestone focused; no launch-at-login integration is required yet.

### Milestone 2

Background collector and launchd integration work on Mac.

### Milestone 3

The native read-only game-data extractor works on Mac and full replay ingest, simulation, and report generation are verified.

### Milestone 4

Package an unsigned, not-notarized macOS build for user download, with the first-run security steps documented. Signing/notarization can follow if the project obtains an Apple Developer account.

## Summary

The app’s analysis engine is likely portable, but the OS integration layer is not. macOS support is feasible, but it requires a careful platform-specific implementation plan across configuration, service management, process detection, extraction, and packaging.
