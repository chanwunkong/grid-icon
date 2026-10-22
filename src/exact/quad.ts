import { Q, isqrt } from './rational';

const SMALL_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n];

/**
 * An exact number a + b·√d with rational a, b and integer d ≥ 1 (d = 1 means rational, b = 0).
 * Numbers with the same d form a field Q(√d) and can be added and multiplied directly.
 * Numbers with different d are only ever compared, which `sign2` does exactly.
 * d is not required to be square-free: every decision goes through signs, never through
 * comparing representations, so the form does not have to be canonical.
 */
export class Quad {
  readonly a: Q;
  readonly b: Q;
  readonly d: bigint;

  constructor(a: Q, b: Q = Q.ZERO, d: bigint = 1n) {
    if (d < 1n) throw new RangeError('d must be ≥ 1');
    if (!b.isZero() && d > 1n) {
      // pull small square factors out of the radicand to keep numbers small
      for (const p of SMALL_PRIMES) {
        const pp = p * p;
        while (d % pp === 0n) {
          d /= pp;
          b = b.mul(new Q(p));
        }
      }
      const r = isqrt(d);
      if (r * r === d) {
        a = a.add(b.mul(new Q(r)));
        b = Q.ZERO;
        d = 1n;
      }
    }
    if (b.isZero() || d === 1n) {
      this.a = d === 1n ? a.add(b) : a;
      this.b = Q.ZERO;
      this.d = 1n;
    } else {
      this.a = a;
      this.b = b;
      this.d = d;
    }
  }

  static readonly ZERO = new Quad(Q.ZERO);
  static readonly ONE = new Quad(Q.ONE);

  static rat(q: Q): Quad {
    return new Quad(q);
  }

  static int(n: number | bigint): Quad {
    return new Quad(new Q(BigInt(n)));
  }

  /** (p + q·√disc) for a rational disc ≥ 0, written with an integer radicand. */
  static withSqrt(p: Q, q: Q, disc: Q): Quad {
    if (disc.sign() < 0) throw new RangeError('negative radicand');
    // √(n/d) = √(n·d) / d
    return new Quad(p, q.div(new Q(disc.d)), disc.n * disc.d);
  }

  get isRational(): boolean {
    return this.d === 1n;
  }

  /** True when the two numbers live in the same field, so + − × are defined between them. */
  compatible(o: Quad): boolean {
    return this.d === o.d || this.d === 1n || o.d === 1n;
  }

  private field(o: Quad): bigint {
    if (!this.compatible(o)) throw new Error(`mixed fields √${this.d} and √${o.d}`);
    return this.d === 1n ? o.d : this.d;
  }

  add(o: Quad): Quad {
    return new Quad(this.a.add(o.a), this.b.add(o.b), this.field(o));
  }

  sub(o: Quad): Quad {
    return new Quad(this.a.sub(o.a), this.b.sub(o.b), this.field(o));
  }

  mul(o: Quad): Quad {
    const d = this.field(o);
    return new Quad(this.a.mul(o.a).add(this.b.mul(o.b).mul(new Q(d))), this.a.mul(o.b).add(this.b.mul(o.a)), d);
  }

  scale(q: Q): Quad {
    return new Quad(this.a.mul(q), this.b.mul(q), this.d);
  }

  neg(): Quad {
    return new Quad(this.a.neg(), this.b.neg(), this.d);
  }

  /** Exact sign of a + b√d: when a and b disagree, compare a² with b²·d. */
  sign(): -1 | 0 | 1 {
    const sa = this.a.sign(), sb = this.b.sign();
    if (sb === 0) return sa;
    if (sa === 0 || sa === sb) return sb;
    const t = this.a.mul(this.a).sub(this.b.mul(this.b).mul(new Q(this.d))).sign();
    return t > 0 ? sa : t < 0 ? sb : 0;
  }

  isZero(): boolean {
    return this.a.isZero() && this.b.isZero();
  }

  /** Exact comparison, also between different fields. */
  cmp(o: Quad): -1 | 0 | 1 {
    if (this.compatible(o)) return this.sub(o).sign();
    // (a1 + b1√d1) − (a2 + b2√d2) = X + Y√d2 with X = a1 − a2 + b1√d1 and Y = −b2
    return sign2(this.sub(Quad.rat(o.a)), Quad.rat(o.b.neg()), o.d);
  }

  eq(o: Quad): boolean {
    return this.cmp(o) === 0;
  }

  toNumber(): number {
    return this.a.toNumber() + this.b.toNumber() * Math.sqrt(Number(this.d));
  }

  toJSON(): string {
    return this.d === 1n ? this.a.toString() : `${this.a}|${this.b}|${this.d}`;
  }

  static parse(s: string): Quad {
    const [a, b, d] = s.split('|');
    return b === undefined ? Quad.rat(Q.parse(a)) : new Quad(Q.parse(a), Q.parse(b), BigInt(d));
  }

  toString(): string {
    return this.d === 1n ? this.a.toString() : `${this.a} + ${this.b}√${this.d}`;
  }
}

/**
 * Exact sign of X + Y·√d2 where X and Y are in the same field Q(√d1) (d1 may differ from d2).
 * Move one term over and square: if X and Y have opposite signs, the larger of X² and Y²·d2 wins.
 * X² and Y²·d2 are again in Q(√d1), whose signs Quad.sign() decides the same way.
 */
export function sign2(X: Quad, Y: Quad, d2: bigint): -1 | 0 | 1 {
  const sx = X.sign(), sy = Y.sign();
  if (sy === 0 || d2 === 0n) return sx;
  if (sx === 0 || sx === sy) return sy;
  const t = X.mul(X).sub(Y.mul(Y).scale(new Q(d2))).sign();
  return t > 0 ? sx : t < 0 ? sy : 0;
}

/** A number X + Y·√d2 with X, Y in one field Q(√d1): the product of an element of Q(√d1) and one of Q(√d2). */
export class Mix {
  constructor(readonly X: Quad, readonly Y: Quad, readonly d2: bigint) {}

  static of(q: Quad): Mix {
    return new Mix(q, Quad.ZERO, 1n);
  }

  /** s·t for s in Q(√d1) and t in Q(√d2). */
  static mul(s: Quad, t: Quad): Mix {
    // always split on t's radical, so the X and Y parts stay in s's field whatever t is
    return new Mix(s.scale(t.a), s.scale(t.b), t.d);
  }

  add(o: Mix): Mix {
    if (o.d2 === 1n || o.Y.isZero()) return new Mix(this.X.add(o.X), this.Y, this.d2);
    if (this.d2 === 1n || this.Y.isZero()) return new Mix(this.X.add(o.X), o.Y, o.d2);
    if (this.d2 !== o.d2) throw new Error('Mix terms with different second radicals');
    return new Mix(this.X.add(o.X), this.Y.add(o.Y), this.d2);
  }

  neg(): Mix {
    return new Mix(this.X.neg(), this.Y.neg(), this.d2);
  }

  sign(): -1 | 0 | 1 {
    return this.d2 === 1n ? this.X.add(this.Y).sign() : sign2(this.X, this.Y, this.d2);
  }
}
