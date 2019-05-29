import { CocoonView, CocoonViewProps } from '@cocoon/types';

// export type MergeData = Array<import('../../core/nodes/data/Merge').MergeDiff>;
export type MergeData = any[];
export interface MergeState {}
export type MergeQuery = number;

export interface MergeQueryResponse {
  sourceItem: object;
  targetItem: object;
}

export interface MergeStateInternal {
  expandedRow?: number;
}
export type MergeProps = CocoonViewProps<
  MergeData,
  MergeState,
  MergeQuery,
  MergeQueryResponse
>;

export const MergeDiff: CocoonView<
  MergeData,
  MergeState,
  MergeQuery,
  MergeQueryResponse
> = {
  defaultPort: {
    incoming: false,
    name: 'diff',
  },

  serialiseViewData: (context, data, state) => data,

  respondToQuery: (context, data, query) => {
    const { source, target } = context.ports.read();
    return {
      sourceItem: source[query],
      targetItem: target[query],
    };
  },
};
