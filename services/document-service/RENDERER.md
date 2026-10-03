# Isolated PDF rendering

Recovery base: PR85, `60e5d88fee0ae26667f6e1473b72b2064990d423`.
This candidate does not activate a provider, change a spend ledger, or deploy.

## Install and readiness

Node 24 plus Python 3.11+ on Linux amd64/arm64 (production) or Windows amd64
(local synthetic tests). The Dockerfile installs Python and the hash-pinned
official PyPI pypdfium2 5.3.0 wheel, including PDFium 145.0.7616.0. No Pillow,
OCR engine, source build, runtime download or network rendering is used.

For a non-container host, create a dedicated virtual environment and run:

```
python3 -m venv /path/to/p5-renderer
/path/to/p5-renderer/bin/pip install --only-binary=:all: --no-deps --require-hashes -r requirements-renderer.txt
```

Set `DOCUMENT_PDFIUM_PYTHON` to that environment's absolute Python executable.
Do not replace a host's existing Python or credentials. Service startup probes
the pinned engine, its OS memory boundary, a real blank-page raster, and its
license bundle before opening the HTTP listener. Signed readiness includes the
renderer identity and license-bundle fingerprint. Missing/wrong runtime fails
startup. This probe does not establish real-plan accuracy or provider readiness.

The wheel's complete `pypdfium2-5.3.0.dist-info/licenses` tree remains installed
in the shipped virtual environment. Do not strip it during packaging. It includes
pypdfium2 Apache-2.0/BSD-3-Clause, PDFium's BSD-style license and bundled
third-party notices. Startup checks required notices and fingerprints all of them.
The wrapper's documented licenses do not replace PDFium's dependency notices.

Upstream references:
- https://github.com/pypdfium2-team/pypdfium2/blob/5.3.0/README.md#licensing
- https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE
- https://pypi.org/pypi/pypdfium2/5.3.0/json (wheel SHA-256 values)

## Failure boundary and evidence

The controller writes a private, unmodified original PDF once, then uses a guarded
PDF.js process for at most eight sequential manifest/page requests. It reuses only
engine initialization; every request opens and destroys its own PDF document.
The process is replaced after eight requests or any failure. It captures native
text/spans and page geometry before operator decoding and rasterization. Only
validated completed PNG/native records reach the awaited durable page callback.
Previously stored pages are skipped on restart; PR85's verifier checkpoints and
lease fencing remain in force. A failure never rewrites original source bytes.

A classified render/engine exit, resource stop or attempt timeout may trigger
one PDFium attempt for the current page, only if native evidence is available.
No recursive renderer retries occur. Existing job retry limits still apply;
explicit user retries remain separate operations. A native extraction failure,
input/capacity rejection, cancellation or guard failure does not trigger fallback.
The PDFium image uses annotations/forms, the same displayed crop box/rotation,
and normalized top-left crop. UserUnit values other than 1 are not accepted for
fallback until cross-engine geometry is qualified. Native text is never replaced
with raster-derived/OCR text. Page/source hashes, native engine, renderer versions,
crop, geometry, scale and exact pixel offset/full-canvas transform are saved.
Existing saved-overview crop recovery still labels its limited detail; it cannot
stand in for a failed native-coordinate refresh.

## Bounds and limitations

- One parser invocation executes at a time per service process, including crops;
  each invocation has at most one engine plus its small memory-guard process.
- The existing document deadline (default 60 seconds) includes child startup and
  fallback. Primary attempts get at most 15 seconds; PDFium gets at most 25 seconds
  and the remaining document time. Abort/timeout reaps children before returning.
  An already-started durable callback settles before the caller sees failure.
- Output is at most 5 million pixels and 24 MiB per PNG. Overview/crop target
  edges remain 2200/2000 pixels with scale at most 3; text primary stays 1400.
- PDFium Linux uses a hard 512 MiB address-space limit, 25-second CPU limit and
  24 MiB file-output limit. Windows uses a 384 MiB process-memory Job Object.
- PDF.js has a 128 MiB V8 old-generation cap. Before input opens, its Linux guard
  caps additional virtual address space at 256 MiB above initialized V8 mappings
  and polls RSS every 20 ms, stopping above 320 MiB. This RSS threshold is NOT a
  hard instantaneous RSS ceiling: polling can overshoot and pre-reserved virtual
  mappings can become resident. Windows uses a hard 384 MiB process-memory job.
  Container/host memory limits still matter; actual peak/cgroup evidence is a
  release gate. The existing cohost monitor now counts descendant renderer RSS.
  The child disables V8's Wasm trap-handler reservation optimization, using
  explicit bounds checks instead of a multi-GiB virtual-memory cage under the
  address-space cap (https://nodejs.org/api/cli.html#--disable-wasm-trap-handler).
  Fallback metadata records the primary exit code/signal, phase and numeric
  Linux memory samples/limits; no stderr or source content is exposed.
- Children get a minimal environment without provider/database credentials.
  PDF.js exits on controller IPC disconnect; Python uses a parent-death boundary.
  Child stderr/source details are not forwarded to public logs.
- Bounded initialization reuse amortizes startup without keeping document/page
  caches alive. The unchanged 100-page test and original
  plan validation must measure elapsed time; this is not a speed/accuracy claim.

## Required validation

Synthetic tests cover forced process exit/timeout, reaping, durable page and lease
recovery, unchanged native/source evidence, no partial-page publication, bounded
fallback, crop shifts/negative origins/all rotations, and live annotation pixels.
CI installs the same pinned package, runs existing service/application tests and
boots the actual container. Linux validation must separately use original Lot29
and Lot23 hashes, all pages, failed crops, pixels/native evidence, source versions,
timing and peak process-tree/cgroup memory. Exit137 alone is not proof of OOM.
The original PDFs and extracted customer content must not be committed or logged.
