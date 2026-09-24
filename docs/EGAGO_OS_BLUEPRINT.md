# EGAGO OS — USB Boot Blueprint

## 1. Goal

EGAGO OS is a lightweight, bootable Linux environment dedicated to running EGAGO as an appliance rather than as a general-purpose desktop PC.

Target UX:

```text
Insert EGAGO USB
→ Boot
→ minimal Linux starts
→ network / audio / touch / GPU become ready
→ EGAGO backend starts
→ kiosk browser starts
→ EGAGO appears full-screen
```

The internal Windows installation should remain untouched during the MVP phase. Removing the USB should return the machine to its original environment.

## 2. Reference Hardware

Initial validation target:

- older Microsoft Surface / generic x86_64 touch PC
- 3rd-generation Intel Core i5-class CPU
- 4 GB RAM
- Intel integrated graphics
- touch panel
- UEFI boot

Do not hard-code Surface-only behavior. The long-term target is older x86_64 touch laptops, tablets and PCs.

## 3. Product Principle

Treat EGAGO like a game-console runtime. Linux is implementation detail, not the product UI.

Normal users should not see a desktop environment, terminal, package manager or Linux setup screens.

> **A PC that becomes EGAGO when you boot it.**

## 4. Mandatory Pre-Implementation Linux Evaluation Gate

**Do not begin implementation by assuming Debian, Mint, Alpine, NixOS or any other distribution is the final base.**

Immediately before implementation starts, perform a fresh comparison/search of currently maintained Linux bases and kiosk-oriented projects. Record the decision and evidence in this repository.

The evaluation must include at least:

- Debian Minimal / Debian netinst
- Alpine Linux
- NixOS or a NixOS kiosk approach
- Linux Mint Xfce as the known-working hardware validation environment
- any actively maintained lightweight kiosk/embedded Linux project discovered during the fresh search

Evaluate each candidate against EGAGO's actual requirements:

1. idle RAM and background-service footprint;
2. x86_64 / older Intel compatibility;
3. Intel Mesa/WebGL acceleration for Three.js + VRM;
4. touchscreen and libinput support;
5. audio + microphone support;
6. Wi-Fi / firmware availability;
7. Chromium/Wayland support;
8. Python/FastAPI compatibility;
9. Node.js/build-tool compatibility;
10. future local TTS compatibility;
11. persistence on USB;
12. reproducible ISO/image generation;
13. boot time;
14. maintenance/security updates;
15. setup complexity and recovery/debuggability.

### Current provisional favorite — not a locked decision

As of the design phase, the leading architecture is:

```text
Debian Minimal
  ↓
Mesa / libinput / audio / networking
  ↓
Wayland + Cage
  ↓
Chromium kiosk
  ↓
EGAGO
```

Cage is intentionally attractive because it is a single-application Wayland kiosk compositor rather than a full desktop environment.

However, **the implementation agent must re-run the Linux-base evaluation before writing the production bootstrap/image scripts.** If another maintained base demonstrably gives better compatibility, footprint or reproducibility, document the reason and change the base.

## 5. Known Useful Reference Architectures

During the design-phase search, useful patterns included:

- Debian-based Chromium kiosk systems;
- Cage as a minimal single-application Wayland compositor;
- NixOS + Cage + Chromium kiosk images with reproducible configuration;
- Alpine-based Wayland/Chromium kiosk systems.

These are architectural references, not dependencies. Do not blindly copy third-party kiosk scripts into EGAGO OS.

## 6. Architecture

```text
┌──────────────────────────────────────┐
│               EGAGO OS               │
│                                      │
│  Selected minimal Linux base         │
│       │                              │
│       ├─ Intel GPU / Mesa            │
│       ├─ Wi-Fi / networking          │
│       ├─ touch / libinput            │
│       └─ audio / microphone          │
│                 │                    │
│          Wayland + Cage              │
│                 │                    │
│          Chromium Kiosk              │
│                 │                    │
│          EGAGO Frontend              │
│       React + Three.js / VRM         │
│                 │                    │
│          EGAGO Backend               │
│             FastAPI                  │
│                 │                    │
│            TTS Gateway               │
└──────────────────────────────────────┘
```

A full desktop environment should not be installed in the production image unless hardware compatibility testing proves it necessary.

## 7. Development / Validation Strategy

### Phase A — Hardware validation

The existing Linux Mint Xfce Live USB is a known-working test environment. Use it to validate:

- touchscreen
- Wi-Fi
- speakers
- microphone
- Intel GPU acceleration
- WebGL
- display scaling
- sleep/resume where relevant
- EGAGO runtime

Mint is a validation tool, **not automatically the production EGAGO OS base**.

### Phase B — Minimal-base prototype

After the Linux Evaluation Gate selects a base:

- install only required firmware/runtime packages;
- launch EGAGO backend with systemd or the selected init system;
- launch Cage/Wayland;
- launch Chromium directly into EGAGO;
- measure idle RAM and EGAGO runtime RAM;
- compare WebGL/VRM performance with the Mint reference.

### Phase C — Persistent USB

Persist:

- Wi-Fi configuration
- EGAGO settings
- VRM assets
- logs
- voice/TTS configuration
- application updates

### Phase D — Reproducible EGAGO OS image

Target UX:

```text
Download egago-os-x86_64.iso/image
→ write with Rufus / Etcher
→ boot target PC
→ EGAGO starts automatically
```

## 8. Runtime Services

### egago-backend

- launch FastAPI;
- restart on failure;
- expose readiness status;
- log startup/runtime failures.

### egago-ui

- start the kiosk compositor;
- launch Chromium full-screen against local EGAGO;
- relaunch on unexpected exit.

### egago-health

Later:

- backend readiness;
- frontend readiness;
- TTS readiness;
- recovery screen / admin mode.

## 9. Voice Architecture

Do not couple EGAGO directly to one TTS engine.

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

The 4 GB reference device is not expected to train a custom voice model. Training should happen on stronger hardware. The appliance can perform inference locally when practical or call a trusted LAN service.

## 10. Touch-first Requirements

Normal operation must work without mouse or keyboard.

- large touch targets;
- no hover-only controls;
- no right-click dependency;
- readable text;
- touch-friendly scrolling;
- on-screen keyboard where required;
- kiosk/full-screen operation;
- hidden/admin maintenance escape path.

## 11. Performance Budget

The reference machine has only 4 GB RAM. Prioritize resources in this order:

1. Three.js / VRM frontend;
2. Chromium GPU acceleration;
3. FastAPI backend;
4. audio / TTS;
5. networking;
6. OS/UI infrastructure.

Avoid a resident desktop environment, unnecessary daemons, indexing services and startup applications.

Every production-base experiment should record at minimum:

- idle RAM after boot;
- RAM with EGAGO idle;
- RAM while VRM is active;
- boot-to-EGAGO time;
- WebGL renderer;
- touch/audio/Wi-Fi status.

## 12. Repository Layout Proposal

```text
docs/
  EGAGO_OS_BLUEPRINT.md
  EGAGO_OS_BASE_EVALUATION.md

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

## 13. Implementation Milestones

### V0.0 — Linux Base Evaluation

- perform a fresh search immediately before implementation;
- compare current lightweight/kiosk Linux options;
- benchmark/estimate the finalists against EGAGO requirements;
- write `docs/EGAGO_OS_BASE_EVALUATION.md`;
- select the production base explicitly.

**Implementation of the production image must not proceed until V0.0 is complete.**

### V0.1 — Prove EGAGO on Linux hardware

- verify touch, Wi-Fi, audio and WebGL on the reference Surface;
- start FastAPI + frontend;
- verify VRM rendering and interaction.

### V0.2 — Minimal appliance prototype

- install the selected minimal Linux base;
- configure Wayland/Cage or the selected equivalent;
- automatically start EGAGO;
- measure footprint and performance.

### V0.3 — Persistent USB

- preserve EGAGO and settings across reboot;
- configure automatic startup;
- provide recovery/admin access.

### V1.0 — Reproducible EGAGO OS

- scripted image build;
- bootable x86_64 ISO/image;
- one-step USB writing workflow;
- compatibility checklist;
- update and rollback strategy.

## 14. Definition of Done for V1

```text
Write EGAGO OS image to USB
+ boot old x86_64 PC
+ touchscreen works
+ Wi-Fi works
+ audio/microphone work
+ GPU/WebGL acceleration works
+ EGAGO backend starts automatically
+ EGAGO frontend starts automatically
+ VRM renders smoothly enough for target hardware
+ normal user never needs the Linux desktop
```

## 15. Non-goals for MVP

- rewriting the Linux kernel;
- modifying the internal Windows disk;
- training custom voice models on the 4 GB reference device;
- supporting every x86 machine before the reference hardware works;
- choosing an OS solely because it has the smallest ISO size while sacrificing GPU/audio/touch/TTS compatibility.
