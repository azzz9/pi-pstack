import assert from "node:assert/strict";

type ThrowExpectation = string | RegExp | (new (...args: never[]) => Error);
type Constructor = new (...args: never[]) => unknown;

function assertInstanceOf(actual: unknown, expected: Constructor): void {
  assert.ok(
    actual instanceof expected,
    `expected ${String(actual)} to be an instance of ${expected.name}`
  );
}

async function rejected(actual: unknown): Promise<unknown> {
  let caught: unknown;
  let isRejected = false;
  try {
    await actual;
  } catch (error) {
    isRejected = true;
    caught = error;
  }
  if (!isRejected) {
    throw new assert.AssertionError({ message: "missing expected rejection" });
  }
  return caught;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertThrows(fn: () => unknown, expected?: ThrowExpectation): void {
  let caught: unknown;
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    caught = error;
  }
  if (!threw) {
    throw new assert.AssertionError({ message: "missing expected exception" });
  }
  if (expected === undefined) {
    return;
  }
  if (typeof expected === "string") {
    assert.ok(
      messageOf(caught).includes(expected),
      `expected error message ${JSON.stringify(messageOf(caught))} to include ${JSON.stringify(expected)}`
    );
    return;
  }
  if (expected instanceof RegExp) {
    assert.match(messageOf(caught), expected);
    return;
  }
  assert.ok(
    caught instanceof expected,
    `expected error ${String(caught)} to be an instance of ${expected.name}`
  );
}

function toEndWith(actual: unknown, expected: string): void {
  assert.ok(
    String(actual).endsWith(expected),
    `expected ${JSON.stringify(String(actual))} to end with ${JSON.stringify(expected)}`
  );
}

function contains(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string") {
    return actual.includes(String(expected));
  }
  if (Array.isArray(actual)) {
    return actual.includes(expected);
  }
  throw new assert.AssertionError({
    message: `expected a string or array, received ${typeof actual}`,
  });
}

export function expect(actual: unknown) {
  return {
    toBe(expected: unknown): void {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected: unknown): void {
      assert.deepStrictEqual(actual, expected);
    },
    toMatchObject(expected: unknown): void {
      assert.partialDeepStrictEqual(actual, expected);
    },
    toContain(expected: unknown): void {
      assert.ok(
        contains(actual, expected),
        `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`
      );
    },
    toThrow(expected?: ThrowExpectation): void {
      assertThrows(actual as () => unknown, expected);
    },
    toHaveLength(expected: number): void {
      assert.strictEqual((actual as { length: number }).length, expected);
    },
    toBeInstanceOf(expected: Constructor): void {
      assertInstanceOf(actual, expected);
    },
    toEndWith(expected: string): void {
      toEndWith(actual, expected);
    },
    toBeNull(): void {
      assert.strictEqual(actual, null);
    },
    not: {
      toContain(expected: unknown): void {
        assert.ok(
          !contains(actual, expected),
          `expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(expected)}`
        );
      },
    },
    rejects: {
      async toThrow(expected?: ThrowExpectation): Promise<void> {
        const caught = await rejected(actual);
        assertThrows(() => {
          throw caught;
        }, expected);
      },
      async toBeInstanceOf(expected: Constructor): Promise<void> {
        assertInstanceOf(await rejected(actual), expected);
      },
    },
  };
}
