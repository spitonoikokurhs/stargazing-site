# Seestar S50 → `/api/ingest` Feasibility

**Research spike — 2 July 2026**
**Question:** How does the ZWO Seestar S50 expose its live/stacked image to third‑party clients, and can we build a Termux Python relay that pulls the latest stacked frame every ~30 s and POSTs it to `/api/ingest` — the same pattern already working for the Pegasus SmartEye?

**Short answer:** Yes, feasible, and simpler than expected. The Seestar runs an on‑board **HTTP file server (port 80)** and an **SMB share (`\\seestar\MyWorks`)** that expose the stacked `.jpg` files it writes during a session. We do **not** need to run either community project on the Pad, and we do **not** need OpenCV or the heavy Alpaca stack. We reimplement a tiny slice of the protocol (or just poll the file server) in pure‑stdlib Python. **`seestar_alp` is the reference to learn the protocol from; `SSLM` is not relevant to this task.**

---

## The two projects at a glance

|  | **seestar_alp** | **SSLM** |
|---|---|---|
| Full name | Seestar ALP (Alpaca) | SeeStar **Library Manager** |
| Repo | `smart-underworld/seestar_alp` | `AstroNoob-Tools/SSLM` |
| What it is | ASCOM/Alpaca driver + web UI that **controls** the Seestar and relays its imaging in real time | Offline desktop app to **import/organise saved files** after a session |
| Language / runtime | **Python 3.13**, heavy scientific stack | **Node.js 18+**, Windows desktop (Electron‑style, opens `localhost:3000`) |
| Talks to scope via | Raw **TCP JSON‑RPC (4700)**, imaging **TCP (4800)**, UDP discovery (4720) | **SMB share** `\\seestar\MyWorks` (or removable drive `E:\MyWorks`) |
| Live latest frame? | **Yes** — two mechanisms (see below) | **No** — post‑session file copy only |
| Image format out | JPEG (from file server) or MJPEG (live stream); source frames are FITS | Copies raw `.fit` / `.jpg` files as‑is |
| Runs on Termux/ARM64? | Not as‑is (OpenCV/scikit‑image/pyindi), but the *protocol* is trivially portable | No — Windows‑only, wrong language |
| Last commit | **2026‑05‑26** (active, v3.2.0‑dev) | **2026‑03‑07** (v1.0.0‑preproduction) |
| Docs quality | Good: README, `AGENTS.md`, full **Bruno API collection**, inline protocol notes | Very good prose docs, but for a different task |
| License | **GPL‑3.0** (copyleft) | **PolyForm Noncommercial 1.0.0** ⚠️ |

---

## Per‑project findings

### 1) seestar_alp

1. **What is it?** A Python implementation of the ASCOM **Alpaca** REST API for the Seestar family (S30/S50/S80). It runs on a computer on the same network as the scope, connects to the Seestar's private JSON‑RPC protocol, and re‑exposes it as (a) a standards‑compliant Alpaca device other astro software can drive, and (b) its own web UI + scheduler. It is the de‑facto community reference for "how does the Seestar protocol actually work." Used by astrophotographers who want automation, scheduling, or integration with tools like N.I.N.A./SGP.
2. **Physical connection.** Whatever puts the host on the same IP network as the scope. The Seestar can run in **AP mode** (it *is* the Wi‑Fi access point) or **Station mode** (it joins an existing Wi‑Fi/router). seestar_alp assumes it can reach the scope by IP/hostname (`seestar.local`), so **Station mode joined to our hotspot is the relevant configuration** (see gotchas).
3. **Protocol.** Private, undocumented‑by‑ZWO but reverse‑engineered:
   - **TCP 4700** — line‑delimited **JSON‑RPC** control channel (`{"id":.., "method":.., "params":..}`). Hardcoded at `device/app.py:250`.
   - **TCP 4800** — imaging / streaming channel (`begin_streaming` id 21, `get_stacked_img` id 23).
   - **UDP 4720** — a broadcast `scan_iscope` "intro" the client sends to satisfy the scope's *guest mode* and gain control (`send_udp_intro`, `device/seestar_device.py:346`).
   - **HTTP port 80** — an on‑board file server serving saved images at `http://<scope>/MyWorks/<folder>/<file>.jpg` (seen in `get_last_image` and the Bruno "http get image file" example).
4. **Can it get the "latest stacked frame"? Yes — two ways:**
   - **File‑server path (recommended).** `get_last_image` (`device/seestar_device.py:1128`) sends `{"method":"get_albums"}` over 4700, reads the newest album entry, and returns a URL:
     `http://<scope>/<parent_folder>/<file>.jpg`. You then plain‑HTTP‑GET that JPEG. `is_subframe`/`is_thumb` params choose full sub vs thumbnail. This is the closest analogue to the SmartEye's `latest.png`.
   - **Live MJPEG path.** Open 4800, send `begin_streaming`, receive binary frames, `cv2.imencode(".jpeg", …)` them into a `multipart/x-mixed-replace` MJPEG stream (`device/seestar_imaging.py`). Lower latency, but needs OpenCV and yields *live preview* frames, not clean stacks.
5. **Image format / resolution.** The Seestar writes **FITS** (`.fit`) stacks plus a sibling **`.jpg`** and **`_thn.jpg`** thumbnail for each. The file‑server path gives you those **JPEGs** directly (S50 sensor is 1080×1920‑class; stacked JPEGs are full‑frame). The live stream is re‑encoded JPEG.
6. **Language/runtime & tricky deps.** Python **3.13**. `requirements.txt` is heavy: `opencv-python`, `scikit-image`, `astropy`, `numpy 2.3`, `pandas`, `skyfield`, `Pillow`, and **`pyindi` compiled from a git commit**. Several of these have **no prebuilt ARM64/Termux wheels** and would need compilation — painful on the Pad.
7. **Android/Termux.** Not designed for it; running the *whole* project on Termux/ARM64 would be a fight (OpenCV + pyindi). **But we don't need to** — the file‑server path is pure `socket`/`json`/`urllib` and runs anywhere.
8. **Activity.** Active — last commit 2026‑05‑26, ongoing 3.2.0 development, PR‑driven, CI test suite.
9. **Docs.** Good. README, `AGENTS.md`, inline protocol comments, and an extensive **Bruno API collection** (`bruno/Seestar Alpaca API/…`) that documents every method — effectively a free protocol spec.
10. **License. GPL‑3.0.** Copying its code into our relay would make our relay GPL. Reimplementing the wire protocol ourselves (facts, not code) avoids this. See "Legal."

### 2) SSLM (SeeStar Library Manager)

1. **What is it?** A self‑contained **Windows desktop** app (Node.js bundled, opens a local web UI at `localhost:3000`) for **managing astrophotography files after the fact** — import from the scope, dashboard stats, dedupe/merge libraries, export light frames for stacking, cleanup. It explicitly **does not control the telescope, does not stack, and does not fetch live images.**
2. **Physical connection.** Reads the scope's storage over an **SMB network share `\\seestar\MyWorks`** or a removable drive `E:\MyWorks`. Confirms the Seestar exposes `MyWorks` via SMB when networked.
3. **Protocol.** None of the live protocol — just **file I/O over SMB/filesystem**. (Useful corroboration: `\\seestar\MyWorks`, and the `.fit` + `.jpg` + `_thn.jpg` naming convention.)
4. **Latest live frame?** **No.** Post‑session copy only. Wrong tool for our need.
5. **Format.** Handles `.fit` (and their `.jpg`/`_thn.jpg` siblings) as opaque files.
6. **Language.** Node.js (23 JS files), Inno Setup installer, `%APPDATA%\SSLM`. No Python.
7. **Termux/ARM64.** No — Windows‑only desktop.
8. **Activity.** Last commit 2026‑03‑07, v1.0.0‑preproduction. Single maintainer, recent‑ish but pre‑production.
9. **Docs.** Genuinely good prose (`README`, `CLAUDE.md`, `AI_CONTEXT.md`) — but all about library management.
10. **License. PolyForm Noncommercial 1.0.0** ⚠️ — **prohibits commercial use.** stargazing.events is a commercial operation, so we could not reuse SSLM code even if it were relevant.

---

## Recommendation

**Use `seestar_alp` purely as the protocol reference, and build a small pure‑stdlib Termux Python relay that polls the Seestar's on‑board file server. Do not run either project on the Pad. SSLM is not a fit (wrong purpose, wrong platform, noncommercial license).**

**Why the file‑server poll wins for our use case:**
- **Minimal dependencies** — `socket` + `json` + `urllib`/`requests` only. No OpenCV, no numpy, no pyindi. Installs and runs cleanly on Termux/ARM64 on the OnePlus Pad, exactly like the existing SmartEye relay.
- **Right cadence** — we poll every ~30 s and grab the newest stacked `.jpg`. The Seestar writes a fresh stacked JPEG every stack‑save interval, which comfortably matches a 30 s poll. We don't need sub‑second live video.
- **Clean frames** — the saved `.jpg` is the stacked result (what viewers want), not a noisy live‑preview frame.
- **Decoupled from control** — file access (HTTP/SMB) is independent of the JSON‑RPC control channel, so our relay can read images **while you run the session normally in the ZWO app** without fighting for master control (see gotchas — needs a live test to confirm).
- **Symmetry with SmartEye** — same shape as today: fetch an image over HTTP, POST to `/api/ingest` with the `source` identifier (`seestar`). Fits the multi‑source design in the Phase 2 brief with zero new infrastructure.

**Two viable ways to find "the newest file" to fetch** (settle by test):
- **(A) JSON‑RPC `get_albums` on TCP 4700** — replicate ~30 lines from `seestar_alp` (UDP intro → connect 4700 → `get_albums` → newest entry → build `http://<scope>/MyWorks/…jpg` → GET). Most precise; may require the *guest/master* handshake.
- **(B) Directory scan over SMB or HTTP** — list `\\seestar\MyWorks` (or an HTTP index) for the most‑recently‑modified `.jpg` and GET it. Simplest; fully decoupled from control; depends on directory listing being available.

**Suggested plan:** prototype **(B)** first (least moving parts); fall back to **(A)** if directory listing isn't exposed or file‑write timing is awkward. Keep the **live MJPEG (4800 + OpenCV)** path in the back pocket only if we later want true low‑latency video — it's not worth the Termux dependency cost for Phase 2.

**Cadence vs the SmartEye.** The SmartEye writes a fresh `latest.png` frequently — typically every few seconds during active stacking. The Seestar's `.jpg` sibling is written per stack‑save, which is on the order of tens of seconds. Both fit within a 30‑second poll interval, but the Seestar's file changes less often, so filename/mtime dedup on the relay side matters more. In practice this means the SmartEye is more likely to produce new frames during any 30‑second window; the Seestar's cadence is closer to "roughly one new frame per minute during active observation."

---

## Things to watch (gotchas)

- **Networking / the hotspot plan.** Our setup is: OnePlus 11 phone hotspot ← SmartEye + Seestar + Pad all joined. For that to work the **Seestar must be in Station mode** (joined to the phone's Wi‑Fi), **not** AP mode. In AP mode the Seestar *is* the access point, so the Pad couldn't also be on the phone hotspot — that would break the shared‑LAN assumption. **Action:** confirm we can put the S50 into Station mode on the phone hotspot and reach it by IP/`seestar.local`. Reserve/note its DHCP address.
- **Does the ZWO app need to be open, and will control conflict?** seestar_alp takes *master* control via the UDP intro; the Seestar arbitrates one master at a time (guest vs master). Our intended flow is **you drive the session in the ZWO app while the relay only *reads* images.** File‑server reads (HTTP/SMB) should not need control — but whether `get_albums` (path A) works while the app holds master is **unverified**. Path B (directory scan) avoids the question. **Action:** live‑test reading images while the app is actively stacking.
- **Firmware 7.18+ authentication.** Newer firmware can require a PEM‑key `authenticate()` step on the control channel (`seestar_interop_pem` in seestar_alp). If our S50 is on such firmware, **path A** may need that handshake; **path B** (file access) likely sidesteps it. **Action:** check the scope's firmware version.
- **Stack‑save interval vs poll interval.** The newest `.jpg` only updates when the scope saves a new stack. If saves are less frequent than 30 s, consecutive polls return the same frame (harmless — de‑dupe by filename/mtime before POSTing so we don't re‑ingest identical frames).
- **`is_thumb` / subframe selection.** `get_last_image` can hand back a `_thn.jpg` thumbnail vs the full `.jpg`. Make sure we fetch the **full‑res** file, not the thumbnail.
- **No rate limits observed**, but be polite — a 30 s poll against a local file server is trivial load. Avoid hammering the control channel.
- **Filename encoding.** Object folders contain spaces (e.g. `NGC 6729_sub/`, `M 47`), so URL‑encode paths when building the HTTP GET.

---

## Legal / licensing note

- **seestar_alp is GPL‑3.0.** We may **read** it to learn the protocol, but must **not copy its code** into our (commercial, closed) relay — that would trigger copyleft. Protocol facts (ports, method names, message shapes) are not themselves copyrightable; a **clean‑room reimplementation** in our own words/code is the safe path.
- **SSLM is PolyForm Noncommercial** — code reuse is off the table for a commercial site regardless. We only cite it as corroboration of the SMB share and file‑naming convention.

---

## Suggested next steps

1. Put the S50 into **Station mode** on the OnePlus hotspot; confirm reachability + note its IP. Check firmware version.
2a. **Standalone test:** Python script on the Pad that connects to the Seestar's file server, finds the newest `.jpg`, downloads it, and writes it to disk. Success criterion: a real stacked image lands on the Pad within 30 seconds of pointing to a new target in the ZWO app.
2b. **Wire into `/api/ingest`:** extend the standalone script to POST the fetched frame to the ingest endpoint with `source=seestar`. This step can't complete until `/api/ingest` exists (Phase 2 build work), so bank it as the natural bridge between "Seestar relay works standalone" and "multi‑source ingest working end‑to‑end."
3. While the **ZWO app is actively stacking**, confirm the relay can read fresh frames without control conflict.
4. De‑dupe by filename/mtime so identical frames aren't re‑ingested.
5. If path B's directory listing isn't available, implement **path A** (clean‑room `get_albums` over TCP 4700, borrowing only the *protocol shape* from seestar_alp's Bruno collection).

_Repos cloned for this spike live outside the site repo at `C:\Users\MikeLaptop\Documents\seestar-research\` (not committed)._
