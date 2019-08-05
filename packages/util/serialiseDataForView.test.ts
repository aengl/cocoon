import test from 'ava';
import serialiseDataForView from './serialiseDataForView';

test('serialises named dimensions', t => {
  t.deepEqual(
    serialiseDataForView([{ a: 1, b: 2 }, { a: 23, b: 42 }], {
      bar: 'b',
      foo: 'a',
    }),
    {
      data: [[2, 1], [42, 23]],
      dimensions: {
        bar: { name: 'b', index: 0 },
        foo: { name: 'a', index: 1 },
      },
    }
  );
});

test('serialises named dimensions with mappings', t => {
  t.deepEqual(
    serialiseDataForView([{ a: 1, b: 2 }, { a: 23, b: 42 }], {
      bar: { attribute: 'b', map: (x: number) => x * 2 },
      foo: 'a',
    }),
    {
      data: [[4, 1], [84, 23]],
      dimensions: {
        bar: { name: 'b', index: 0 },
        foo: { name: 'a', index: 1 },
      },
    }
  );
});

test('serialises named & additional dimensions', t => {
  t.deepEqual(
    serialiseDataForView(
      [{ a: 1, b: 2, c: 3 }, { a: 23, b: 42, c: 0 }],
      {
        bar: 'b',
        foo: 'a',
      },
      ['c']
    ),
    {
      data: [[2, 1, 3], [42, 23, 0]],
      dimensions: {
        bar: { name: 'b', index: 0 },
        c: { name: 'c', index: 2 },
        foo: { name: 'a', index: 1 },
      },
    }
  );
});

test('serialises the data index', t => {
  t.deepEqual(
    serialiseDataForView([{ a: 23 }, { a: 42 }], {
      foo: 'a',
      index: (d, i) => i,
    }),
    {
      data: [[23, 0], [42, 1]],
      dimensions: {
        foo: { name: 'a', index: 0 },
        index: { name: null, index: 1 },
      },
    }
  );
});

test('handles undefined dimensions', t => {
  t.deepEqual(
    serialiseDataForView([{ a: 1, b: 2 }, { a: 23, b: 42 }], {
      bar: null,
      baz: 'a',
      foo: undefined,
    }),
    {
      data: [[1], [23]],
      dimensions: {
        baz: { name: 'a', index: 0 },
      },
    }
  );
});

test('handles missing attributes', t => {
  t.deepEqual(
    serialiseDataForView([{ b: 2 }, { a: null, b: undefined }], {
      bar: 'b',
      foo: 'a',
    }),
    {
      data: [[2, null], [null, null]],
      dimensions: {
        bar: { name: 'b', index: 0 },
        foo: { name: 'a', index: 1 },
      },
    }
  );
});
