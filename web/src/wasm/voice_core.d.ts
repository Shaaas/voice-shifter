/* tslint:disable */
/* eslint-disable */

export class VoiceShifter {
    free(): void;
    [Symbol.dispose](): void;
    constructor(sample_rate: number);
    process(input: Float32Array): Float32Array;
    set_formant_ratio(ratio: number): void;
    set_pitch_semitones(semitones: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_voiceshifter_free: (a: number, b: number) => void;
    readonly voiceshifter_new: (a: number) => number;
    readonly voiceshifter_process: (a: number, b: number, c: number) => [number, number];
    readonly voiceshifter_set_formant_ratio: (a: number, b: number) => void;
    readonly voiceshifter_set_pitch_semitones: (a: number, b: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
