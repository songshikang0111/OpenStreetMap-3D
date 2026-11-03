// This leaf is also safe for browser-side project validation.
export class CityError extends Error {
  constructor(code, stage, message, hint = 'Check the input and retry.', details = {}) {
    super(message); Object.assign(this, { code, stage, hint, ...details });
  }
}
