// Exact rational numbers on BigInt. Always normalised: denominator > 0, gcd(n, d) = 1.

const abs = (a: bigint) => (a < 0n ? -a : a);

export function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export class Q {
  readonly n: bigint;
  readonly d: bigint;

  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new RangeError('denominator is zero');
    if (d < 0n) [n, d] = [-n, -d];
    const g = gcd(n, d);
    this.n = g > 1n ? n / g : n;
    this.d = g > 1n ? d / g : d;
  }

  static readonly ZERO = new Q(0n);
  static readonly ONE = new Q(1n);

  static of(n: number | bigint, d: number | bigint = 1n): Q {
    return new Q(BigInt(n), BigInt(d));
  }

  add(o: Q): Q {
    return o.n === 0n ? this : this.n === 0n ? o : new Q(this.n * o.d + o.n * this.d, this.d * o.d);
  }

  sub(o: Q): Q {
    return o.n === 0n ? this : new Q(this.n * o.d - o.n * this.d, this.d * o.d);
  }

  mul(o: Q): Q {
    return new Q(this.n * o.n, this.d * o.d);
  }

  div(o: Q): Q {
    if (o.n === 0n) throw new RangeError('division by zero');
    return new Q(this.n * o.d, this.d * o.n);
  }

  neg(): Q {
    return new Q(-this.n, this.d);
  }

  sign(): -1 | 0 | 1 {
    return this.n > 0n ? 1 : this.n < 0n ? -1 : 0;
  }

  isZero(): boolean {
    return this.n === 0n;
  }

  cmp(o: Q): -1 | 0 | 1 {
    return this.sub(o).sign();
  }

  eq(o: Q): boolean {
    return this.n === o.n && this.d === o.d;
  }

  toNumber(): number {
    // split off the integer part so huge numerators and denominators keep their precision
    const i = this.n / this.d, r = this.n - i * this.d;
    return Number(i) + Number(r) / Number(this.d);
  }

  toString(): string {
    return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`;
  }

  static parse(s: string): Q {
    const m = /^(-?\d+)(?:\/(\d+))?$/.exec(s.trim());
    if (!m) throw new SyntaxError(`not a rational: ${s}`);
    return new Q(BigInt(m[1]), BigInt(m[2] ?? '1'));
  }
}

/** Integer square root (floor) of a non-negative BigInt. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('negative');
  if (n < 2n) return n;
  // Newton's method from a starting point above the root; it decreases monotonically to floor(sqrt(n))
  let x = 1n << (BigInt(n.toString(2).length) / 2n + 1n);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}
