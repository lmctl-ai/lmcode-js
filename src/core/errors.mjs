export class LmcodeError extends Error {
  constructor(code, message, line = null, column = null) {
    super(message);
    this.name = 'LmcodeError';
    this.code = code;
    this.line = line;
    this.column = column;
  }
}
