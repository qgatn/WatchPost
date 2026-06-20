/** Fixed-length ring buffer for sparkline history. */
export class History {
  private buf: number[] = [];

  constructor(private cap: number) {}

  push(v: number) {
    this.buf.push(v);
    if (this.buf.length > this.cap) this.buf.shift();
  }

  values(): number[] {
    return this.buf;
  }

  max(): number {
    return Math.max(1, ...this.buf);
  }
}
