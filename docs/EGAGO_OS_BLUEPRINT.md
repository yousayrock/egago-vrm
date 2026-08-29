# EGAGO OS — USB Boot Blueprint

## 1. Goal

EGAGO OS is a lightweight, bootable Linux environment dedicated to running EGAGO as an appliance rather than as a general-purpose desktop PC.

The target experience is:

```text
Power on PC
  ↓
Boot from EGAGO USB
  ↓
Minimal Linux starts
  ↓
Network / audio / touch / GPU ready
  ↓
EGAGO backend starts
  ↓
Chromium kiosk starts
  ↓
EGAGO opens full-screen
```

The internal Windows installation should remain untouched during the MVP phase. Removing the USB should return the machine to its original Windows environment.

## 2. Reference Hardware

Initial validation target:

- Microsoft Surface generation using 3rd-gen Intel Core i5-class hardware
- 4 GB RAM
- Intel integrated graphics
- Touch panel
- UEFI boot

The project must not hard-code Surface-only behavior. The long-term target is generic x86_64 PCs, especially older touch-enabled laptops and tablets.

## 3. Product Principle

Treat EGAGO like a game-console runtime.

The Linux desktop is implementation detail, not the product UI.

Users should normally never see XFCE, a terminal, package managers, or desktop setup screens.

### Desired user experience

```text
Insert USB
→ Boot USB
→ EGAGO appears
→ Touch and use
```

## 4. MVP Strategy

Do not build a custom Linux distribution from scratch first.

Use Linux Mint Xfce as the bootstrap/reference environment because:

- it already boots successfully on the reference Surface hardware;
- it is relatively lightweight for 4 GB RAM systems;
- it provides a straightforward Ubuntu-compatible package ecosystem;
- it lets us validate EGAGO, touch, graphics, audio and networking before investing in ISO automation.

The first milestone is a persistent USB installation that behaves like EGAGO OS.

## 5. Architecture

```text
┌─────────────────────────────────────┐
│              EGAGO OS               │
│                                     │
│  Minimal Linux / Mint Xfce base     │
│          │                          │
│          ├─ Wi-Fi / Network         │
│          ├─ Touch input             │
│          ├─ Audio                   │
│          └─ Intel GPU / WebGL       │
│                 │                   │
│                 ▼                   │
│          EGAGO Backend              │
│             FastAPI                 │
│                 │                   │
│                 ▼                   │
│          EGAGO Frontend             │
│      React + Three.js / VRM         │
│                 │                   │
│                 ▼                   │
│          Chromium Kiosk             │
│                 │                   │
│                 ▼                   │
│              EGAGO UI               │
└─────────────────────────────────────┘
```

## 6. Boot Modes

### Phase A — Live validation

Use the current Linux Mint Live USB only to verify:

- touchscreen
- Wi-Fi
- speakers / audio output
- microphone
- Intel GPU acceleration
- WebGL
- sleep / resume
- display scaling
- EGAGO runtime

No permanent disk changes are required.

### Phase B — Persistent EGAGO USB

Create a USB environment with writable persistence so that the following survive reboot:

- Wi-Fi configuration
- EGAGO repository / build artifacts
- user settings
- VRM assets
- logs
- voice configuration
- application updates

### Phase C — EGAGO OS image

Package the working environment as a reproducible x86_64 image/ISO.

Target UX:

```text
Download egago-os-x86_64.iso
→ write with Rufus / Etcher
→ boot on target PC
→ EGAGO starts automatically
```

## 7. Runtime Services

EGAGO OS should eventually run the following services automatically.

### egago-backend.service

Responsibilities:

- launch FastAPI backend;
- restart on failure;
- wait for required local services;
- log startup/runtime failures.

### egago-ui.service

Responsibilities:

- launch Chromium in kiosk/fullscreen mode;
- open the local EGAGO frontend;
- relaunch Chromium if it exits unexpectedly.

### egago-health.service

Future responsibility:

- verify backend readiness;
- verify frontend readiness;
- verify TTS service;
- expose a simple recovery screen when startup fails.

## 8. Voice Architecture

Do not couple EGAGO directly to one TTS engine.

Use a replaceable TTS gateway:

```text
EGAGO
  ↓
TTS Gateway
  ├─ VOICEVOX
  ├─ custom user voice model
  └─ future TTS engines
  ↓
Audio output
```

Initial implementation may use VOICEVOX or another available engine. The API boundary must allow a future custom voice model without rewriting the EGAGO UI.

Training a custom voice model is not expected to run on the 4 GB reference Surface. Training should happen on a more powerful machine, while the EGAGO device performs inference locally when practical or calls a trusted LAN-hosted voice service.

## 9. Touch-first Requirements

EGAGO OS must be usable without mouse or keyboard during normal operation.

EGAGO UI should therefore avoid desktop-only interactions.

Requirements:

- large touch targets;
- no hover-only controls;
- no right-click dependency;
- large readable text;
- touch-friendly scrolling;
- on-screen keyboard support where text input is needed;
- fullscreen/kiosk operation;
- a hidden/admin escape path for maintenance.

## 10. Performance Budget

The reference machine has only 4 GB RAM, so the OS must leave as much memory as possible for EGAGO.

Priorities:

1. EGAGO frontend / Three.js / VRM
2. EGAGO backend
3. browser GPU acceleration
4. audio / TTS
5. networking
6. desktop environment only as a fallback/admin shell

Avoid unnecessary resident services and startup applications.

## 11. Repository Layout Proposal

Keep EGAGO application code and OS integration clearly separated.

Suggested layout in this repository for the MVP:

```text
docs/
  EGAGO_OS_BLUEPRINT.md

egago-os/
  scripts/
    bootstrap.sh
    install-runtime.sh
    configure-kiosk.sh
    configure-touch.sh
  systemd/
    egago-backend.service
    egago-ui.service
  config/
    chromium-flags.conf
  README.md
```

If the OS layer grows substantially, extract `egago-os/` into its own repository later.

## 12. Implementation Milestones

### V0.1 — Prove EGAGO on Live Mint

- boot Linux Mint Xfce on reference Surface;
- verify touch, Wi-Fi, audio and WebGL;
- clone EGAGO;
- install runtime dependencies;
- start FastAPI + frontend;
- verify VRM rendering and interaction.

### V0.2 — Persistent USB

- create persistent USB environment;
- preserve EGAGO and settings across reboot;
- configure automatic startup;
- configure Chromium kiosk mode;
- hide the normal desktop during regular use.

### V0.3 — Appliance Mode

- automatic login;
- backend service startup;
- kiosk UI startup;
- touch-friendly UI defaults;
- recovery/admin mode;
- basic health checks.

### V1.0 — Reproducible EGAGO OS

- scripted image build;
- bootable x86_64 ISO/image;
- one-step USB writing workflow;
- hardware compatibility checklist;
- update strategy;
- rollback/recovery strategy.

## 13. Immediate Next Step

Before implementing custom ISO generation, validate the current EGAGO repository on the already-booting Linux Mint Live environment.

Definition of done for the next session:

```text
Mint Live boots
+ touchscreen works
+ Wi-Fi works
+ audio works
+ WebGL works
+ EGAGO backend starts
+ EGAGO frontend starts
+ VRM renders
```

Once that passes, automate the same setup in `egago-os/scripts/bootstrap.sh`.

## 14. Non-goals for MVP

- replacing Linux kernel components unnecessarily;
- building a distribution completely from scratch;
- installing over or modifying the user's Windows disk;
- training custom voice models on the reference 4 GB device;
- supporting every x86 device before the reference Surface works reliably.

## 15. Long-term Vision

EGAGO OS should make old PCs useful as dedicated interactive character terminals.

The product identity is not “Linux running EGAGO”. It is:

> **A PC that becomes EGAGO when you boot it.**
