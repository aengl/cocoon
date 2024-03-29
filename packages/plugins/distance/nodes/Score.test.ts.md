# Snapshot report for `packages/plugins/distance/nodes/Score.test.ts`

The actual snapshot is saved in `Score.test.ts.snap`.

Generated by [AVA](https://avajs.dev).

## handles nil values

> Snapshot 1

    {
      in: {
        attributes: {
          score: {
            metrics: {
              a: {
                type: 'Equal',
              },
              b: {
                type: 'Equal',
              },
            },
          },
        },
        data: [
          {
            $score: {
              a: null,
              b: null,
            },
            a: null,
            b: null,
            score: 0,
          },
          {
            $score: {
              a: null,
              b: null,
            },
            a: undefined,
            b: null,
            score: 0,
          },
          {
            $score: {
              a: null,
              b: 23,
            },
            a: null,
            b: 23,
            score: 23,
          },
          {
            $score: {
              a: 42,
              b: null,
            },
            a: 42,
            b: undefined,
            score: 42,
          },
        ],
      },
      out: {
        data: [
          {
            $score: {
              a: null,
              b: null,
            },
            a: null,
            b: null,
            score: 0,
          },
          {
            $score: {
              a: null,
              b: null,
            },
            a: undefined,
            b: null,
            score: 0,
          },
          {
            $score: {
              a: null,
              b: 23,
            },
            a: null,
            b: 23,
            score: 23,
          },
          {
            $score: {
              a: 42,
              b: null,
            },
            a: 42,
            b: undefined,
            score: 42,
          },
        ],
        scores: [
          {
            score: 0,
            score_a: null,
            score_b: null,
          },
          {
            score: 0,
            score_a: null,
            score_b: null,
          },
          {
            score: 23,
            score_a: null,
            score_b: 23,
          },
          {
            score: 42,
            score_a: 42,
            score_b: null,
          },
        ],
      },
    }

## normalises correctly

> Snapshot 1

    {
      in: {
        attributes: {
          score: {
            metrics: {
              a: {
                type: 'Equal',
              },
              b: {
                type: 'Equal',
              },
            },
            normalise: true,
          },
        },
        data: [
          {
            $score: {
              a: 0,
              b: -5,
            },
            a: 0,
            b: -5,
            score: 0,
          },
          {
            $score: {
              a: 2,
              b: 0.5,
            },
            a: 2,
            b: 0.5,
            score: 0.75,
          },
          {
            $score: {
              a: 1,
              b: 4,
            },
            a: 1,
            b: 4,
            score: 1,
          },
          {
            $score: {
              a: -2,
              b: 2,
            },
            a: -2,
            b: 2,
            score: 0.5,
          },
        ],
      },
      out: {
        data: [
          {
            $score: {
              a: 0,
              b: -5,
            },
            a: 0,
            b: -5,
            score: 0,
          },
          {
            $score: {
              a: 2,
              b: 0.5,
            },
            a: 2,
            b: 0.5,
            score: 0.75,
          },
          {
            $score: {
              a: 1,
              b: 4,
            },
            a: 1,
            b: 4,
            score: 1,
          },
          {
            $score: {
              a: -2,
              b: 2,
            },
            a: -2,
            b: 2,
            score: 0.5,
          },
        ],
        scores: [
          {
            score: 0,
            score_a: 0,
            score_b: -5,
          },
          {
            score: 0.75,
            score_a: 2,
            score_b: 0.5,
          },
          {
            score: 1,
            score_a: 1,
            score_b: 4,
          },
          {
            score: 0.5,
            score_a: -2,
            score_b: 2,
          },
        ],
      },
    }

## scores correctly

> Snapshot 1

    {
      in: {
        attributes: {
          score: {
            metrics: {
              a: {
                type: 'Equal',
              },
              b: {
                type: 'Equal',
              },
            },
          },
        },
        data: [
          {
            $score: {
              a: 5,
              b: 5,
            },
            a: 5,
            b: 5,
            score: 10,
          },
          {
            $score: {
              a: 0,
              b: 10,
            },
            a: 0,
            b: 10,
            score: 10,
          },
          {
            $score: {
              a: 10,
              b: 0,
            },
            a: 10,
            b: 0,
            score: 10,
          },
          {
            $score: {
              a: -5,
              b: 15,
            },
            a: -5,
            b: 15,
            score: 10,
          },
        ],
      },
      out: {
        data: [
          {
            $score: {
              a: 5,
              b: 5,
            },
            a: 5,
            b: 5,
            score: 10,
          },
          {
            $score: {
              a: 0,
              b: 10,
            },
            a: 0,
            b: 10,
            score: 10,
          },
          {
            $score: {
              a: 10,
              b: 0,
            },
            a: 10,
            b: 0,
            score: 10,
          },
          {
            $score: {
              a: -5,
              b: 15,
            },
            a: -5,
            b: 15,
            score: 10,
          },
        ],
        scores: [
          {
            score: 10,
            score_a: 5,
            score_b: 5,
          },
          {
            score: 10,
            score_a: 0,
            score_b: 10,
          },
          {
            score: 10,
            score_a: 10,
            score_b: 0,
          },
          {
            score: 10,
            score_a: -5,
            score_b: 15,
          },
        ],
      },
    }
