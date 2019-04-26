import { ScorerConfig, ScorerObject } from '.';

/**
 * This scorer simply returns the item's value as a score.
 */
export const Identity: ScorerObject<ScorerConfig> = {
  score(config, cache, value) {
    return value;
  },
};
