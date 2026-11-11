/** Structured diagnostic, shared with the phase-one contract in src/core/index.d.ts. */
export interface Diagnostic {
  code: string;
  stage: string;
  message: string;
  path?: string;
  featureId?: string;
  tileId?: string;
  url?: string;
  hint?: string;
}

export interface ValidationResult<T> {
  valid: boolean;
  diagnostics: Diagnostic[];
  value?: T;
}

/** Error thrown by the tile codec. Always carries a structured diagnostic; never a bare TypeError/RangeError. */
export class TileError extends Error implements Diagnostic {
  readonly code: string;
  readonly stage: string;
  readonly hint?: string;
  readonly path?: string;
  readonly tileId?: string;

  constructor(
    code: string,
    message: string,
    options: { stage?: string; hint?: string; path?: string; tileId?: string } = {},
  ) {
    super(message);
    this.name = 'TileError';
    this.code = code;
    this.stage = options.stage ?? 'tile';
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.path !== undefined) this.path = options.path;
    if (options.tileId !== undefined) this.tileId = options.tileId;
  }

  toDiagnostic(): Diagnostic {
    const d: Diagnostic = { code: this.code, stage: this.stage, message: this.message };
    if (this.hint !== undefined) d.hint = this.hint;
    if (this.path !== undefined) d.path = this.path;
    if (this.tileId !== undefined) d.tileId = this.tileId;
    return d;
  }
}

export function isTileError(value: unknown): value is TileError {
  return value instanceof TileError;
}
