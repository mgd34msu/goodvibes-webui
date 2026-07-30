/**
 * wake-runtime.ts — onnxruntime-web, adapted to the engine's session shape.
 *
 * The SDK's wake engine never imports an inference runtime. It declares the shape
 * of one (`WakeInferenceSession`) and the host supplies it, which is what lets the
 * same engine run in a daemon child process and in this tab. This file is that
 * supply on the browser side.
 *
 * WHICH BUILD, AND WHY — the deliberate answer to `voice.wake.browserBackend`.
 *
 * onnxruntime-web ships one entry per backend set. `onnxruntime-web/wasm` is the
 * wasm-only build (50 kB of glue, one 13 MB wasm binary) and does NOT contain the
 * WebGPU backend at all; asking it for `executionProviders: ['webgpu']` fails.
 * `onnxruntime-web/webgpu` contains WebGPU and its own larger wasm binary.
 *
 * So the entry is chosen by the setting, through a DYNAMIC import each way:
 *   - 'wasm'   -> onnxruntime-web/wasm     + ort-wasm-simd-threaded.wasm
 *   - 'webgpu' -> onnxruntime-web/webgpu   + ort-wasm-simd-threaded.asyncify.wasm
 * A tab that runs on wasm therefore downloads only the wasm build, and a tab set
 * to webgpu gets a backend that actually exists rather than a setting that reads
 * as configured and silently runs somewhere else. Neither is fetched at all until
 * wake detection is switched on, because both imports are dynamic.
 *
 * WebGPU is capability-checked against `navigator.gpu` before it is selected, and
 * when it is absent the tab falls back to wasm and SAYS SO as a limitation. The
 * engine's measured cost is ~3.5 ms per 80 ms frame on a single wasm thread, so
 * the fallback is a real fallback and not a degraded-to-unusable one.
 *
 * THREADS ARE NOT ASSUMED. Multi-threaded wasm needs SharedArrayBuffer, which
 * needs cross-origin isolation, which needs COOP/COEP response headers the daemon
 * does not send. `numThreads` is therefore pinned to 1 unless the tab reports
 * `crossOriginIsolated`, rather than left at the library default of "as many as
 * the system has" — which on a non-isolated origin means a failed initialisation.
 */
import type { WakeInferenceSession, WakeTensor } from '@pellux/goodvibes-sdk/platform/voice/wake/runtime';

export type WakeBrowserBackend = 'wasm' | 'webgpu';

/** A loaded runtime: which backend is really in force, and how to make a session. */
export interface WakeRuntime {
  /** The backend actually selected, which may differ from the one requested. */
  readonly backend: WakeBrowserBackend;
  /** Written reason the requested backend was not used, or null when it was. */
  readonly fallbackReason: string | null;
  createSession(bytes: Uint8Array): Promise<WakeInferenceSession>;
}

/** The slice of onnxruntime-web this module uses, so the import stays typed. */
interface OrtModule {
  readonly env: {
    wasm: {
      numThreads?: number;
      wasmPaths?: unknown;
      simd?: boolean | 'fixed' | 'relaxed';
    };
  };
  readonly InferenceSession: {
    create(bytes: Uint8Array, options: { executionProviders: string[] }): Promise<OrtSession>;
  };
  readonly Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensor;
}

interface OrtTensor {
  readonly data: unknown;
  readonly dims: readonly number[];
}

interface OrtSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
}

/** True when the tab can actually use WebGPU. */
export function webGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean((navigator as { gpu?: unknown }).gpu);
}

/**
 * Threads only where cross-origin isolation genuinely holds. `crossOriginIsolated`
 * is the browser's own answer to "is SharedArrayBuffer usable here", which is the
 * actual requirement — probing for the constructor is not, because it exists and
 * throws on a non-isolated origin.
 */
function wasmThreadCount(): number {
  const isolated = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
  return isolated === true ? 2 : 1;
}

/**
 * Load onnxruntime-web for a requested backend.
 *
 * The `?url` imports resolve through the package's own exports map (both wasm
 * binaries are exported subpaths) and Vite emits them as build assets, which is
 * what makes `ort.env.wasm.wasmPaths` resolvable at runtime without a wasm plugin.
 */
export async function loadWakeRuntime(requested: WakeBrowserBackend): Promise<WakeRuntime> {
  const wantsWebGpu = requested === 'webgpu';
  const gpuUsable = wantsWebGpu && webGpuAvailable();
  const fallbackReason = wantsWebGpu && !gpuUsable
    ? 'set to "webgpu", but this browser exposes no navigator.gpu. Detection is running on the WASM backend '
      + 'instead, which measures about 3.5 ms per 80 ms frame — well inside real time.'
    : null;

  const ort = gpuUsable ? await importWebGpuRuntime() : await importWasmRuntime();
  ort.env.wasm.numThreads = wasmThreadCount();

  const backend: WakeBrowserBackend = gpuUsable ? 'webgpu' : 'wasm';
  const executionProviders = gpuUsable ? ['webgpu', 'wasm'] : ['wasm'];

  return {
    backend,
    fallbackReason,
    createSession: async (bytes) => adaptSession(await ort.InferenceSession.create(bytes, { executionProviders }), ort),
  };
}

async function importWasmRuntime(): Promise<OrtModule> {
  const [ort, wasmUrl] = await Promise.all([
    import('onnxruntime-web/wasm') as Promise<unknown>,
    import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url') as Promise<{ default: string }>,
  ]);
  const module = ort as OrtModule;
  module.env.wasm.wasmPaths = { wasm: wasmUrl.default };
  return module;
}

async function importWebGpuRuntime(): Promise<OrtModule> {
  const [ort, wasmUrl] = await Promise.all([
    import('onnxruntime-web/webgpu') as Promise<unknown>,
    import('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url') as Promise<{ default: string }>,
  ]);
  const module = ort as OrtModule;
  module.env.wasm.wasmPaths = { wasm: wasmUrl.default };
  return module;
}

/**
 * Wrap an onnxruntime session in the engine's shape.
 *
 * The tensor conversion is checked rather than cast: a float32 output arrives as
 * a Float32Array, and anything else means the model is not the one this front end
 * was built for — which must fail here rather than produce scores from a
 * reinterpreted buffer.
 */
export function adaptSession(session: OrtSession, ort: Pick<OrtModule, 'Tensor'>): WakeInferenceSession {
  return {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    run: async (feeds) => {
      const ortFeeds: Record<string, OrtTensor> = {};
      for (const [name, tensor] of Object.entries(feeds)) {
        ortFeeds[name] = new ort.Tensor('float32', tensor.data, tensor.dims);
      }
      const outputs = await session.run(ortFeeds);
      const result: Record<string, WakeTensor> = {};
      for (const [name, tensor] of Object.entries(outputs)) {
        if (!(tensor.data instanceof Float32Array)) {
          throw new Error(`[wake] output "${name}" is not float32; this is not the pinned model.`);
        }
        result[name] = { data: tensor.data, dims: tensor.dims };
      }
      return result;
    },
    release: async () => {
      await session.release();
    },
  };
}
