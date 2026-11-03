export type HostType = string;
export type HostCallback = (...args: unknown[]) => unknown;
export type CallbackOptions = { internal?: boolean; rawStrings?: boolean; ints?: 'bigint' | 'number'; dry?: HostCallback; dryCallback?: HostCallback; unsafeReturn?: boolean };

export class LmcodeError extends Error {
  code: string;
  line: number | null;
  column: number | null;
}
export class Context {
  constructor(values?: Record<string, unknown>);
  set(name: string, value: unknown): this;
  get(name: string): unknown;
  setDry(value: boolean): void;
}
export class Registry {
  context(name: string, type: HostType): this;
  enum(name: string): this;
  fn(signature: string, callback: HostCallback, options?: CallbackOptions): this;
  method(signature: string, callback: HostCallback, options?: CallbackOptions): this;
  signatures(): string[];
}
export class Program {
  static load(bytecode: Uint8Array, schemaBytes: Uint8Array, registry: Registry): Program;
  readonly entries: ReadonlyArray<{ name: string; annotation: string; iface: string; params: string[]; returns: string }>;
  run(context?: Context | Record<string, unknown>): typeof import('./core/values.mjs').VOID;
  call(entry: number | string, context?: Context | Record<string, unknown>, args?: unknown[]): unknown;
}
export class ResultSink {
  constructor(contract?: ResultContract);
  set(value: unknown): void;
  put(key: string, value: unknown): void;
  setNull(): void;
  putNull(key: string): void;
  reset(): void;
  json(): string;
  complete(): unknown;
}
export class ResultContract {
  readonly type: string;
  readonly nullable: boolean;
  static fromSchema(schemaBytes: Uint8Array): ResultContract;
}
export class InvocationResults {
  static fromCommand(files: string[], env?: Record<string, string | undefined>): InvocationResults;
  static fromMetadata(raw: Uint8Array, files: string[]): InvocationResults;
  dryMode(): boolean;
  registrationsCopy(): Array<{ file: string; index: number }>;
  select(index: number, registry: Registry, contract?: ResultContract): ResultSink;
  complete(index: number): void;
  fail(index: number | null, phase: 'cli' | 'load' | 'run' | 'app', error: Error): void;
  writeFrame(): { code: number; frame: string };
}
export function Dry(callback: HostCallback): CallbackOptions;
export function createRegistry(): Registry;
export function registerStandard(registry: Registry): Registry;
export function registerTesting(registry: Registry, write?: (bytes: Uint8Array) => void): void;
export function resultContractFromSchema(schemaBytes: Uint8Array): ResultContract;
export function failureFrame(phase: 'cli' | 'load' | 'run' | 'app', error: Error): { code: number; frame: string };
export function frameResult(value: unknown, ok?: boolean, phase?: string | null, error?: LmcodeError | null): string;
export function formatFloat(value: number): string;
export function formatG15(value: number): string;
