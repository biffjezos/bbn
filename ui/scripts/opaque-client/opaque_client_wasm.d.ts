/* tslint:disable */
/* eslint-disable */

/**
 * Call once after loading the WASM module to set up error reporting.
 */
export function init(): void;

/**
 * Finish login. `server_response` is the base64 CredentialResponse from the
 * server. Returns a JS object `{ finalization: string, exportKey: string }`
 * (both base64). Throws if the password is wrong.
 */
export function login_finish(password: Uint8Array, server_response: string): any;

/**
 * Start login. Returns base64-encoded CredentialRequest to send to the server.
 * Stores client state internally — call login_finish() next.
 */
export function login_start(password: Uint8Array): string;

/**
 * Finish registration. `server_response` is the base64 RegistrationResponse
 * from the server. Returns base64-encoded RegistrationUpload to send to the
 * server for storage.
 */
export function register_finish(password: Uint8Array, server_response: string): string;

/**
 * Start registration. Returns base64-encoded RegistrationRequest to send
 * to the server. Stores client state internally — call register_finish() next.
 */
export function register_start(password: Uint8Array): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly init: () => void;
    readonly login_finish: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly login_start: (a: number, b: number) => [number, number, number, number];
    readonly register_finish: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly register_start: (a: number, b: number) => [number, number, number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
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
